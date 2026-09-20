import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  claudeSignedOutMessage,
  isClaudeAuthErrorText,
  makeClaudeEnv,
  normalizeClaudeSettings,
  parseClaudeLaunchArgs,
  resolveClaudeExecutable,
  resolveClaudeHomePath,
} from "../config.js";

describe("claude config", () => {
  it("normalizes settings with claude defaults", () => {
    expect(normalizeClaudeSettings()).toMatchObject({
      binaryPath: "claude",
      homePath: "",
      launchArgs: [],
      autoCompactWindow: null,
    });
    expect(normalizeClaudeSettings({ binaryPath: "  " }).binaryPath).toBe("claude");
  });

  it("passes the binary through off Windows", () => {
    expect(resolveClaudeExecutable("claude", {}, { platform: "linux" })).toBe("claude");
    expect(resolveClaudeExecutable("/opt/claude", {}, { platform: "darwin" })).toBe("/opt/claude");
  });

  it("follows Windows npm shims to the package entry", () => {
    const files = new Set([
      "C:\\tools\\claude.cmd",
      "C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
    ]);
    const env = { PATH: "C:\\tools", PATHEXT: ".com;.exe;.cmd" };
    expect(
      resolveClaudeExecutable("claude", env, { platform: "win32", isFile: (file) => files.has(file) }),
    ).toBe("C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe");
  });

  it("falls back to cli.js for older Windows packages", () => {
    const files = new Set(["C:\\tools\\claude.cmd", "C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\cli.js"]);
    const env = { PATH: "C:\\tools", PATHEXT: ".com;.exe;.cmd" };
    expect(
      resolveClaudeExecutable("claude", env, { platform: "win32", isFile: (file) => files.has(file) }),
    ).toBe("C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\cli.js");
  });

  it("leaves non-shim Windows binaries alone", () => {
    const files = new Set(["C:\\tools\\claude.exe"]);
    const env = { PATH: "C:\\tools", PATHEXT: ".com;.exe;.cmd" };
    expect(
      resolveClaudeExecutable("claude", env, { platform: "win32", isFile: (file) => files.has(file) }),
    ).toBe("C:\\tools\\claude.exe");
  });

  it("injects CLAUDE_CONFIG_DIR only when homePath is set and never touches HOME", () => {
    const base = { HOME: "/home/user", OTHER: "1" };
    const untouched = makeClaudeEnv({ homePath: "" }, base);
    expect(untouched).toBe(base);

    const isolated = makeClaudeEnv({ homePath: "~/custom-claude" }, base);
    expect(isolated.HOME).toBe("/home/user");
    expect(isolated.CLAUDE_CONFIG_DIR).toContain("custom-claude");
  });

  it("resolves the home path from settings, env, then ~/.claude", () => {
    expect(resolveClaudeHomePath("/tmp/x", {})).toBe(path.resolve("/tmp/x"));
    expect(resolveClaudeHomePath("", { CLAUDE_CONFIG_DIR: "/tmp/inherited" })).toBe(
      path.resolve("/tmp/inherited"),
    );
    expect(resolveClaudeHomePath("", {}).endsWith(".claude")).toBe(true);
  });

  it("folds permission launch args into the mode", () => {
    expect(parseClaudeLaunchArgs([])).toEqual({ permissionMode: null, skipPermissions: false });
    expect(parseClaudeLaunchArgs(["--permission-mode", "plan"])).toEqual({
      permissionMode: "plan",
      skipPermissions: false,
    });
    expect(parseClaudeLaunchArgs(["--dangerously-skip-permissions"])).toEqual({
      permissionMode: null,
      skipPermissions: true,
    });
  });

  it("detects auth errors and points at claude auth login", () => {
    expect(isClaudeAuthErrorText("Not logged in. Run claude auth login")).toBe(true);
    expect(isClaudeAuthErrorText("authentication_failed")).toBe(true);
    expect(isClaudeAuthErrorText("Request failed with 401")).toBe(true);
    expect(isClaudeAuthErrorText("rate limited, retry later")).toBe(false);
    expect(claudeSignedOutMessage({ cwd: "/repo" })).toContain("claude auth login");
  });
});
