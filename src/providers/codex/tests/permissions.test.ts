import { describe, expect, it } from "vitest";

import { approvalKindForMethod, staticPolicyForRuntimeMode } from "../permissions.js";

describe("codex permissions", () => {
  it("maps runtime modes to static policies", () => {
    expect(staticPolicyForRuntimeMode("approval-required")).toEqual({
      approvalPolicy: "untrusted",
      sandbox: "read-only",
    });
    expect(staticPolicyForRuntimeMode("auto-accept-edits")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(staticPolicyForRuntimeMode("auto")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(staticPolicyForRuntimeMode("full-access")).toEqual({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
  });

  it("classifies approval methods", () => {
    expect(approvalKindForMethod("item/commandExecution/requestApproval")).toBe("command_execution");
    expect(approvalKindForMethod("item/fileChange/requestApproval")).toBe("file_change");
    expect(approvalKindForMethod("item/permissions/requestApproval")).toBe("permissions");
    expect(approvalKindForMethod("mcpServer/elicitation/request")).toBe("elicitation");
    expect(approvalKindForMethod("item/tool/requestUserInput")).toBe("user_input");
    expect(approvalKindForMethod("item/tool/call")).toBe("dynamic_tool_call");
    expect(approvalKindForMethod("turn/started")).toBeNull();
  });
});
