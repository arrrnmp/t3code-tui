import type { NativeSubagentEnvelope, ProjectEnvelope, ThreadEnvelope } from "../../core/types.js";
import { threadSortTime, threadStatus, type ShellState, type ThreadStatus } from "./shell.js";

export interface SidebarThread {
  thread: ThreadEnvelope;
  projectTitle: string;
  badge: string;
  badgeColor: string;
  title: string;
  branch: string | null;
  age: string;
  status: ThreadStatus;
  /** The server flagged a pending approval or question — needs the user,
      answerable only in clients speaking protocol v2 (not this one). */
  waiting: boolean;
  /** 0 for a top-level thread; 1 for a delegated task shown under its parent. */
  depth: number;
  /** A child that closes its family (`└`), rather than one with a sibling below (`├`). */
  last: boolean;
  /**
   * The family's native subagents, drawn right after this row: set on the
   * family's last row (the parent itself when it delegated nothing), so they
   * sit below the delegated threads.
   */
  natives: SidebarNative[];
}

/** One of a thread's native subagents (Claude's Agent tool), as the sidebar lists it under the thread. */
export interface SidebarNative {
  agentId: string;
  parentThreadId: string;
  /** "Explore · Count TODO comments", or just the type. */
  label: string;
  running: boolean;
  failed: boolean;
  /** Since it started while running, since it stopped after. */
  age: string;
  last: boolean;
}

/** Finished native subagents listed per thread, newest; running ones are always listed. */
const FINISHED_NATIVES = 3;

function sidebarNatives(thread: ThreadEnvelope, now: number): SidebarNative[] {
  const all: readonly NativeSubagentEnvelope[] = Array.isArray(thread.nativeSubagents) ? thread.nativeSubagents : [];
  const finished = new Set(
    all
      .filter((entry) => entry.status !== "running")
      .sort((left, right) => (right.stoppedAt ?? right.startedAt).localeCompare(left.stoppedAt ?? left.startedAt))
      .slice(0, FINISHED_NATIVES)
      .map((entry) => entry.agentId),
  );
  const shown = all.filter((entry) => entry.status === "running" || finished.has(entry.agentId)).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return shown.map((entry, index) => ({
    agentId: entry.agentId,
    parentThreadId: thread.id,
    label: entry.description === null ? entry.agentType : `${entry.agentType} · ${entry.description}`,
    running: entry.status === "running",
    failed: entry.status === "failed",
    age: relativeAge(entry.status === "running" ? entry.startedAt : (entry.stoppedAt ?? entry.startedAt), now),
    last: index === shown.length - 1,
  }));
}

export interface SidebarSections {
  active: SidebarThread[];
  settled: SidebarThread[];
  settledTotal: number;
  mode: SidebarMode;
  /** Populated in `grouped` mode: one entry per project, newest project first. */
  groups: SidebarGroup[];
  /** The project shown in `project` mode (null when it could not resolve). */
  projectId: string | null;
  projectTitle: string | null;
}

export interface SidebarGroup {
  projectId: string;
  projectTitle: string;
  badge: string;
  badgeColor: string;
  threads: SidebarThread[];
  collapsed: boolean;
}

/** Flat recency list, project-grouped list, or a single project's threads. */
export type SidebarMode = "flat" | "grouped" | "project";

/** Dusted-down hues (each blended toward zinc-500) so project chips carry
    enough color to tell projects apart without breaking the app's otherwise
    quiet, low-saturation palette. */
const BADGE_COLORS = ["#c35457", "#4e7ccb", "#955fcb", "#32a07f", "#c78e32", "#c1568e", "#359f97"];

/**
 * A two-character project chip is rendered and every project here has a null
 * `projectIcon`, so the chip is derived: leading character plus the first digit
 * when the name carries one, else the trailing character.
 */
export function projectBadge(title: string): string {
  const compact = title.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length === 0) return "??";
  const first = compact[0] ?? "?";
  const digit = compact.slice(1).match(/[0-9]/);
  const second = digit?.[0] ?? compact[compact.length - 1] ?? first;
  return `${first}${second}`.toUpperCase();
}

export function badgeColor(projectId: string): string {
  let hash = 0;
  for (const character of projectId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length] ?? "#6b7280";
}

export function relativeAge(value: string | undefined, now: number): string {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function threadTime(thread: ThreadEnvelope): number {
  const candidates = [thread.updatedAt, thread.latestUserMessageAt, thread.createdAt];
  let latest = 0;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = Date.parse(candidate);
    if (!Number.isNaN(value) && value > latest) latest = value;
  }
  return latest;
}

