import { describe, expect, it } from "vitest";

import {
  grokAcpSpawnArgs,
  GROK_DEFAULT_MODEL_SLUG,
  grokSignedOutMessage,
  isGrokAuthErrorText,
  makeGrokEnv,
  normalizeGrokReasoningEffort,
  normalizeGrokSettings,
  resolveGrokAuthMethod,
  resolveGrokModelId,
} from "../config.js";

describe("grok config", () => {
  it("normalizes settings with grok defaults", () => {
    expect(normalizeGrokSettings()).toMatchObject({ binaryPath: "grok" });
    expect(normalizeGrokSettings({ binaryPath: "  " }).binaryPath).toBe("grok");
  });

  it("builds per-mode spawn argv", () => {
    expect(grokAcpSpawnArgs("approval-required")).toEqual([
      "--permission-mode",
      "default",
      "agent",
      "stdio",
    ]);
    expect(grokAcpSpawnArgs("auto-accept-edits")).toEqual([
      "--permission-mode",
      "acceptEdits",
      "agent",
      "stdio",
    ]);
    expect(grokAcpSpawnArgs("auto")).toEqual(["--permission-mode", "auto", "agent", "stdio"]);
    expect(grokAcpSpawnArgs("full-access")).toEqual(["agent", "--always-approve", "stdio"]);
    expect(grokAcpSpawnArgs(undefined)).toEqual(["agent", "stdio"]);
  });

  it("injects the t3code referrer and switches auth on the api key", () => {
    const env = makeGrokEnv({ OTHER: "1" });
    expect(env.GROK_OAUTH2_REFERRER).toBe("t3code");
    expect(env.OTHER).toBe("1");
    expect(resolveGrokAuthMethod({})).toBe("cached_token");
    expect(resolveGrokAuthMethod({ XAI_API_KEY: "sk-x" })).toBe("xai.api_key");
    expect(resolveGrokAuthMethod({ XAI_API_KEY: "  " })).toBe("cached_token");
  });

  it("keeps grok-build local and validates effort tokens", () => {
    expect(GROK_DEFAULT_MODEL_SLUG).toBe("grok-build");
    expect(resolveGrokModelId(null)).toBeNull();
    expect(resolveGrokModelId("grok-build")).toBeNull();
    expect(resolveGrokModelId("grok-4")).toBe("grok-4");
    expect(normalizeGrokReasoningEffort("high")).toBe("high");
    expect(normalizeGrokReasoningEffort("HIGH!!")).toBeUndefined();
    expect(normalizeGrokReasoningEffort(undefined)).toBeUndefined();
  });

  it("detects auth errors and points at grok login", () => {
    expect(isGrokAuthErrorText("Not logged in")).toBe(true);
    expect(isGrokAuthErrorText("token expired")).toBe(true);
    expect(isGrokAuthErrorText("rate limited")).toBe(false);
    expect(grokSignedOutMessage()).toContain("grok login");
  });
});
