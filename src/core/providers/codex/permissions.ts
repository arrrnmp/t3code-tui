/**
 * Codex permission mapping. Static per-turn policy comes from the runtime
 * mode (`CodexSessionRuntime.ts:509-581`): `approval-required` locks to
 * untrusted/read-only, `auto(-accept-edits)` runs on-request/workspace-write,
 * `full-access` goes never/danger-full-access. Server-driven approval
 * round-trips (commandExecution/fileChange/permissions/elicitation/userInput)
 * park until answered; decisions are accept/decline/cancel (+
 * acceptForSession, to which acceptAlways downgrades).
 */
import type { RuntimeMode } from "../../types.js";

export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";
export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexStaticPolicy {
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandbox: CodexSandbox;
}

const STATIC_POLICIES: Record<RuntimeMode, CodexStaticPolicy> = {
  "approval-required": { approvalPolicy: "untrusted", sandbox: "read-only" },
  "auto-accept-edits": { approvalPolicy: "on-request", sandbox: "workspace-write" },
  auto: { approvalPolicy: "on-request", sandbox: "workspace-write" },
  "full-access": { approvalPolicy: "never", sandbox: "danger-full-access" },
};

export function staticPolicyForRuntimeMode(runtimeMode: RuntimeMode): CodexStaticPolicy {
  return STATIC_POLICIES[runtimeMode];
}

export type CodexApprovalKind =
  | "command_execution"
  | "file_change"
  | "permissions"
  | "elicitation"
  | "user_input"
  | "dynamic_tool_call";

export function approvalKindForMethod(method: string): CodexApprovalKind | null {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command_execution";
    case "item/fileChange/requestApproval":
      return "file_change";
    case "item/permissions/requestApproval":
      return "permissions";
    case "mcpServer/elicitation/request":
      return "elicitation";
    case "item/tool/requestUserInput":
      return "user_input";
    case "item/tool/call":
      return "dynamic_tool_call";
    default:
      return null;
  }
}
