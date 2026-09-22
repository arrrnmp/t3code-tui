/**
 * Claude permission mapping. Modes map to SDK `permissionMode`
 * (`ClaudeAdapter.ts:4879-4891`): `auto-accept-edits→acceptEdits`,
 * `auto→auto`, `full-access→bypassPermissions` (+
 * `allowDangerouslySkipPermissions`); `approval-required` stays `default`.
 * Launch-arg permission flags fold into the mode rather than passing
 * through. `AskUserQuestion` always surfaces; `ExitPlanMode` is captured
 * as a proposed plan then denied.
 */
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

import type { RuntimeMode } from "../../types.js";

export type ToolClassification =
  | "question"
  | "plan-exit"
  | "file-read"
  | "file-change"
  | "command-execution"
  | "dynamic-tool-call"
  | "other";

const FILE_READ_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
]);

const FILE_CHANGE_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "NotebookEdit"]);

const COMMAND_TOOLS: ReadonlySet<string> = new Set(["Bash", "BashOutput", "KillShell"]);

export function classifyToolUse(toolName: string): ToolClassification {
  if (toolName === "AskUserQuestion") return "question";
  if (toolName === "ExitPlanMode") return "plan-exit";
  if (FILE_READ_TOOLS.has(toolName)) return "file-read";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "file-change";
  if (COMMAND_TOOLS.has(toolName)) return "command-execution";
  if (toolName.startsWith("mcp__")) return "dynamic-tool-call";
  return "other";
}

const RUNTIME_MODE_TO_PERMISSION: Record<Exclude<RuntimeMode, "approval-required">, PermissionMode> = {
  "auto-accept-edits": "acceptEdits",
  auto: "auto",
  "full-access": "bypassPermissions",
};

export function permissionModeForRuntimeMode(
  runtimeMode: RuntimeMode,
  launchOverride?: { permissionMode?: string | null; skipPermissions?: boolean },
): PermissionMode {
  if (launchOverride?.permissionMode) {
    const mode = launchOverride.permissionMode;
    if (mode === "default" || mode === "acceptEdits" || mode === "bypassPermissions" || mode === "plan" || mode === "auto") {
      return mode;
    }
  }
  if (launchOverride?.skipPermissions === true) return "bypassPermissions";
  if (runtimeMode === "approval-required") return "default";
  return RUNTIME_MODE_TO_PERMISSION[runtimeMode];
}

/** Only `bypassPermissions` needs the SDK's dangerous-skip flag. */
export function needsAllowDangerouslySkipPermissions(mode: PermissionMode): boolean {
  return mode === "bypassPermissions";
}

/** Session-scoped allow key: tool name only, never inherited by subagents. */
export function sessionAllowKey(toolName: string): string {
  return `tool:${toolName}`;
}
