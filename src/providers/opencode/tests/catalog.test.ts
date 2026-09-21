import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  effortValuesOf,
  isFreeModel,
  loadModelsDevCatalog,
  parseModelsDevCatalog,
  presentApiKeyEnvs,
  readStoredAuthTypes,
  resolveModelsDevUrl,
} from "../catalog.js";

const FIXTURE = {
  anthropic: {
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    models: {
      "anthropic/claude-opus-4-6": {
        name: "Claude Opus 4.6",
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }, { type: "toggle" }],
        cost: { input: 5, output: 25 },
      },
      "anthropic/plain": { name: "Plain", cost: { input: 0, output: 0 } },
    },
  },
  broken: null,
  noname: { env: [], models: {} },
};

describe("parseModelsDevCatalog", () => {
  it("parses providers defensively", () => {
    const catalog = parseModelsDevCatalog(FIXTURE);
    expect(catalog.map((provider) => provider.id).sort()).toEqual(["anthropic", "noname"]);
    const anthropic = catalog.find((provider) => provider.id === "anthropic");
    expect(anthropic?.name).toBe("Anthropic");
    expect(anthropic?.env).toEqual(["ANTHROPIC_API_KEY"]);
    expect(anthropic?.models.map((model) => model.id).sort()).toEqual([
      "anthropic/claude-opus-4-6",
      "anthropic/plain",
    ]);
  });

  it("returns empty for non-objects", () => {
    expect(parseModelsDevCatalog(null)).toEqual([]);
    expect(parseModelsDevCatalog("nope")).toEqual([]);
    expect(parseModelsDevCatalog([])).toEqual([]);
  });
});

describe("effortValuesOf", () => {
  it("enumerates the first effort option only", () => {
    const catalog = parseModelsDevCatalog(FIXTURE);
    const opus = catalog.flatMap((provider) => provider.models).find((model) => model.id === "anthropic/claude-opus-4-6");
    expect(opus && effortValuesOf(opus)).toEqual(["low", "medium", "high"]);
    const plain = catalog.flatMap((provider) => provider.models).find((model) => model.id === "anthropic/plain");
    expect(plain && effortValuesOf(plain)).toEqual([]);
  });
});

describe("isFreeModel", () => {
  it("matches opencode's zero-input-cost rule and never missing data", () => {
    const catalog = parseModelsDevCatalog(FIXTURE);
    const models = catalog.flatMap((provider) => provider.models);
    expect(isFreeModel(models.find((model) => model.id === "anthropic/plain")!)).toBe(true);
    expect(isFreeModel(models.find((model) => model.id === "anthropic/claude-opus-4-6")!)).toBe(false);
    expect(isFreeModel({ id: "x", name: "X", reasoningOptions: [], cost: null })).toBe(false);
  });
});

describe("presentApiKeyEnvs", () => {
  it("reports set env names only", () => {
    const catalog = parseModelsDevCatalog(FIXTURE);
    const anthropic = catalog.find((provider) => provider.id === "anthropic");
    expect(anthropic && presentApiKeyEnvs(anthropic, { ANTHROPIC_API_KEY: "k" })).toEqual(["ANTHROPIC_API_KEY"]);
    expect(anthropic && presentApiKeyEnvs(anthropic, {})).toEqual([]);
    expect(anthropic && presentApiKeyEnvs(anthropic, { ANTHROPIC_API_KEY: "  " })).toEqual([]);
  });
});

describe("resolveModelsDevUrl", () => {
  it("prefers the env override", () => {
    expect(resolveModelsDevUrl({})).toBe("https://models.opencode.ai");
    expect(resolveModelsDevUrl({ OPENCODE_MODELS_URL: "https://mirror.example" })).toBe("https://mirror.example");
  });
});

describe("readStoredAuthTypes", () => {
  it("prefers inline content, then file, then empty", () => {
    expect(
      readStoredAuthTypes({ OPENCODE_AUTH_CONTENT: JSON.stringify({ xai: { type: "oauth" } }) }),
    ).toEqual({ xai: "oauth" });
    expect(readStoredAuthTypes({}, () => null)).toEqual({});
    expect(readStoredAuthTypes({}, () => "not json")).toEqual({});
    expect(
      readStoredAuthTypes({}, () => JSON.stringify({ openai: { type: "oauth" }, odd: { nope: 1 } })),
    ).toEqual({ openai: "oauth" });
  });
});

describe("loadModelsDevCatalog", () => {
  const text = JSON.stringify(FIXTURE);

  function tmpCache(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-models-"));
    return path.join(dir, "models.json");
  }

  it("uses a fresh cache without fetching", async () => {
    const cachePath = tmpCache();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, text);
    const loaded = await loadModelsDevCatalog({
      cachePath,
      snapshotText: null,
      fetchImpl: (async () => {
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    expect(loaded.source).toBe("cache");
    expect(loaded.catalog.length).toBe(2);
  });

  it("fetches live when the cache is stale and caches the result", async () => {
    const cachePath = tmpCache();
    const loaded = await loadModelsDevCatalog({
      cachePath,
      snapshotText: null,
      fetchImpl: (async () => ({ ok: true, text: async () => text }) as Response) as typeof fetch,
    });
    expect(loaded.source).toBe("live");
    expect(loaded.catalog.length).toBe(2);
    expect(fs.existsSync(cachePath)).toBe(true);
  });

  it("falls back to the snapshot when live fails", async () => {
    const loaded = await loadModelsDevCatalog({
      cachePath: path.join(os.tmpdir(), "t3code-models-missing", "models.json"),
      snapshotText: text,
      fetchImpl: (async () => ({ ok: false, status: 500, text: async () => "" }) as Response) as typeof fetch,
    });
    expect(loaded.source).toBe("snapshot");
    expect(loaded.catalog.length).toBe(2);
  });

  it("reports empty when everything fails", async () => {
    const loaded = await loadModelsDevCatalog({
      cachePath: path.join(os.tmpdir(), "t3code-models-missing", "models.json"),
      snapshotText: "garbage",
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(loaded).toEqual({ catalog: [], source: "empty" });
  });
});
