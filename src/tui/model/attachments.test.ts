import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildImageAttachments, attachmentFromBytes, extractMentions } from "./attachments.js";

describe("extractMentions", () => {
  it("replaces @paths with basenames and collects them in order", () => {
    const parsed = extractMentions("look at @screenshots/bug.png and @C:/tmp/shot.jpg please");
    expect(parsed.paths).toEqual(["screenshots/bug.png", "C:/tmp/shot.jpg"]);
    expect(parsed.text).toBe("look at bug.png and shot.jpg please");
  });

  it("ignores emails and bare @ signs", () => {
    const parsed = extractMentions("mail user@example.com @ alone");
    expect(parsed.paths).toEqual([]);
    expect(parsed.text).toBe("mail user@example.com @ alone");
  });

  it("strips trailing punctuation from the path", () => {
    const parsed = extractMentions("see @shot.png, ok?");
    expect(parsed.paths).toEqual(["shot.png"]);
    expect(parsed.text).toBe("see shot.png, ok?");
  });
});

describe("buildImageAttachments", () => {
  it("rejects missing files", async () => {
    const result = await buildImageAttachments(["does-not-exist.png"], process.cwd());
    expect(result.attachments).toEqual([]);
    expect(result.error).toMatch(/not found/);
  });

  it("rejects non-image extensions", async () => {
    const result = await buildImageAttachments(["package.json"], process.cwd());
    expect(result.error).toMatch(/not a gif\/jpeg\/png\/webp image/);
  });

  it("rejects empty and oversized bytes", () => {
    expect(attachmentFromBytes("shot.png", "image/png", new Uint8Array()).error).toMatch(/empty/);
    expect(attachmentFromBytes("shot.png", "image/png", new Uint8Array(10 * 1024 * 1024 + 1)).error).toMatch(
      /larger than 10 MB/,
    );
    expect(attachmentFromBytes("shot.bmp", "image/bmp", new Uint8Array([1])).error).toMatch(/not a gif/);
  });

  it("builds an inline data-url attachment from a png", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "t3code-attach-"));
    const file = path.join(dir, "shot.png");
    const bytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    writeFileSync(file, bytes);
    const result = await buildImageAttachments([file], dir);
    expect(result.error).toBeNull();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: "image",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
    });
    expect(result.attachments[0]?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
