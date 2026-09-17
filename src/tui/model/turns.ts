import type { TimelineEntry } from "./thread.js";

export interface TurnGroup {
  id: string;
  turnId: string | null;
  /** Prompts that opened the turn. */
  prompts: TimelineEntry[];
  /** Tool calls and intermediate replies, hidden until the group is expanded. */
  work: TimelineEntry[];
  /** The finished reply that closed the turn, always shown. */
  reply: TimelineEntry | null;
  /**
   * Streaming assistant text for the in-flight turn. Rendered as live
   * "working" text — never as the closing reply — until the final
   * non-streaming message for the same id lands.
   */
  live: TimelineEntry | null;
  diff: TimelineEntry | null;
  /** A plan proposed for this turn, if the thread ran in plan-approval mode. */
  proposedPlan: TimelineEntry | null;
  durationMs: number;
  startedAt: string;
}

function elapsed(entries: readonly TimelineEntry[]): { durationMs: number; startedAt: string } {
  const times = entries
    .map((entry) => Date.parse(entry.at))
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => left - right);
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined) return { durationMs: 0, startedAt: entries[0]?.at ?? "" };
  return { durationMs: last - first, startedAt: new Date(first).toISOString() };
}

/**
 * T3's own transcript keeps a turn's prompt and closing reply visible and folds
 * everything between them into one "worked for" row; this groups the flat
 * timeline the same way so a long turn does not bury the answer.
 */
