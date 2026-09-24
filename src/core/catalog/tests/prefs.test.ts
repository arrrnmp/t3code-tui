import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isModelHidden,
  loadModelPrefs,
  saveModelPrefs,
} from "../prefs.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moxen-prefs-"));
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

  it("reads empty prefs before anything has been saved", async () => {
    expect(await loadModelPrefs(await tmpRoot())).toEqual({ favorites: [], hidden: {}, order: {} });
  });
});
