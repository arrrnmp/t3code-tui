import { describe, expect, it } from "vitest";

import {
  buildServerConfigContent,
  compareSemver,
  isOpencodeAuthErrorText,
  normalizeOpencodeSettings,
  opencodeSignedOutMessage,
  parseSemver,
  resolveSpawnedServerPassword,
  resolveVendoredPluginPaths,
} from "../config.js";

describe("opencode config", () => {
  it("normalizes settings with opencode defaults", () => {
    expect(normalizeOpencodeSettings()).toMatchObject({
      binaryPath: "opencode",
      serverUrl: "",
      serverPassword: "",
      minVersion: "1.14.19",
    });
    expect(normalizeOpencodeSettings({ binaryPath: "  " }).binaryPath).toBe("opencode");
  });

  it("resolves the spawned password from settings then env", () => {
    expect(
      resolveSpawnedServerPassword(normalizeOpencodeSettings({ serverPassword: "s" }), { OPENCODE_SERVER_PASSWORD: "e" }),
    ).toBe("s");
    expect(resolveSpawnedServerPassword(normalizeOpencodeSettings(), { OPENCODE_SERVER_PASSWORD: "e" })).toBe("e");
    expect(resolveSpawnedServerPassword(normalizeOpencodeSettings(), {})).toBe("");
  });

  it("merges plugin paths without clobbering user config", () => {
    const merged = JSON.parse(buildServerConfigContent(JSON.stringify({ theme: "dark" }), ["/p/xai.ts"]));
    expect(merged).toMatchObject({ theme: "dark", plugin: ["/p/xai.ts"] });
    const deduped = JSON.parse(buildServerConfigContent(JSON.stringify({ plugin: ["/p/xai.ts"] }), ["/p/xai.ts"]));
    expect(deduped.plugin).toEqual(["/p/xai.ts"]);
    const replaced = JSON.parse(buildServerConfigContent("corrupt{", ["/p/xai.ts"]));
    expect(replaced).toMatchObject({ plugin: ["/p/xai.ts"] });
  });

  it("resolves vendored plugin paths next to the built sources", () => {
    const paths = resolveVendoredPluginPaths();
    expect(paths.length).toBe(2);
    expect(paths[0]?.endsWith("plugins/xai.ts") ?? paths[0]?.endsWith("plugins/xai.js")).toBe(true);
    expect(paths[1]?.endsWith("plugins/codex.ts") ?? paths[1]?.endsWith("plugins/codex.js")).toBe(true);
  });

  it("compares semver with unparseable reading as too old", () => {
    expect(parseSemver("v1.18.30")).toEqual([1, 18, 30]);
    expect(parseSemver("nope")).toBeNull();
    expect(compareSemver("1.18.30", "1.14.19")).toBe(1);
    expect(compareSemver("1.14.19", "1.14.19")).toBe(0);
    expect(compareSemver("1.13.0", "1.14.19")).toBe(-1);
    expect(compareSemver("garbage", "1.14.19")).toBe(-1);
  });

  it("detects auth errors and points at opencode auth login", () => {
    expect(isOpencodeAuthErrorText("Request failed with 401")).toBe(true);
    expect(isOpencodeAuthErrorText("unauthorized")).toBe(true);
    expect(isOpencodeAuthErrorText("rate limited, retry later")).toBe(false);
    expect(opencodeSignedOutMessage({ cwd: "/repo" })).toContain("opencode auth login");
  });
});
