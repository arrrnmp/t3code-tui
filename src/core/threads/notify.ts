/**
 * Telling a parent thread its delegated tasks finished.
 *
 * Without this a parent had to poll `task_status` (or run the orchestrate
 * skill's signal-file listener) to learn a child was done. Now the process
 * that runs the child sends the parent one message when it settles — a
 * steer into the parent's running turn where the provider takes one, else a
 * turn of its own. Tasks settling within a moment of each other share one
 * message, so a fan-out does not wake the parent once per child.
 *
 * The message carries the facts twice: as text the model reads, and as
 * structured `notification` data the TUI draws as a card.
 */
import type { DelegatedTaskStatus } from "./views.js";

export interface TaskNotification {
  readonly taskId: string;
  readonly title: string;
  readonly status: DelegatedTaskStatus;
  /** How long the task's turn ran; null when it never recorded both ends. */
  readonly durationMs: number | null;
  /** `instance/model` it ran on. */
  readonly model: string | null;
  /** The branch holding its work, for a task in its own worktree. */
  readonly branch: string | null;
  /** The first line of its report — delegated threads are asked to lead with one. */
  readonly headline: string | null;
  /** What it changed, from its checkpoint; null when unknown. */
  readonly filesChanged: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
}

/** The first line of a report, as its headline (markdown emphasis and heading marks dropped). */
export function reportHeadline(report: string | null): string | null {
  const line = report
    ?.split(/\r?\n/u)
    .map((row) => row.trim())
    .find((row) => row.length > 0);
  if (!line) return null;
  const plain = line.replace(/^#+\s*/u, "").replace(/\*\*/gu, "").trim();
  return plain.length <= 200 ? plain : `${plain.slice(0, 199)}…`;
}

/** "3m 12s" / "45s" / "1h 5m". */
export function formatTaskDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const VERB: Record<DelegatedTaskStatus, string> = {
  running: "is still running",
  completed: "finished",
  failed: "failed",
  interrupted: "was stopped",
};

/** The message the parent's agent reads. */
export function taskNotificationText(tasks: readonly TaskNotification[]): string {
  const lines = tasks.map((task) => {
    const facts = [
      task.durationMs === null ? null : formatTaskDuration(task.durationMs),
      task.model,
      task.branch === null ? null : `branch ${task.branch}`,
      task.filesChanged === null || task.filesChanged === 0 ? null : `${task.filesChanged} file${task.filesChanged === 1 ? "" : "s"} changed (+${task.additions ?? 0} −${task.deletions ?? 0})`,
    ].filter((fact): fact is string => fact !== null);
    return [
      `- Task "${task.title}" (taskId ${task.taskId}) ${VERB[task.status]}${facts.length > 0 ? ` · ${facts.join(" · ")}` : ""}.`,
      task.headline === null ? null : `  Headline: ${task.headline}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  });
  const head = tasks.length === 1 ? "A task you delegated has settled." : `${tasks.length} tasks you delegated have settled.`;
  return [
    "<task-notification>",
    head,
    ...lines,
    "Call task_status with a taskId for the full report.",
    "</task-notification>",
  ].join("\n");
}
