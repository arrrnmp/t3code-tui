import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultParserAssetPaths } from "../parsers.js";

const syntaxDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(syntaxDir, "..", "..", "..");
const configured = JSON.parse(readFileSync(path.join(repoRoot, "parsers-config.json"), "utf8")) as {
  parsers: Array<{ filetype: string }>;
};

describe("vendored tree-sitter parsers", () => {
  it("ships a wasm grammar and query file per parser", () => {
    expect(defaultParserAssetPaths.length).toBeGreaterThan(0);
    expect(defaultParserAssetPaths.length % 2).toBe(0);
    for (const relative of defaultParserAssetPaths) {
      const absolute = path.join(syntaxDir, relative);
      const stat = statSync(absolute);
      expect(stat.isFile()).toBe(true);
      if (relative.endsWith(".wasm")) expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("matches parsers-config.json so regeneration cannot drift silently", () => {
    const fromAssets = [...new Set(defaultParserAssetPaths.map((asset) => asset.split("/")[0]))].sort();
    const fromConfig = configured.parsers.map((parser) => parser.filetype).sort();
    expect(fromConfig.length).toBeGreaterThan(0);
    expect(fromAssets).toEqual(fromConfig);
  });
});
