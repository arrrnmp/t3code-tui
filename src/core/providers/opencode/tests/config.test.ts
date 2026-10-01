import { describe, expect, it } from "vitest";

import {
  buildServerConfigContent,
  compareSemver,
  isOpencodeAuthErrorText,
  normalizeOpencodeSettings,
  opencodeSignedOutMessage,
  OPENCODE_SERVER_READY_PATTERN,
  parseSemver,
  resolveSpawnedServerPassword,
} from "../config.js";

describe("opencode config", () => {
  it("normalizes settings with opencode defaults", () => {
    expect(normalizeOpencodeSettings()).toMatchObject({
      binaryPath: "opencode",
      serverUrl: "",
      serverPassword: "",
      minVersion: "2.0.0",
    });
    expect(normalizeOpencodeSettings({ binaryPath: "  " }).binaryPath).toBe("opencode");
  });

  it("resolves the spawned password from settings, then env, then a fresh one", () => {
    const generate = () => "generated";
    expect(
      resolveSpawnedServerPassword(normalizeOpencodeSettings({ serverPassword: "s" }), { OPENCODE_PASSWORD: "p" }, generate),
    ).toBe("s");
    // `OPENCODE_PASSWORD` wins over `OPENCODE_SERVER_PASSWORD`, as on the server.
    expect(
      resolveSpawnedServerPassword(normalizeOpencodeSettings(), { OPENCODE_PASSWORD: "p", OPENCODE_SERVER_PASSWORD: "e" }, generate),
    ).toBe("p");
    expect(resolveSpawnedServerPassword(normalizeOpencodeSettings(), { OPENCODE_SERVER_PASSWORD: "e" }, generate)).toBe("e");
    expect(resolveSpawnedServerPassword(normalizeOpencodeSettings(), { OPENCODE_PASSWORD: "  " }, generate)).toBe("generated");
    // Never empty, never repeated: v2 authenticates every call.
    const first = resolveSpawnedServerPassword(normalizeOpencodeSettings(), {});
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(resolveSpawnedServerPassword(normalizeOpencodeSettings(), {})).not.toBe(first);
  });

  it("finds the server url on v2's ready line", () => {
    expect("server listening on http://127.0.0.1:52341\n".match(OPENCODE_SERVER_READY_PATTERN)?.[1]).toBe(
      "http://127.0.0.1:52341",
    );
    // The v1 `opencode ` prefix is tolerated, not required.
    expect("opencode server listening on http://127.0.0.1:4096\n".match(OPENCODE_SERVER_READY_PATTERN)?.[1]).toBe(
      "http://127.0.0.1:4096",
    );
    // A chunk that ends mid-URL must not resolve with a truncated port.
    expect("server listening on http://127.0.0.1:52".match(OPENCODE_SERVER_READY_PATTERN)).toBeNull();
    expect("server listening on http://127.0.0.1:52".concat("341\n").match(OPENCODE_SERVER_READY_PATTERN)?.[1]).toBe(
      "http://127.0.0.1:52341",
    );
    expect("server password abc".match(OPENCODE_SERVER_READY_PATTERN)).toBeNull();
  });

  it("pins share and update off in the injected config without clobbering the user's other keys", () => {
    expect(JSON.parse(buildServerConfigContent(undefined))).toEqual({ share: "disabled", update: "disable" });
    const merged = JSON.parse(
      buildServerConfigContent(JSON.stringify({ theme: "dark", mcp: { servers: { x: {} } }, share: "auto" })),
    );
    expect(merged).toEqual({ theme: "dark", mcp: { servers: { x: {} } }, share: "disabled", update: "disable" });
    // No plugins and no permissions are injected.
    expect(merged).not.toHaveProperty("plugin");
    expect(merged).not.toHaveProperty("plugins");
    expect(merged).not.toHaveProperty("permissions");
    expect(JSON.parse(buildServerConfigContent("corrupt{"))).toEqual({ share: "disabled", update: "disable" });
    expect(JSON.parse(buildServerConfigContent("[1]"))).toEqual({ share: "disabled", update: "disable" });
  });

  it("compares semver with unparseable reading as too old", () => {
    expect(parseSemver("v1.18.30")).toEqual([1, 18, 30]);
    expect(parseSemver("nope")).toBeNull();
    expect(compareSemver("2.0.19", "2.0.0")).toBe(1);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    expect(compareSemver("1.18.31", "2.0.0")).toBe(-1);
    expect(compareSemver("garbage", "2.0.0")).toBe(-1);
  });

  it("detects auth errors and points at opencode auth login", () => {
    expect(isOpencodeAuthErrorText("Request failed with 401")).toBe(true);
    expect(isOpencodeAuthErrorText("unauthorized")).toBe(true);
    expect(isOpencodeAuthErrorText("rate limited, retry later")).toBe(false);
    const message = opencodeSignedOutMessage({ cwd: "/repo" });
    expect(message).toContain("opencode auth login");
    // v2 ships the ChatGPT and SuperGrok logins itself.
    expect(message).toContain("opencode auth login openai");
    expect(message).toContain("opencode auth login xai");
    expect(message).not.toMatch(/plugin/i);
  });
});
