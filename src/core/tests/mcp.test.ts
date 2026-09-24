import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeConfig, setConfigValue } from "../config.js";
import { CliError } from "../errors.js";
import { parseMcpServers, redactMcpServers, resolveMcpServers } from "../mcp.js";
import { tempDir } from "../testing/tmp.js";

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (cause) {
    return cause instanceof CliError ? cause.code : "not-a-CliError";
  }
}

describe("mcpServers config", () => {
  it("accepts the .mcp.json shape and infers http from a bare url", () => {
    expect(
      parseMcpServers(
        {
          fs: { command: "npx", args: ["-y", "fs-mcp"], env: { ROOT: "/" } },
          docs: { url: "https://docs.example/mcp", headers: { Authorization: "Bearer x" } },
        },
        "config",
      ),
    ).toEqual({
      fs: { command: "npx", args: ["-y", "fs-mcp"], env: { ROOT: "/" } },
      docs: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer x" } },
    });
  });

  it("refuses names that would break tool prefixes or Codex config paths", () => {
    expect(codeOf(() => parseMcpServers({ "a.b": { command: "x" } }, "config"))).toBe("INVALID_CONFIG");
    expect(codeOf(() => parseMcpServers({ "a b": { command: "x" } }, "config"))).toBe("INVALID_CONFIG");
  });

  it("refuses malformed entries", () => {
    expect(codeOf(() => parseMcpServers({ x: { command: "" } }, "config"))).toBe("INVALID_CONFIG");
    expect(codeOf(() => parseMcpServers({ x: { command: "y", args: [1] } }, "config"))).toBe("INVALID_CONFIG");
    expect(codeOf(() => parseMcpServers({ x: { type: "http", url: "ftp://nope" } }, "config"))).toBe("INVALID_CONFIG");
    expect(codeOf(() => parseMcpServers({ x: { command: "y", env: { K: 1 } } }, "config"))).toBe("INVALID_CONFIG");
    expect(codeOf(() => parseMcpServers({ x: { type: "sse", url: "https://a" } }, "config"))).toBe("INVALID_CONFIG");
    // `null` removes a global server, which only a project file can do.
    expect(codeOf(() => parseMcpServers({ x: null }, "config"))).toBe("INVALID_CONFIG");
  });

  it("survives `config set` of an unrelated key", () => {
    const config = normalizeConfig({ mcpServers: { fs: { command: "npx" } } });
    expect(setConfigValue(config, "runtimeMode", "auto").mcpServers).toEqual({ fs: { command: "npx" } });
  });

  it("stays absent when unset, so existing config output is unchanged", () => {
    expect("mcpServers" in normalizeConfig({})).toBe(false);
    expect("mcpServers" in normalizeConfig({ mcpServers: {} })).toBe(false);
  });

  it("redacts env and header values for display, keeping their keys", () => {
    expect(
      redactMcpServers({
        fs: { command: "npx", env: { TOKEN: "secret" } },
        docs: { type: "http", url: "https://a", headers: { Authorization: "Bearer secret" } },
        bare: { command: "x" },
      }),
    ).toEqual({
      fs: { command: "npx", env: { TOKEN: "<redacted>" } },
      docs: { type: "http", url: "https://a", headers: { Authorization: "<redacted>" } },
      bare: { command: "x" },
    });
  });
});

describe("resolveMcpServers", () => {
  it("layers the project's moxen.json over the config by name, and sorts", async () => {
    const root = tempDir("moxen-mcp-");
    await writeFile(
      path.join(root, "moxen.json"),
      JSON.stringify({ mcpServers: { b: { command: "project-b" }, gone: null } }),
    );
    const servers = await resolveMcpServers(
      { b: { command: "global-b" }, a: { type: "http", url: "https://a" }, gone: { command: "g" } },
      root,
    );
    expect(servers).toEqual([
      { name: "a", type: "http", url: "https://a", headers: {} },
      { name: "b", type: "stdio", command: "project-b", args: [], env: {} },
    ]);
  });

  it("treats a missing project file as declaring nothing, and reports a malformed one", async () => {
    const root = tempDir("moxen-mcp-");
    expect(await resolveMcpServers({ a: { command: "x" } }, root)).toHaveLength(1);
    await writeFile(path.join(root, "moxen.json"), JSON.stringify({ mcpServers: { "bad name": { command: "x" } } }));
    await expect(resolveMcpServers(undefined, root)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });
});
