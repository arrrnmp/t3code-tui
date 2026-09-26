/**
 * Claude reasoning effort, read off a model selection's `effort` option.
 *
 * The catalog offers three kinds of choice, and each reaches Claude Code
 * differently:
 * - a level (`low` … `max`): the SDK's `effort` option at spawn, and
 *   `applyFlagSettings({ effortLevel })` when it changes mid-session;
 * - `ultracode`: a session setting (xhigh effort plus workflow
 *   orchestration), set through the same flag-settings layer;
 * - `ultrathink`: not a setting at all but a per-turn keyword Claude Code
 *   recognizes in the prompt — the session's effort stays as it was.
 */
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

import type { ModelSelection } from "../../types.js";
import { claudeCatalogModels } from "./catalog.js";
import type { FlagSettings } from "./transport.js";

export type ClaudeEffortChoice =
  | { readonly kind: "level"; readonly level: EffortLevel }
  | { readonly kind: "ultracode" }
  | { readonly kind: "ultrathink" };

const LEVELS: ReadonlySet<string> = new Set(["low", "medium", "high", "xhigh", "max"]);

/** The keyword appended to a prompt to ask for deeper reasoning on that turn only. */
export const ULTRATHINK_KEYWORD = "ultrathink";

/** The selection's effort choice; null when it names none (the model's own default applies). */
export function claudeEffortChoice(selection: ModelSelection | null | undefined): ClaudeEffortChoice | null {
  const option = selection?.options?.find((entry) => entry.id === "effort");
  const value = typeof option?.value === "string" ? option.value.trim().toLowerCase() : "";
  if (LEVELS.has(value)) return { kind: "level", level: value as EffortLevel };
  if (value === "ultracode") return { kind: "ultracode" };
  if (value === "ultrathink") return { kind: "ultrathink" };
  return null;
}

/**
 * The effort a turn runs at: the selection's own choice, or else the
 * model's default from our catalog. Sending the default explicitly keeps
 * what a picker shows ("Medium") and what runs the same, instead of leaving
 * it to Claude Code's own default for the model, which can differ.
 */
export function effectiveEffortChoice(selection: ModelSelection | null | undefined): ClaudeEffortChoice | null {
  const chosen = claudeEffortChoice(selection);
  if (chosen !== null || !selection?.model) return chosen;
  const model = claudeCatalogModels().find((entry) => entry.slug === selection.model);
  const fallback = model?.efforts.find((effort) => effort.id === "effort")?.choices.find((choice) => choice.isDefault === true)?.id;
  return fallback === undefined ? null : claudeEffortChoice({ ...selection, options: [{ id: "effort", value: fallback }] });
}

/**
 * What a choice sets for the whole session, as a comparable key: the level,
 * `ultracode`, or null for a choice that leaves the session as it is.
 */
export function sessionEffortKey(choice: ClaudeEffortChoice | null): string | null {
  if (choice === null || choice.kind === "ultrathink") return null;
  return choice.kind === "ultracode" ? "ultracode" : choice.level;
}

/** The part of a choice that sticks to the session: `ultrathink` is per turn, so none. */
export function sessionWideEffort(choice: ClaudeEffortChoice | null): ClaudeEffortChoice | null {
  return choice?.kind === "ultrathink" ? null : choice;
}

/** `query()` options that start a session at this choice. */
export function spawnEffortOptions(choice: ClaudeEffortChoice | null): { effort?: EffortLevel; settings?: { ultracode: true } } {
  if (choice === null || choice.kind === "ultrathink") return {};
  if (choice.kind === "ultracode") return { effort: "xhigh", settings: { ultracode: true } };
  return { effort: choice.level };
}

/** The flag settings that move a running session to this choice. */
export function effortFlagSettings(choice: ClaudeEffortChoice, previousKey: string | null): FlagSettings {
  if (choice.kind === "ultracode") return { effortLevel: "xhigh", ultracode: true };
  if (choice.kind === "ultrathink") return {};
  // Leaving ultracode has to clear it: a new level alone keeps its orchestration on.
  return previousKey === "ultracode" ? { effortLevel: choice.level, ultracode: null } : { effortLevel: choice.level };
}

/** The prompt as Claude should read it: `ultrathink` rides along on that turn only. */
export function promptForEffort(prompt: string, choice: ClaudeEffortChoice | null): string {
  return choice?.kind === "ultrathink" ? `${prompt}\n\n${ULTRATHINK_KEYWORD}` : prompt;
}
