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
 * Every session gets one line saying it runs through moxen, in its own
 * harness — so an agent asked where it is answers truthfully, while still
 * being the Claude Code / Codex / … it is. It names no model: the model can
 * change mid-thread, and each harness already states its own. Every session
 * is also told to research before it guesses. The other sections appear
 * only when they apply. Project rules files (`AGENTS.md`,
 * `CLAUDE.md`) are the providers' business — each already reads its own;
 * this is for what only moxen knows.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { APP_DISPLAY_NAME, APP_NAME } from "../config.js";
import type { ThreadEnv } from "./types.js";

export interface RuntimeInstructionsInput {
  /** The model selection's instance id (`claudeAgent`, `codex`, `opencode/…`): names the harness. */
  readonly instanceId: string;
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

/**
 * Agents lean on memory and local greps for how a library or service works,
 * and guess when those run out. Docs and changelogs say what an API is for
 * and what it is called, which is what makes a search of the installed
 * source land.
 */
export const RESEARCH_GUIDANCE =
  "When the work depends on how a library, tool, API or service behaves, look it up rather than relying on memory: " +
  "if you can search the web, read the official documentation, changelogs and issues, then check the installed source " +
  "(dependencies, vendored code) knowing what to look for. Research is part of the work, not a detour from it.";

/** "Claude Code", "Codex", …: the harness a provider instance runs in, as its users call it. */
export function harnessName(instanceId: string): string {
  const key = instanceId.trim().toLowerCase();
  if (key === "claudeagent" || key === "claude") return "Claude Code";
  if (key === "codex") return "Codex";
  if (key === "grok") return "Grok";
  if (key === "opencode" || key.startsWith("opencode/")) return "OpenCode";
  return instanceId;
}

/** The instructions for one session. */
export function buildRuntimeInstructions(input: RuntimeInstructionsInput): string {
  const sections: string[] = [
    `In case you're asked: you are running in ${APP_DISPLAY_NAME}, a terminal app that runs coding agents as threads, ` +
      `through the ${harnessName(input.instanceId)} harness. No need to mention this otherwise.`,
    RESEARCH_GUIDANCE,
  ];
  const delegation = input.delegation ?? null;

  if (delegation) {
    const lines = [
      `You are a subagent: another agent working in the thread "${delegation.parentTitle}" delegated this task to you.`,
      "Your final message is returned to that agent as the task's result, and it is all they will read.",
      "Make it a self-contained report: what you did, which files you changed, how you verified it, and anything left unfinished.",
      "Open the report with a single line that sums up the outcome (e.g. \"Audited 3 route files: 2 missing auth checks\") — it is shown as the task's headline.",
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

  return sections.join("\n\n");
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
