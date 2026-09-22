import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  codexAccountTypeOf,
  codexAppServerArgs,
  codexSignedOutMessage,
  isCodexAuthErrorText,
  normalizeCodexSettings,
  resolveCodexHome,
  tokenizeLaunchArgs,
} from "../config.js";

describe("codex config", () => {
  it("normalizes settings with codex defaults", () => {
    expect(normalizeCodexSettings()).toMatchObject({
      binaryPath: "codex",
      homePath: "",
      launchArgs: "",
    });
  });

  it("tokenizes launch args with quotes and escapes", () => {
    expect(tokenizeLaunchArgs("")).toEqual([]);
    expect(tokenizeLaunchArgs("--config foo=bar --enable x")).toEqual([
      "--config",
      "foo=bar",
      "--enable",
      "x",
    ]);
    expect(tokenizeLaunchArgs('--config "a b" --config=\'c d\'')).toEqual([
      "--config",
      "a b",
      "--config=c d",
    ]);
    expect(tokenizeLaunchArgs("--config a\\ b")).toEqual(["--config", "a b"]);
  });

  it("builds app-server argv with env override", () => {
    expect(codexAppServerArgs("--sandbox read-only", {})).toEqual([
      "app-server",
      "--sandbox",
      "read-only",
    ]);
    expect(codexAppServerArgs("", { T3CODE_CODEX_LAUNCH_ARGS: "--config x=1" })).toEqual([
      "app-server",
      "--config",
      "x=1",
    ]);
    expect(codexAppServerArgs()).toEqual(["app-server"]);
  });

  it("resolves the home from settings, CODEX_HOME, then ~/.codex", () => {
    expect(resolveCodexHome("/tmp/cdx", {})).toBe(path.resolve("/tmp/cdx"));
    expect(resolveCodexHome("", { CODEX_HOME: "/tmp/from-env" })).toBe(path.resolve("/tmp/from-env"));
    expect(resolveCodexHome("", {}).endsWith(".codex")).toBe(true);
  });

  it("detects auth errors and points at codex login", () => {
    expect(isCodexAuthErrorText("Not logged in")).toBe(true);
    expect(isCodexAuthErrorText("missing auth.json")).toBe(true);
    expect(isCodexAuthErrorText("Request failed with 401")).toBe(true);
    expect(isCodexAuthErrorText("rate limited")).toBe(false);
    expect(codexSignedOutMessage({ home: "/tmp/cdx" })).toContain("codex login");
  });

  it("classifies account types", () => {
    expect(codexAccountTypeOf({ accountType: "chatgpt" })).toBe("chatgpt");
    expect(codexAccountTypeOf({ type: "apiKey" })).toBe("apiKey");
    expect(codexAccountTypeOf({ accountType: "amazon_bedrock" })).toBe("amazonBedrock");
    expect(codexAccountTypeOf({})).toBe("unknown");
    expect(codexAccountTypeOf(null)).toBe("unknown");
  });
});
