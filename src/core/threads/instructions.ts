/**
 * Runtime instructions: the one place that decides what a provider session
 * is told about the moxen runtime it runs in, beyond the user's prompt.
 *
 * Every driver delivers the result through its provider's native channel —
 * appended to the system prompt, never pasted into the conversation:
 *
 * | Provider | Channel |
 * |---|---|
 * | Claude | SDK `systemPrompt: { type: "preset", preset: "claude_code", append }` |
 * | Codex | `developerInstructions` on `thread/start` / `thread/resume` |
 * | OpenCode | `system` on every `session.promptAsync` |
 * | Grok | `session/new` `_meta.rules` ("extra rules appended to the system prompt") |
 *
 * Sections appear only when they apply, so a plain local thread with no
 * configured instructions gets none at all and runs exactly as the provider
 * would on its own. Project rules files (`AGENTS.md`, `CLAUDE.md`) are the
 * providers' business — each already reads its own; this is for what only
 * moxen knows.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { APP_NAME } from "../config.js";
import type { ThreadEnv } from "./types.js";

export interface RuntimeInstructionsInput {
  /** Where the session runs. A worktree gets told what that means. */
  readonly env: ThreadEnv;
  /** Set when this thread is a delegated task of another thread. */
  readonly delegation?: {
    readonly parentTitle: string;
    /** The branch the task's worktree was cut from; null when it shares the parent's checkout. */
    readonly baseBranch: string | null;
  } | null;
  /** From config `instructions`, then the project's `moxen.json`, in that order. */
  readonly userInstructions?: readonly string[];
}

/** The instructions for one session, or null when none apply. */
export function buildRuntimeInstructions(input: RuntimeInstructionsInput): string | null {
  const sections: string[] = [];
  const delegation = input.delegation ?? null;

  if (delegation) {
    const lines = [
      `You are a subagent: another agent working in the thread "${delegation.parentTitle}" delegated this task to you.`,
      "Your final message is returned to that agent as the task's result, and it is all they will read.",
      "Make it a self-contained report: what you did, which files you changed, how you verified it, and anything left unfinished.",
    ];
    if (input.env.mode === "worktree" && input.env.branch) {
      lines.push(
        `You work in your own git worktree at ${input.env.path}, on branch ${input.env.branch}` +
          (delegation.baseBranch ? `, cut from ${delegation.baseBranch}` : "") +
          ". Changes the other agent had not committed are not here.",
        `Commit your work on ${input.env.branch} before you finish; the other agent integrates it from that branch.`,
      );
    } else {
      lines.push("You share the other agent's checkout: coordinate through your report, not by leaving half-finished edits.");
    }
    sections.push(lines.join("\n"));
  } else if (input.env.mode === "worktree" && input.env.branch) {
    sections.push(
      `This session runs in a dedicated git worktree at ${input.env.path}, on branch ${input.env.branch}. ` +
        "Work and run commands there, not in the main checkout.",
    );
  }

  const user = (input.userInstructions ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (user.length > 0) sections.push(user.join("\n\n"));

  return sections.length > 0 ? sections.join("\n\n") : null;
}

/** `instructions` from `<workspaceRoot>/moxen.json`: a string, or an array of lines. */
export async function projectInstructions(workspaceRoot: string | null): Promise<string | null> {
  if (!workspaceRoot) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(workspaceRoot, `${APP_NAME}.json`), "utf8"));
  } catch {
    // Missing or unreadable: the project declares nothing (as for `mcpServers`).
    return null;
  }
  const value = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).instructions : undefined;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const lines = value.filter((line): line is string => typeof line === "string");
    return lines.join("\n").trim() || null;
  }
  return null;
}
