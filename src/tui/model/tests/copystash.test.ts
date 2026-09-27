import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copiedAttachments, forgetCopyForTests, matchCopy, rememberCopy, stashedFiles, uniqueName } from "../copystash.js";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  forgetCopyForTests();
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function home(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "moxen-copystash-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("copy stash", () => {
  it("recognises its own copy on paste, and brings the images back under new names", async () => {
    const dir = await home();
    const file = path.join(dir, "sent.png");
    await writeFile(file, PNG);
    rememberCopy("look at [Image #1] and [Image #2]\n", [
      { name: "a.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${PNG.toString("base64")}` },
      { name: "b.png", mimeType: "image/png", path: file },
    ], dir);
    expect(stashedFiles(dir)).toEqual(["1.png", "2.png"]);

    // Line endings from the terminal do not matter; other text does.
    const copied = matchCopy("look at [Image #1] and [Image #2]\r\n", dir);
    expect(copied?.images).toHaveLength(2);
    expect(matchCopy("something else", dir)).toBeNull();
    const attached = copiedAttachments(copied!, ["a.png", "b-2.png"]);
    expect(attached.map((entry) => [entry.name, entry.mimeType])).toEqual([["a.png", "image/png"], ["b-2.png", "image/png"]]);
  });

  it("is found from disk by another window, and a copy without images clears the last one", async () => {
    const dir = await home();
    rememberCopy("with an image", [{ name: "a.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${PNG.toString("base64")}` }], dir);
    forgetCopyForTests();
    expect(matchCopy("with an image", dir)?.images).toHaveLength(1);
    rememberCopy("plain", [], dir);
    expect(matchCopy("with an image", dir)).toBeNull();
    expect(stashedFiles(dir)).toEqual([]);
  });

  it("keeps attachment names unique", () => {
    const taken = new Set(["shot.png"]);
    expect(uniqueName("shot.png", taken)).toBe("shot-2.png");
    expect(uniqueName("shot.png", taken)).toBe("shot-3.png");
    expect(uniqueName("other.png", taken)).toBe("other.png");
  });
});