export function groupTurns(entries: readonly TimelineEntry[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;

  const open = (entry: TimelineEntry): TurnGroup => {
    const group: TurnGroup = {
      id: entry.turnId ?? entry.id,
      turnId: entry.turnId,
      prompts: [],
      work: [],
      reply: null,
      live: null,
      diff: null,
      proposedPlan: null,
      durationMs: 0,
      startedAt: entry.at,
    };
    groups.push(group);
    return group;
  };

  // A reply only counts as "closing" until a nudge sharing its turnId proves
  // the turn kept going — previously nothing demoted it in that case, so the
  // old reply rendered on, stale, next to the fresh "Worked for..." fold the
  // nudge's own follow-up work produced. The `at` check is a defensive
  // tie-breaker (real messages arrive in order already) rather than a load-
  // bearing one.
  const demoteStaleReply = (group: TurnGroup, incoming: TimelineEntry) => {
    const reply = group.reply;
    if (reply === null) return;
    const replyAt = Date.parse(reply.at);
    const incomingAt = Date.parse(incoming.at);
    if (!Number.isNaN(replyAt) && !Number.isNaN(incomingAt) && incomingAt <= replyAt) return;
    group.work.push(reply);
    group.reply = null;
  };

  for (const entry of entries) {
    // A user prompt starts a new group unless it shares the open group's turn
    // id: a follow-up "nudge" sent while a turn is still running carries the
    // same turnId as the prompt that opened it, so merging it here keeps the
    // turn's elapsed clock anchored to the first prompt instead of
    // restarting on every nudge.
    if (entry.kind === "user") {
      if (current === null || entry.turnId === null || current.turnId === null || entry.turnId !== current.turnId) {
        current = open(entry);
      } else {
        demoteStaleReply(current, entry);
      }
      current.prompts.push(entry);
      continue;
    }
    if (current === null || (entry.turnId !== null && entry.turnId !== current.turnId)) {
      // A turnId'd entry always resolves to its own turn's group — even when
      // the open group is a null-turn prompt. Live user prompts carry a null
      // turnId, so without the split their whole turn's work (and the
      // checkpoint diff entry) would merge into the prompt's group while the
      // turn-diff orphaned into a work-less group of its own — leaving rows
      // like inline diffs with no turn to resolve against. Entries with no
      // turnId of their own (system rows) still ride along.
      current = open(entry);
    }
    if (entry.kind === "turn-diff") {
      // A diff belongs to its own turn: a foreign group (e.g. one opened by
      // null-turnId system activities) must not absorb it, or the row
      // renders under the wrong turn — and no group carries the
      // checkpoint's turnId for jump lookups afterwards.
      if (current.turnId !== entry.turnId) current = open(entry);
      current.diff = entry;
      continue;
    }
    if (entry.kind === "proposed-plan") {
      current.proposedPlan = entry;
      continue;
    }
    if (entry.kind === "assistant") {
      // Streaming text is live output, not the closing reply: it renders in
      // working style until the final message for the same id arrives, at
      // which point it is promoted and the live slot clears.
      if (entry.streaming) {
        current.live = entry;
        continue;
      }
      if (current.live?.id === entry.id) current.live = null;
      // The previous reply becomes work as soon as another one lands.
      if (current.reply !== null) current.work.push(current.reply);
      current.reply = entry;
      continue;
    }
    // Deliberately *not* `demoteStaleReply` here: an ordinary turn often
    // explains itself in text and then keeps working with no final wrap-up
    // sentence, and that explanation is still the meaningful thing to show —
    // folding it away just because *some* tool call came after it would
    // punish the common case. Only a nudge (above) or a genuinely new reply
    // (below) proves the old one was superseded.
    current.work.push(entry);
  }

  for (const group of groups) {
    const all = [
      ...group.prompts,
      ...group.work,
      ...(group.reply === null ? [] : [group.reply]),
      ...(group.live === null ? [] : [group.live]),
    ];
    const timing = elapsed(all);
    group.durationMs = timing.durationMs;
    group.startedAt = timing.startedAt;
  }
  return groups;
}

export function formatDuration(durationMs: number): string {  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** `359_000` → `"359k"`, `1_400_000` → `"1.4m"`, `1_000_000` → `"1m"`. */
export function formatTokenCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  const millions = Math.round((value / 1_000_000) * 10) / 10;
  return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`;
}

export interface ContextUsageDisplay {
  /** Null when the driver never reports a ceiling (usage still shown as a raw count). */
  percent: number | null;
  usedLabel: string;
  maxLabel: string | null;
  totalProcessedLabel: string | null;
}

export function formatContextUsage(usage: {
  usedTokens: number;
  maxTokens: number | null;
  totalProcessedTokens: number | null;
}): ContextUsageDisplay {
  return {
    percent: usage.maxTokens === null || usage.maxTokens <= 0 ? null : Math.round((usage.usedTokens / usage.maxTokens) * 100),
    usedLabel: formatTokenCount(usage.usedTokens),
    maxLabel: usage.maxTokens === null ? null : formatTokenCount(usage.maxTokens),
    totalProcessedLabel: usage.totalProcessedTokens === null ? null : formatTokenCount(usage.totalProcessedTokens),
  };
}

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Same calendar day as `now`: hour only. Within the last 6 days: weekday +
 * time. Older (or same-day clock skew that lands `value` in the future):
 * date + time — spelled out since a bare weekday alone is ambiguous past a
 * week.
 */
export function clockTime(value: string, now: number): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  const date = new Date(parsed);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const dayDiff = Math.round((startOfDay(now) - startOfDay(parsed)) / 86_400_000);
  if (dayDiff <= 0) return time;
  if (dayDiff < 7) return `${WEEKDAY_LABEL[date.getDay()]}, ${time}`;
  return `${String(date.getDate()).padStart(2, "0")} ${MONTH_LABEL[date.getMonth()]}, ${time}`;
}

export type WorkBlock<T> = { kind: "single"; entry: T } | { kind: "stack"; key: string; entries: T[] };

/**
 * Scroll offset that puts group `index` of `total` at the top of a pane with
 * `scrollHeight` rows and a `viewportHeight`-row window. Clamped into the
 * real `[0, scrollHeight - viewportHeight]` range: a past-the-end target
 * would just rest on the bottom (invisible when already there) and keep a
 * sticky-bottom box engaged instead of marking a manual scroll.
 */
export function proportionalTarget(index: number, total: number, scrollHeight: number, viewportHeight: number): number {
  if (total <= 0) return 0;
  const maxTop = Math.max(0, scrollHeight - viewportHeight);
  return Math.max(0, Math.min(maxTop, Math.floor((index / total) * scrollHeight)));
}/**
 * Folds consecutive work entries with the same stack key (one tool run after
 * another) into a stack showing a summary plus the latest card. Entries
 * without a key — intermediate assistant messages — always break a run.
 */
export function stackWorkEntries<T>(entries: readonly T[], keyOf: (entry: T) => string | null): WorkBlock<T>[] {
  const blocks: WorkBlock<T>[] = [];
  for (const entry of entries) {
    const key = keyOf(entry);
    const last = blocks[blocks.length - 1];
    if (key !== null && last !== undefined && last.kind === "stack" && last.key === key) {
      last.entries.push(entry);
      continue;
    }
    if (key !== null) {
      blocks.push({ kind: "stack", key, entries: [entry] });
      continue;
    }
    blocks.push({ kind: "single", entry });
  }
  return blocks.map((block) =>
    block.kind === "stack" && block.entries.length === 1 ? { kind: "single", entry: block.entries[0] as T } : block,
  );
}
