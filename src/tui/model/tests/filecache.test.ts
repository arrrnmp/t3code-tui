import { describe, expect, it, vi } from "vitest";

import {
  createFileContentCache,
  diffCachedFiles,
  FILE_CACHE_MAX_BYTES,
  resolveCachePath,
  snapshotFiles,
} from "../filecache.js";

const ROOT = "/repo/my-app";

describe("resolveCachePath", () => {
  it("resolves absolute in-root paths and rejects escapes", () => {
    expect(resolveCachePath(ROOT, "/repo/my-app/src/a.ts")).toBe("/repo/my-app/src/a.ts");
    expect(resolveCachePath(ROOT, "/repo/my-app/../my-app/src/a.ts")).toBe("/repo/my-app/src/a.ts");
    expect(resolveCachePath(ROOT, "/repo/other/a.ts")).toBeNull();
    expect(resolveCachePath(ROOT, "/repo/my-app/../../etc/passwd")).toBeNull();
  });

  it("resolves root-relative paths and rejects empty markers", () => {
    expect(resolveCachePath(ROOT, "src/a.ts")).toBe("/repo/my-app/src/a.ts");
    expect(resolveCachePath(ROOT, "")).toBeNull();
    expect(resolveCachePath(ROOT, "…")).toBeNull();
  });

  it("expands a leading ~ against HOME", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (home.length === 0) return;
    const resolved = resolveCachePath(home, "~/proj/a.ts");
    expect(resolved).toBe(`${home.replace(/\\/g, "/").replace(/\/+$/, "")}/proj/a.ts`);
  });
});

describe("createFileContentCache", () => {
  it("evicts the oldest entry past capacity", () => {
    const cache = createFileContentCache(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.size).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("c")).toBe("3");
  });
});

describe("snapshotFiles and diffCachedFiles", () => {
  const files = new Map<string, string>([["/repo/my-app/src/a.ts", "line1\nline2\n"]]);

  const read = vi.fn(async (path: string): Promise<string> => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  });

  it("snapshots reads and diffs a later edit", async () => {
    const cache = createFileContentCache();
    await snapshotFiles(ROOT, ["/repo/my-app/src/a.ts"], cache, read);
    expect(cache.has("/repo/my-app/src/a.ts")).toBe(true);
    files.set("/repo/my-app/src/a.ts", "line1\nline2 changed\n");
    const diffs = await diffCachedFiles(
      ROOT,
      cache,
      [{ full: "/repo/my-app/src/a.ts", display: "src/a.ts" }],
      read,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ path: "src/a.ts" });
    expect(diffs[0]?.additions).toBe(1);
    expect(diffs[0]?.deletions).toBe(1);
    expect(diffs[0]?.patch).toContain("line2 changed");
  });

  it("returns nothing without a baseline, when identical, or when unreadable", async () => {
    const cache = createFileContentCache();
    expect(
      await diffCachedFiles(ROOT, cache, [{ full: "/repo/my-app/src/a.ts", display: "src/a.ts" }], read),
    ).toEqual([]);
    cache.set("/repo/my-app/src/a.ts", "line1\nline2 changed\n");
    expect(
      await diffCachedFiles(ROOT, cache, [{ full: "/repo/my-app/src/a.ts", display: "src/a.ts" }], read),
    ).toEqual([]);
    expect(
      await diffCachedFiles(ROOT, cache, [{ full: "/repo/my-app/src/gone.ts", display: "gone.ts" }], read),
    ).toEqual([]);
    cache.set("/repo/my-app/src/gone.ts", "old\n");
    expect(
      await diffCachedFiles(ROOT, cache, [{ full: "/repo/my-app/src/gone.ts", display: "gone.ts" }], read),
    ).toEqual([]);
  });

  it("skips oversized content", async () => {
    const cache = createFileContentCache();
    const big = `x\n`.repeat(FILE_CACHE_MAX_BYTES);
    await snapshotFiles(ROOT, ["/repo/my-app/src/a.ts"], cache, async () => big);
    expect(cache.size).toBe(0);
  });
});
