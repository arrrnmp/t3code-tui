import { describe, expect, it } from "vitest";

import type { ProviderSummary } from "../../../core/catalog/summary.js";
import { ago, checksGlance, handOffTarget, openRequestPrompt } from "../gitpanel.js";

function provider(instanceId: string, driver: string, extra: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    instanceId,
    driver,
    displayName: instanceId,
    enabled: true,
    installed: true,
    status: null,
    authStatus: null,
    models: [
      { slug: `${driver}-small`, name: `${driver} small`, isCustom: false, isDefault: false, isHidden: false, efforts: [] },
      { slug: `${driver}-big`, name: `${driver} big`, isCustom: false, isDefault: true, isHidden: false, efforts: [] },
    ],
    supportedRuntimeModes: null,
    usageLimits: null,
    skills: [],
    ...extra,
  };
}

describe("openRequestPrompt", () => {
  it("asks for a draft through the forge's own CLI, and tells a cold agent to read the branch first", () => {
    const warm = openRequestPrompt({ kind: "github", draft: true, branch: "feat/x", cold: false });
    expect(warm).toContain("Open a draft pull request for `feat/x`.");
    expect(warm).toContain("`gh pr create --draft`");
    expect(warm).not.toContain("without the conversation");
    const cold = openRequestPrompt({ kind: "gitlab", draft: false, branch: null, cold: true });
    expect(cold).toContain("Open a merge request for the current branch.");
    expect(cold).toContain("`glab mr create`");
    expect(cold).toContain("without the conversation");
  });
});

describe("handOffTarget", () => {
  const full = { checkedAt: "", unavailable: null, windows: [{ id: "s", kind: "session", label: "Session", usedPercent: 100, resetsAt: null }] };

  it("skips the thread's own provider and any other at its limit, and takes the default model", () => {
    const providers = [provider("claudeAgent", "claude"), provider("codexA", "codex"), provider("grokA", "grok")];
    expect(handOffTarget(providers, "claudeAgent", { codex: full })).toEqual({ instanceId: "grokA", model: "grok-big", label: "grok big" });
    expect(handOffTarget(providers, "claudeAgent", {})?.instanceId).toBe("codexA");
  });

  it("finds nobody when every other provider is disabled or out", () => {
    expect(handOffTarget([provider("claudeAgent", "claude"), provider("codexA", "codex", { enabled: false })], "claudeAgent", {})).toBeNull();
  });
});

describe("checksGlance", () => {
  it("reads failures first, then running, then all green", () => {
    expect(checksGlance({ passed: 16, failed: 2, pending: 0 })).toEqual({ text: "✗ 16/18", tone: "failed" });
    expect(checksGlance({ passed: 15, failed: 0, pending: 3 })).toEqual({ text: "● 15/18", tone: "pending" });
    expect(checksGlance({ passed: 18, failed: 0, pending: 0 })).toEqual({ text: "✓ 18/18", tone: "passed" });
    expect(checksGlance(null)).toBeNull();
  });
});

describe("ago", () => {
  it("words an age the way the forge does", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(ago("2026-09-27T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-09-27T11:00:00Z", now)).toBe("1 hour ago");
    expect(ago("2026-09-26T10:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-07-01T10:00:00Z", now)).toBe("2 months ago");
  });
});
