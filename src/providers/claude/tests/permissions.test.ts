import { describe, expect, it } from "vitest";

import {
  classifyToolUse,
  needsAllowDangerouslySkipPermissions,
  permissionModeForRuntimeMode,
  sessionAllowKey,
} from "../permissions.js";

describe("claude permissions", () => {
  it("maps runtime modes to SDK permission modes", () => {
    expect(permissionModeForRuntimeMode("approval-required")).toBe("default");
    expect(permissionModeForRuntimeMode("auto-accept-edits")).toBe("acceptEdits");
    expect(permissionModeForRuntimeMode("auto")).toBe("auto");
    expect(permissionModeForRuntimeMode("full-access")).toBe("bypassPermissions");
  });

  it("folds launch-arg permission flags into the mode", () => {
    expect(
      permissionModeForRuntimeMode("approval-required", { permissionMode: "plan" }),
    ).toBe("plan");
    expect(permissionModeForRuntimeMode("approval-required", { skipPermissions: true })).toBe(
      "bypassPermissions",
    );
    expect(
      permissionModeForRuntimeMode("full-access", { permissionMode: "bogus" }),
    ).toBe("bypassPermissions");
  });

  it("requires the dangerous-skip flag only for bypass", () => {
    expect(needsAllowDangerouslySkipPermissions("bypassPermissions")).toBe(true);
    expect(needsAllowDangerouslySkipPermissions("default")).toBe(false);
    expect(needsAllowDangerouslySkipPermissions("acceptEdits")).toBe(false);
    expect(needsAllowDangerouslySkipPermissions("auto")).toBe(false);
  });

  it("classifies tool uses for request labels", () => {
    expect(classifyToolUse("AskUserQuestion")).toBe("question");
    expect(classifyToolUse("ExitPlanMode")).toBe("plan-exit");
    expect(classifyToolUse("Read")).toBe("file-read");
    expect(classifyToolUse("Edit")).toBe("file-change");
    expect(classifyToolUse("Bash")).toBe("command-execution");
    expect(classifyToolUse("mcp__server__tool")).toBe("dynamic-tool-call");
    expect(classifyToolUse("Task")).toBe("other");
  });

  it("scopes session allows per tool", () => {
    expect(sessionAllowKey("Bash")).toBe("tool:Bash");
  });
});