function toSidebarThread(
  thread: ThreadEnvelope,
  projects: Map<string, ProjectEnvelope>,
  now: number,
  depth = 0,
  last = false,
  natives: SidebarNative[] = [],
): SidebarThread {
  const project = projects.get(thread.projectId);
  const projectTitle = project?.title ?? "unknown project";
  const branch = typeof thread.branch === "string" && thread.branch.length > 0 ? thread.branch : null;
  const status = threadStatus(thread, now);
  return {
    thread,
    projectTitle,
    badge: projectBadge(projectTitle),
    badgeColor: badgeColor(thread.projectId),
    title: String(thread.title ?? thread.id),
    branch,
    age: relativeAge(displayTimestamp(thread, status), now),
    status,
    waiting: thread.hasPendingUserInput === true || thread.hasPendingApprovals === true,
    depth,
    last,
    natives,
  };
}

/**
 * A list with every delegated task moved right under its parent, oldest
 * task first, each tagged with its depth. A task whose parent is not in the
 * list (settled apart, another project, archived) stays where it was, at
 * the top level. Nesting is one level deep: a task of a task sits beside
 * its sibling tasks, never deeper.
 *
 * With `now`, each family also gets its native subagents: they follow the
 * delegated threads, so the connectors (`├` / `└`) run through both.
 */
export function nestDelegated(
  threads: readonly ThreadEnvelope[],
  now?: number,
): Array<{ thread: ThreadEnvelope; depth: number; last: boolean; natives: SidebarNative[] }> {
  const present = new Set(threads.map((thread) => thread.id));
  const rootOf = (thread: ThreadEnvelope): string | null => {
    let parent = typeof thread.parentThreadId === "string" && present.has(thread.parentThreadId) ? thread.parentThreadId : null;
    const seen = new Set([thread.id]);
    // Climb to the top-level ancestor, so the tree stays one level deep.
    while (parent !== null && !seen.has(parent)) {
      seen.add(parent);
      const up = threads.find((candidate) => candidate.id === parent)?.parentThreadId;
      if (typeof up !== "string" || !present.has(up)) break;
      parent = up;
    }
    return parent;
  };
  const children = new Map<string, ThreadEnvelope[]>();
  const top: ThreadEnvelope[] = [];
  for (const thread of threads) {
    const root = rootOf(thread);
    if (root === null) top.push(thread);
    else children.set(root, [...(children.get(root) ?? []), thread]);
  }
  return top.flatMap((thread) => {
    const kids = [...(children.get(thread.id) ?? [])].sort((left, right) => Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? ""));
    const natives = now === undefined ? [] : sidebarNatives(thread, now);
    return [
      { thread, depth: 0, last: false, natives: kids.length === 0 ? natives : [] },
      ...kids.map((child, index) => {
        const final = index === kids.length - 1;
        return { thread: child, depth: 1, last: final && natives.length === 0, natives: final ? natives : [] };
      }),
    ];
  });
}

/**
 * What the age column counts from. Idle threads count from their latest
 * activity, but a running thread counts from when its turn started — every
 * streamed message would otherwise reset the clock to zero and the card
 * could never show how long the turn has been running.
 */
function displayTimestamp(thread: ThreadEnvelope, status: ThreadStatus): string | undefined {
  if (status === "running") {
    const turn = thread.latestTurn;
    const anchor = turn?.startedAt ?? turn?.requestedAt;
    if (typeof anchor === "string" && !Number.isNaN(Date.parse(anchor))) return anchor;
  }
  const ms = threadTime(thread);
  return ms === 0 ? undefined : new Date(ms).toISOString();
}

export interface SidebarOptions {
  settledExpanded: boolean;
  settledLimit: number;
  now: number;
  mode?: SidebarMode;
  /** Required in `project` mode; falls back to `fallbackProjectId`. */
  projectId?: string | null;
  /** Used when `projectId` is absent (e.g. the open thread's project). */
  fallbackProjectId?: string | null;
  /** Project ids whose groups render collapsed in `grouped` mode. */
  collapsedProjects?: ReadonlySet<string>;
}

/**
 * Newest user turn (or finished turn) first — never `updatedAt`, so running
 * threads hold their slots instead of leapfrogging on every tool call.
 */
function byRecency(left: ThreadEnvelope, right: ThreadEnvelope): number {
  return threadSortTime(right) - threadSortTime(left);
}

