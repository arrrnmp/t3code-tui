import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureImportedFromT3,
  importT3ClientSettings,
  isModelHidden,
  loadModelPrefs,
  saveModelPrefs,
} from "../prefs.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "t3code-prefs-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe("model prefs", () => {
  it("round-trips favorites, hidden, and order", async () => {
    const root = await tmpRoot();
    expect(await loadModelPrefs(root)).toEqual({ favorites: [], hidden: {}, order: {} });
    await saveModelPrefs(root, {
      favorites: [{ instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" }],
      hidden: { opencode: ["a/b"] },
      order: { codex: ["gpt-5.4"] },
    });
    const loaded = await loadModelPrefs(root);
    expect(loaded.favorites).toEqual([{ instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" }]);
    expect(isModelHidden(loaded, "opencode", "a/b")).toBe(true);
    expect(isModelHidden(loaded, "opencode", "a/c")).toBe(false);
  });

  it("imports T3 favorites and per-instance preferences", () => {
    const prefs = importT3ClientSettings({
      favorites: [
        { provider: "opencode", model: "github-copilot/claude-haiku-4.5" },
        { provider: "codex", model: "gpt-5.4" },
        { provider: "", model: "x" },
      ],
      providerModelPreferences: {
        opencode: { hiddenModels: ["a/b"], modelOrder: ["c/d"] },
      },
    });
    expect(prefs.favorites).toEqual([
      { instanceId: "opencode", model: "github-copilot/claude-haiku-4.5" },
      { instanceId: "codex", model: "gpt-5.4" },
    ]);
    expect(prefs.hidden).toEqual({ opencode: ["a/b"] });
    expect(prefs.order).toEqual({ opencode: ["c/d"] });
    expect(importT3ClientSettings(null)).toEqual({ favorites: [], hidden: {}, order: {} });
  });

  it("imports once from a T3 home, then never again", async () => {
    const root = await tmpRoot();
    const t3home = await tmpRoot();
    await mkdir(path.join(t3home, "userdata"), { recursive: true });
    await writeFile(
      path.join(t3home, "userdata", "client-settings.json"),
      JSON.stringify({ favorites: [{ provider: "opencode", model: "a/b" }] }),
    );
    const env = { T3CODE_HOME: t3home };
    expect(await ensureImportedFromT3(root, env)).toBe(true);
    expect((await loadModelPrefs(root)).favorites).toEqual([{ instanceId: "opencode", model: "a/b" }]);
    expect(await ensureImportedFromT3(root, env)).toBe(false);
  });

  it("writes empty prefs when the T3 home has nothing", async () => {
    const root = await tmpRoot();
    expect(await ensureImportedFromT3(root, { T3CODE_HOME: await tmpRoot() })).toBe(false);
    expect(await loadModelPrefs(root)).toEqual({ favorites: [], hidden: {}, order: {} });
  });
});
