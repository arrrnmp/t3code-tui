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

describe("buildDirectProviders", () => {
  it("marks missing binaries as not installed without spawning anything", async () => {
    const providers = await buildDirectProviders({
      env: { PATH: "/nonexistent" },
      modelsDev: async () => MODELS_DEV,
    });
    for (const instanceId of ["claude", "codex", "grok"]) {
      const provider = providers.find((entry) => entry.instanceId === instanceId);
      expect(provider?.installed).toBe(false);
      expect(provider?.enabled).toBe(false);
      expect(provider?.status).toBe("not installed");
      expect(provider?.models).toEqual([]);
    }
    const anthropic = providers.find((entry) => entry.instanceId === "opencode/anthropic");
    expect(anthropic?.installed).toBe(false);
    expect(anthropic?.models.map((model) => model.slug)).toEqual([
      "anthropic/claude-opus-4-6",
      "anthropic/plain",
    ]);
    expect(anthropic?.status).toBe("not installed");
  });

  it("lists native models live and attaches codex efforts", async () => {
    const dir = binDir(["codex", "grok", "claude", "opencode"]);
    const providers = await buildDirectProviders({
      env: { PATH: dir },
      listers: {
        codex: fakeLister([{ id: "gpt-5.4" }]),
        grok: fakeLister([{ id: "grok-4-1" }]),
      },
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
      modelsDev: async () => ({ catalog: [], source: "live" }),
    });
    const codex = providers.find((entry) => entry.instanceId === "codex");
    expect(codex?.models).toEqual([]);
    expect(codex?.authStatus).toBe("unauthenticated");
    expect(codex?.status).toContain("codex login");
    expect(providers.find((entry) => entry.instanceId === "grok")?.models.length).toBe(1);
  });

  it("reports stored oauth and env api-key auth on opencode entries", async () => {
    const providers = await buildDirectProviders({
      env: {
        PATH: binDir(["opencode"]),
        ANTHROPIC_API_KEY: "k",
        OPENCODE_AUTH_CONTENT: JSON.stringify({ anthropic: { type: "oauth" } }),
      },
      modelsDev: async () => MODELS_DEV,
    });
    const anthropic = providers.find((entry) => entry.instanceId === "opencode/anthropic");
    expect(anthropic?.installed).toBe(true);
    expect(anthropic?.status).toBe("models.dev snapshot");
    expect(anthropic?.authStatus).toBe("oauth");
    expect(anthropic?.models[0]?.efforts[0]?.choices.map((choice) => choice.id)).toEqual(["low", "high"]);
    expect(anthropic?.models[1]?.efforts).toEqual([]);

    const keyed = await buildDirectProviders({
      env: { PATH: "/nonexistent", ANTHROPIC_API_KEY: "k" },
      modelsDev: async () => MODELS_DEV,
    });
    expect(keyed.find((entry) => entry.instanceId === "opencode/anthropic")?.authStatus).toBe("api-key");
  });

  it("keeps selectProvider/selectModel error codes on direct output", async () => {
    const providers = await buildDirectProviders({
      env: { PATH: "/nonexistent" },
      modelsDev: async () => MODELS_DEV,
    });
    expect(() => selectProvider(providers, "nope")).toThrowError(expect.objectContaining({ code: "PROVIDER_NOT_FOUND" }));
    const anthropic = selectProvider(providers, "opencode/anthropic");
    expect(() => selectModel(anthropic, "nope")).toThrowError(expect.objectContaining({ code: "MODEL_NOT_FOUND" }));
    expect(selectModel(anthropic, "anthropic/plain").name).toBe("Plain");
  });
});
