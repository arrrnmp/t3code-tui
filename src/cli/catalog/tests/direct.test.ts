import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { selectModel, selectProvider } from "../catalog.js";
import { buildDirectProviders, CODEX_REASONING_EFFORTS, type NativeModelLister } from "../direct.js";

function fakeLister(models: Array<{ id: string }>, failWith?: string): () => NativeModelLister {
  const lister: NativeModelLister = {
    start: async () => undefined,
    models: async () => {
      if (failWith) throw new Error(failWith);
      return models;
    },
    stop: async () => undefined,
  };
  return () => lister;
}

function binDir(names: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-bin-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n");
  return dir;
}

const MODELS_DEV = {
  catalog: [
    {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: [
        { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6", reasoningOptions: [{ type: "effort", values: ["low", "high"] }] },
        { id: "anthropic/plain", name: "Plain", reasoningOptions: [] },
      ],
    },
  ],
  source: "snapshot" as const,
};

function tmpStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "t3code-catalog-"));
}

describe("buildDirectProviders", () => {
  it("marks missing binaries as not installed without spawning anything", async () => {
    const providers = await buildDirectProviders({
      env: { PATH: "/nonexistent" },
      storeRoot: tmpStore(),
      modelsDev: async () => MODELS_DEV,
    });
    for (const instanceId of ["claudeAgent", "codex", "grok"]) {
      const provider = providers.find((entry) => entry.instanceId === instanceId);
      expect(provider?.installed).toBe(false);
      expect(provider?.enabled).toBe(false);
      expect(provider?.status).toBe("not installed");
    }
    expect(providers.find((entry) => entry.instanceId === "codex")?.models).toEqual([]);
    const opencode = providers.find((entry) => entry.instanceId === "opencode");
    expect(opencode?.installed).toBe(false);
    expect(opencode?.enabled).toBe(false);
    expect(opencode?.models.map((model) => model.slug)).toEqual([
      "anthropic/claude-opus-4-6",
      "anthropic/plain",
    ]);
    expect(opencode?.status).toBe("not installed");
  });

  it("lists pinned claude models with effort descriptors", async () => {
    const dir = binDir(["claude"]);
    const providers = await buildDirectProviders({
      env: { PATH: dir },
      storeRoot: tmpStore(),
      modelsDev: async () => ({ catalog: [], source: "live" }),
    });
    const claude = providers.find((entry) => entry.instanceId === "claudeAgent");
    expect(claude?.enabled).toBe(true);
    expect(claude?.models.length).toBeGreaterThan(0);
    const opus = claude?.models.find((model) => model.slug === "claude-opus-4-6");
    expect(opus?.efforts.map((effort) => effort.id)).toContain("effort");
  });

  it("lists native models live and attaches codex efforts", async () => {
    const dir = binDir(["codex", "grok", "claude", "opencode"]);
    const providers = await buildDirectProviders({
      env: { PATH: dir },
      listers: {
        codex: fakeLister([{ id: "gpt-5.4" }]),
        grok: fakeLister([{ id: "grok-4-1" }]),
      },
      storeRoot: tmpStore(),
      modelsDev: async () => ({ catalog: [], source: "live" }),
    });
    const codex = providers.find((entry) => entry.instanceId === "codex");
    expect(codex?.authStatus).toBe("authenticated");
    expect(codex?.models.map((model) => model.slug)).toEqual(["gpt-5.4"]);
    expect(codex?.models[0]?.efforts[0]?.choices.map((choice) => choice.id)).toEqual([...CODEX_REASONING_EFFORTS]);
    const grok = providers.find((entry) => entry.instanceId === "grok");
    expect(grok?.models.map((model) => model.slug)).toEqual(["grok-4-1"]);
    expect(grok?.models[0]?.efforts).toEqual([]);
  });

  it("degrades native failures into status without hiding other providers", async () => {
    const dir = binDir(["codex", "grok"]);
    const providers = await buildDirectProviders({
      env: { PATH: dir },
      listers: {
        codex: fakeLister([], "Not logged in. Run codex login"),
        grok: fakeLister([{ id: "grok-4-1" }]),
      },
      storeRoot: tmpStore(),
      modelsDev: async () => ({ catalog: [], source: "live" }),
    });
    const codex = providers.find((entry) => entry.instanceId === "codex");
    expect(codex?.models).toEqual([]);
    expect(codex?.authStatus).toBe("unauthenticated");
    expect(codex?.enabled).toBe(false);
    expect(codex?.status).toContain("codex login");
    expect(providers.find((entry) => entry.instanceId === "grok")?.models.length).toBe(1);
  });

  it("merges all models.dev providers into one T3-addressed opencode instance", async () => {
    const live = await buildDirectProviders({
      env: {
        PATH: binDir(["opencode"]),
        ANTHROPIC_API_KEY: "k",
        OPENCODE_AUTH_CONTENT: JSON.stringify({ anthropic: { type: "oauth" } }),
      },
      storeRoot: tmpStore(),
      modelsDev: async () => MODELS_DEV,
    });
    const opencode = live.filter((entry) => entry.instanceId === "opencode");
    expect(opencode).toHaveLength(1);
    const entry = opencode[0]!;
    expect(entry.driver).toBe("opencode");
    expect(entry.installed).toBe(true);
    expect(entry.enabled).toBe(true);
    expect(entry.status).toBe("models.dev snapshot");
    expect(entry.authStatus).toBe("oauth");
    // Source ids keep their slash; bare ids gain the provider prefix.
    expect(entry.models.map((model) => model.slug)).toEqual(["anthropic/claude-opus-4-6", "anthropic/plain"]);
    expect(entry.models[0]?.efforts[0]?.choices.map((choice) => choice.id)).toEqual(["low", "high"]);
    expect(entry.models[1]?.efforts).toEqual([]);

    const keyed = await buildDirectProviders({
      env: { PATH: binDir(["opencode"]), ANTHROPIC_API_KEY: "k" },
      storeRoot: tmpStore(),
      modelsDev: async () => MODELS_DEV,
    });
    expect(keyed.find((entry) => entry.instanceId === "opencode")?.authStatus).toBe("api-key");

    const bare = await buildDirectProviders({
      env: { PATH: binDir(["opencode"]) },
      storeRoot: tmpStore(),
      modelsDev: async () => MODELS_DEV,
    });
    const bareEntry = bare.find((entry) => entry.instanceId === "opencode");
    expect(bareEntry?.authStatus).toBeNull();
    expect(bareEntry?.enabled).toBe(true);
  });

  it("prefixes bare source ids with their provider", async () => {
    const providers = await buildDirectProviders({
      env: { PATH: binDir(["opencode"]) },
      storeRoot: tmpStore(),
      modelsDev: async () => ({
        catalog: [
          { id: "zen", name: "Zen", env: ["ZEN_KEY"], models: [{ id: "bare-model", name: "Bare", reasoningOptions: [] }] },
        ],
        source: "live" as const,
      }),
    });
    const entry = providers.find((item) => item.instanceId === "opencode");
    expect(entry?.models.map((model) => model.slug)).toEqual(["zen/bare-model"]);
  });

  it("keeps selectProvider/selectModel error codes on direct output", async () => {
    const providers = await buildDirectProviders({
      env: { PATH: "/nonexistent" },
      storeRoot: tmpStore(),
      modelsDev: async () => MODELS_DEV,
    });
    expect(() => selectProvider(providers, "nope")).toThrowError(expect.objectContaining({ code: "PROVIDER_NOT_FOUND" }));
    const opencode = selectProvider(providers, "opencode");
    expect(() => selectModel(opencode, "nope")).toThrowError(expect.objectContaining({ code: "MODEL_NOT_FOUND" }));
    expect(selectModel(opencode, "anthropic/plain").name).toBe("Plain");
  });
});
