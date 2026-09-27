import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildImageAttachments, attachmentFromBytes, extractMentions, IMAGE_LIMITS, imageDimensions, imageSetError, MAX_IMAGE_BYTES } from "../attachments.js";
import { tempDir } from "../testing/tmp.js";

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
    // The API's 10 MB is of the base64 text, so the file itself may be ¾ of it.
    expect(MAX_IMAGE_BYTES).toBe(7_864_320);
    expect(attachmentFromBytes("shot.png", "image/png", new Uint8Array(MAX_IMAGE_BYTES + 1)).error).toMatch(/can be 7\.5 MB \(10 MB encoded\)/);
    expect(attachmentFromBytes("shot.bmp", "image/bmp", new Uint8Array([1])).error).toMatch(/not a gif/);
  });

  it("builds an inline data-url attachment from a png", async () => {
    const dir = tempDir("moxen-attach-");
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

/** A PNG header claiming `width`×`height`: enough for the size checks. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("the API's image limits", () => {
  it("reads pixel size from png, gif and jpeg headers", () => {
    expect(imageDimensions(png(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(imageDimensions(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]))).toEqual({ width: 320, height: 240 });
    // SOI, an APP0 segment to skip, then SOF0 with height 480 and width 640.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03]);
    expect(imageDimensions(jpeg)).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("refuses an image past 8000 px a side", () => {
    expect(attachmentFromBytes("wide.png", "image/png", png(8001, 100)).error).toMatch(/8001×100; images can be at most 8000 px/);
    expect(attachmentFromBytes("ok.png", "image/png", png(8000, 8000)).error).toBeNull();
  });

  it("checks a message's images together: count, encoded total, and 2000 px once past 20", () => {
    const image = (name: string, bytes: Uint8Array) => attachmentFromBytes(name, "image/png", bytes).attachment!;
    const small = Array.from({ length: 21 }, (_, index) => image(`s${index}.png`, png(1000, 1000)));
    expect(imageSetError(small)).toBeNull();
    expect(imageSetError([...small.slice(0, 20), image("big.png", png(2500, 1000))])).toMatch(/big\.png is 2500×1000; with more than 20 images each must fit 2000 px/);
    // At 20 or fewer, a large image is fine (the 8000 px cap still applies).
    expect(imageSetError([small[0]!, image("big.png", png(2500, 1000))])).toBeNull();
    expect(imageSetError(Array.from({ length: IMAGE_LIMITS.imagesPerMessage + 1 }, (_, index) => image(`n${index}.png`, png(10, 10))))).toMatch(/101 images is more than the 100/);
    const heavy = { name: "heavy.png", dataUrl: "x".repeat(IMAGE_LIMITS.base64BytesPerMessage + 1) };
    expect(imageSetError([heavy])).toMatch(/30 MB encoded; a message can carry 30 MB/);
  });
});