/** Project ids with live threads, most recently active first. */
export function orderedProjectIds(state: ShellState): string[] {
  const ordered: string[] = [];
  const ranked = state.threads
    .filter((thread) => thread.archivedAt === null && thread.deletedAt == null)
    .sort(byRecency);
  for (const thread of ranked) {
    if (!ordered.includes(thread.projectId)) ordered.push(thread.projectId);
  }
  return ordered;
}

/**
 * Active threads always sort by latest user turn (or finished turn) first —
 * grouping never reorders them. `flat` is one such list, `grouped` clusters
 * that same order under collapsible project headers (newest project first),
 * and `project` filters to a single project. Settled threads stay in one
 * equally ordered list for the bottom section.
 */
export function buildSidebarSections(state: ShellState, options: SidebarOptions): SidebarSections {
  const mode = options.mode ?? "flat";
  const projects = new Map(state.projects.map((project) => [project.id, project]));
  const live = state.threads.filter((thread) => thread.archivedAt === null && thread.deletedAt == null);

  const active: ThreadEnvelope[] = [];
  const settled: ThreadEnvelope[] = [];
  for (const thread of live) {
    (threadStatus(thread, options.now) === "settled" ? settled : active).push(thread);
  }
  // An active subthread whose parent is settled (legacy data, or a task
  // delegated from a settled thread) would otherwise surface as a top-level
  // row that reads as an unrelated thread. Rule: the settled ancestors are
  // pulled into the active list as dim header rows, so the family stays
  // nested and visibly belongs to something settled. While they head a live
  // family they are not repeated in the Settled section.
  const byId = new Map(live.map((thread) => [thread.id, thread]));
  const anchors = new Set<string>();
  for (const thread of active) {
    const seen = new Set([thread.id]);
    for (let up = byId.get(thread.parentThreadId ?? ""); up !== undefined && !seen.has(up.id); up = byId.get(up.parentThreadId ?? "")) {
      seen.add(up.id);
      if (threadStatus(up, options.now) === "settled") anchors.add(up.id);
    }
  }
  const anchored = settled.filter((thread) => anchors.has(thread.id));
  const settledRest = settled.filter((thread) => !anchors.has(thread.id));
  const listed = [...active, ...anchored];
  listed.sort(byRecency);
  settledRest.sort(byRecency);

  const projectId = mode === "project" ? (options.projectId ?? options.fallbackProjectId ?? null) : null;
  const visible = mode === "project" && projectId !== null ? listed.filter((thread) => thread.projectId === projectId) : listed;
  // `project` mode claims to show one project's threads; the settled section
  // must honor that too, or it silently leaks every other project's history.
  const visibleSettled =
    mode === "project" && projectId !== null ? settledRest.filter((thread) => thread.projectId === projectId) : settledRest;

  let groups: SidebarGroup[] = [];
  if (mode === "grouped") {
    const perProject = new Map<string, ThreadEnvelope[]>();
    for (const thread of visible) {
      const rows = perProject.get(thread.projectId) ?? [];
      rows.push(thread);
      perProject.set(thread.projectId, rows);
    }
    groups = [...perProject.entries()]
      .sort(([, left], [, right]) => threadSortTime(right[0]!) - threadSortTime(left[0]!))
      .map(([id, rows]) => {
        const projectTitle = projects.get(id)?.title ?? "unknown project";
        return {
          projectId: id,
          projectTitle,
          badge: projectBadge(projectTitle),
          badgeColor: badgeColor(id),
          threads: nestDelegated(rows, options.now).map(({ thread, depth, last, natives }) => toSidebarThread(thread, projects, options.now, depth, last, natives)),
          collapsed: options.collapsedProjects?.has(id) ?? false,
        };
      });
  }

  return {
    active: nestDelegated(visible, options.now).map(({ thread, depth, last, natives }) => toSidebarThread(thread, projects, options.now, depth, last, natives)),
    // Settled threads list their delegated tasks only; their subagents are history.
    settled: nestDelegated(options.settledExpanded ? visibleSettled.slice(0, options.settledLimit) : []).map(({ thread, depth, last }) =>
      toSidebarThread(thread, projects, options.now, depth, last),
    ),
    settledTotal: visibleSettled.length,
    mode,
    groups,
    projectId,
    projectTitle: projectId === null ? null : (projects.get(projectId)?.title ?? "unknown project"),
  };
}
