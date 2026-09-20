import type { T3Project, T3Thread } from "../../types.js";
import { threadSortTime, threadStatus, type ShellState, type ThreadStatus } from "./shell.js";

export interface SidebarThread {
  thread: T3Thread;
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
 * T3 renders a two-character project chip and every project here has a null
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

function threadTime(thread: T3Thread): number {
  const candidates = [thread.updatedAt, thread.latestUserMessageAt, thread.createdAt];
  let latest = 0;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = Date.parse(candidate);
    if (!Number.isNaN(value) && value > latest) latest = value;
  }
  return latest;
}

function toSidebarThread(thread: T3Thread, projects: Map<string, T3Project>, now: number): SidebarThread {
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
  };
}

/**
 * What the age column counts from. Idle threads count from their latest
 * activity, but a running thread counts from when its turn started — every
 * streamed message would otherwise reset the clock to zero and the card
 * could never show how long the turn has been running.
 */
function displayTimestamp(thread: T3Thread, status: ThreadStatus): string | undefined {
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
function byRecency(left: T3Thread, right: T3Thread): number {
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

  const active: T3Thread[] = [];
  const settled: T3Thread[] = [];
  for (const thread of live) {
    (threadStatus(thread, options.now) === "settled" ? settled : active).push(thread);
  }
  active.sort(byRecency);
  settled.sort(byRecency);

  const projectId = mode === "project" ? (options.projectId ?? options.fallbackProjectId ?? null) : null;
  const visible = mode === "project" && projectId !== null ? active.filter((thread) => thread.projectId === projectId) : active;
  // `project` mode claims to show one project's threads; the settled section
  // must honor that too, or it silently leaks every other project's history.
  const visibleSettled =
    mode === "project" && projectId !== null ? settled.filter((thread) => thread.projectId === projectId) : settled;

  let groups: SidebarGroup[] = [];
  if (mode === "grouped") {
    const perProject = new Map<string, T3Thread[]>();
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
          threads: rows.map((thread) => toSidebarThread(thread, projects, options.now)),
          collapsed: options.collapsedProjects?.has(id) ?? false,
        };
      });
  }

  return {
    active: visible.map((thread) => toSidebarThread(thread, projects, options.now)),
    settled: (options.settledExpanded ? visibleSettled.slice(0, options.settledLimit) : []).map((thread) =>
      toSidebarThread(thread, projects, options.now),
    ),
    settledTotal: visibleSettled.length,
    mode,
    groups,
    projectId,
    projectTitle: projectId === null ? null : (projects.get(projectId)?.title ?? "unknown project"),
  };
}
