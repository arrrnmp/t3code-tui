import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  effortValuesOf,
  isFreeModel,
  isFreeOpencodeModel,
  loadModelsDevCatalog,
  parseModelsDevCatalog,
  presentApiKeyEnvs,
  AUTH_LIST_CACHE_TTL_MS,
  authTypesOf,
  clearStoredAuthCache,
  readStoredAuthTypes,
  sameProviderId,
  storedAuthTypeFor,
  resolveModelsDevUrl,
} from "../catalog.js";
import { tempDir } from "../../../testing/tmp.js";

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

describe("isFreeOpencodeModel", () => {
  it("bypasses only free models of the opencode provider (upstream public-key rule)", async () => {
    expect(await isFreeOpencodeModel("opencode", "muse-spark-1.3-contributor-free")).toBe(true);
    expect(await isFreeOpencodeModel("OpenCode", "muse-spark-1.3-contributor-free")).toBe(true);
    expect(await isFreeOpencodeModel("opencode", "claude-sonnet-4-6")).toBe(false);
    expect(await isFreeOpencodeModel("opencode", "no-such-model")).toBe(false);
    expect(await isFreeOpencodeModel("anthropic", "anything-free")).toBe(false);
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
  const LIST = JSON.stringify([
    { id: "anthropic", name: "Anthropic", connections: [{ type: "key" }] },
    { id: "openai", name: "OpenAI", connections: [{ type: "env", name: "OPENAI_API_KEY" }, { type: "oauth" }] },
    { id: "xai", name: "xAI", connections: [{ type: "env", name: "XAI_API_KEY" }] },
    { id: "azure", name: "Azure", connections: [] },
    { id: "odd", connections: "nope" },
  ]);

  it("maps v2 connection types onto api / oauth / env", async () => {
    expect(await readStoredAuthTypes({}, { run: async () => LIST, fresh: true })).toEqual({
      anthropic: "api",
      openai: "oauth",
      xai: "env",
    });
  });

  it("reads the integration API's credential/env connections the same way", async () => {
    expect(
      authTypesOf([
        { id: "openai", name: "OpenAI", methods: [], connections: [{ type: "credential", id: "c1", label: "x", method: "oauth" }] },
        { id: "anthropic", name: "A", methods: [], connections: [{ type: "env", name: "ANTHROPIC_API_KEY" }, { type: "credential", id: "c2", label: "y", method: "key" }] },
        { id: "none", name: "N", methods: [], connections: [] },
      ]),
    ).toEqual({ openai: "oauth", anthropic: "api" });
  });

  it("runs the CLI with --standalone, asynchronously, through the given binary", async () => {
    const dir = tempDir("moxen-auth-list-");
    const log = path.join(dir, "args.log");
    const bin = path.join(dir, "fake-opencode");
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@" > "${log}"\necho '[{"id":"xai","connections":[{"type":"key"}]}]'\n`, { mode: 0o755 });
    const pending = readStoredAuthTypes(process.env, { binaryPath: bin, fresh: true });
    // Not spawnSync: the promise is returned before the child has been read.
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual({ xai: "api" });
    expect(fs.readFileSync(log, "utf8").trim()).toBe("auth list --format json --standalone");
  });

  it("degrades to empty on failure, bad JSON, or a wrong shape", async () => {
    expect(await readStoredAuthTypes({}, { run: async () => null, fresh: true })).toEqual({});
    expect(await readStoredAuthTypes({}, { run: async () => "not json", fresh: true })).toEqual({});
    expect(await readStoredAuthTypes({}, { run: async () => "{}", fresh: true })).toEqual({});
  });

  it("no longer reads OPENCODE_AUTH_CONTENT", async () => {
    const env = { OPENCODE_AUTH_CONTENT: JSON.stringify({ xai: { type: "oauth" } }) };
    expect(await readStoredAuthTypes(env, { run: async () => "[]", fresh: true })).toEqual({});
  });

  it("passes the configured binary and caches per binary for the TTL", async () => {
    clearStoredAuthCache();
    const calls: string[] = [];
    let clock = 1_000;
    const options = {
      binaryPath: "/opt/oc",
      now: () => clock,
      run: async (binary: string) => {
        calls.push(binary);
        return LIST;
      },
    };
    await readStoredAuthTypes({}, options);
    await readStoredAuthTypes({}, options);
    expect(calls).toEqual(["/opt/oc"]);
    clock += AUTH_LIST_CACHE_TTL_MS + 1;
    await readStoredAuthTypes({}, options);
    expect(calls).toEqual(["/opt/oc", "/opt/oc"]);
    clearStoredAuthCache();
  });
});

describe("provider id aliases", () => {
  it("treats the v1 and v2 spellings as one provider", () => {
    expect(sameProviderId("azure-cognitive-services", "azure")).toBe(true);
    expect(sameProviderId("google-vertex-anthropic", "Google-Vertex")).toBe(true);
    expect(sameProviderId("azure", "openai")).toBe(false);
    expect(storedAuthTypeFor({ azure: "api" }, "azure-cognitive-services")).toBe("api");
    expect(storedAuthTypeFor({ "google-vertex-anthropic": "oauth" }, "google-vertex")).toBe("oauth");
    expect(storedAuthTypeFor({}, "azure")).toBeUndefined();
  });
});

describe("loadModelsDevCatalog", () => {
  const text = JSON.stringify(FIXTURE);

  function tmpCache(): string {
    const dir = tempDir("moxen-models-");
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
      cachePath: path.join(os.tmpdir(), "moxen-models-missing", "models.json"),
      snapshotText: text,
      fetchImpl: (async () => ({ ok: false, status: 500, text: async () => "" }) as Response) as typeof fetch,
    });
    expect(loaded.source).toBe("snapshot");
    expect(loaded.catalog.length).toBe(2);
  });

  it("reports empty when everything fails", async () => {
    const loaded = await loadModelsDevCatalog({
      cachePath: path.join(os.tmpdir(), "moxen-models-missing", "models.json"),
      snapshotText: "garbage",
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(loaded).toEqual({ catalog: [], source: "empty" });
  });
});
