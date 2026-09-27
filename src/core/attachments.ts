/**
 * Inline image attachments: the contract, not the capture.
 *
 * This validation is the *server's* rule about what a turn may carry, so
 * `server/connection.ts` needs the type — and reached up into the TUI to
 * get it, because the rule happened to live next to the TUI's clipboard
 * reader. The reader binds `@opentui/core`; the rule binds nothing. They
 * are split here so the contract sits below both clients and the terminal
 * dependency stays in the terminal client.
 *
 * Limits are the Claude API's own (the Agent SDK passes images straight
 * through; see `IMAGE_LIMITS`), enforced where a turn is sent so every
 * client gets the same answer before the provider does.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Inline image upload as a `thread.turn.start` message accepts it: bytes
 * ride along as a data URL, so no separate upload round-trip is needed.
 */
export interface ImageAttachmentUpload {
  type: "image";
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const SUPPORTED_MIME = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

/**
 * The Claude API's image limits (platform.claude.com, "Vision" → "Request
 * limits"), which the Agent SDK inherits unchanged:
 *
 * - 10 MB per image *base64-encoded* (the API counts MiB: its errors read
 *   "5316852 bytes > 5242880 bytes"), so a file's raw bytes may be ¾ of it;
 * - 8000 px on either side, or 2000 px for every image once a request
 *   carries more than 20;
 * - 100 images per request (600 on 1M-context models; the lower bound holds
 *   for all of them);
 * - 32 MB per request, where base64 images are nearly all of it — a message
 *   keeps 2 MB of that for its text and the rest of the request.
 *
 * Earlier turns' images are resent too, so a long thread can still reach
 * these; Claude Code itself strips oversized history and retries.
 */
export const IMAGE_LIMITS = {
  base64BytesPerImage: 10 * 1024 * 1024,
  maxDimension: 8000,
  manyImages: 20,
  manyImagesMaxDimension: 2000,
  imagesPerMessage: 100,
  base64BytesPerMessage: 30 * 1024 * 1024,
} as const;

/** The largest file that stays under the per-image cap once base64-encoded. */
export const MAX_IMAGE_BYTES = Math.floor((IMAGE_LIMITS.base64BytesPerImage * 3) / 4);
export const MAX_PENDING_ATTACHMENTS = IMAGE_LIMITS.imagesPerMessage;

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/u, "")} MB`;
}

/**
 * Pixel size from the file header — PNG `IHDR`, a JPEG start-of-frame,
 * GIF's logical screen, WebP's VP8/VP8L/VP8X. Null when the header does not
 * say (the API then decides).
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === "PNG") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && ascii(0, 3) === "GIF") return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width, height };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      // Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) share the range but do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
}

/** The header of a data URL's image: enough bytes for any of the formats above to state its size. */
function dataUrlHead(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  // 256 KiB of image: a JPEG's EXIF block (up to 64 KiB) comes before its frame header.
  const head = dataUrl.slice(comma + 1, comma + 1 + 349_528);
  return Buffer.from(head.slice(0, head.length - (head.length % 4)), "base64");
}

/**
 * What the API would refuse in one message's images, said in words — or
 * null when it is within every limit. Checked where the turn is sent, and
 * by a client before it sends, so the refusal is ours and immediate.
 */
export function imageSetError(images: readonly Pick<ImageAttachmentUpload, "name" | "dataUrl">[]): string | null {
  if (images.length > IMAGE_LIMITS.imagesPerMessage) return `${images.length} images is more than the ${IMAGE_LIMITS.imagesPerMessage} a message can carry`;
  const total = images.reduce((sum, image) => sum + image.dataUrl.length, 0);
  if (total > IMAGE_LIMITS.base64BytesPerMessage) {
    return `these images come to ${megabytes(total)} encoded; a message can carry ${megabytes(IMAGE_LIMITS.base64BytesPerMessage)}`;
  }
  if (images.length > IMAGE_LIMITS.manyImages) {
    for (const image of images) {
      const size = imageDimensions(dataUrlHead(image.dataUrl));
      if (size !== null && Math.max(size.width, size.height) > IMAGE_LIMITS.manyImagesMaxDimension) {
        return `${image.name} is ${size.width}×${size.height}; with more than ${IMAGE_LIMITS.manyImages} images each must fit ${IMAGE_LIMITS.manyImagesMaxDimension} px`;
      }
    }
  }
  return null;
}

/** `@path` preceded by start-of-line or whitespace, so emails don't match. */
const MENTION = /(^|\s)@([^\s@][^\s]*)/g;

export function extractMentions(draft: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const text = draft.replace(MENTION, (_match, prefix: string, raw: string) => {
    const suffix = raw.match(/[.,;:!?)]+$/)?.[0] ?? "";
    const cleaned = suffix.length > 0 ? raw.slice(0, -suffix.length) : raw;
    if (cleaned.length === 0) return _match;
    paths.push(cleaned);
    return `${prefix}${path.basename(cleaned)}${suffix}`;
  });
  return { text, paths };
}

export function attachmentFromBytes(
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): { attachment: ImageAttachmentUpload; error: null } | { attachment: null; error: string } {
  if (!SUPPORTED_MIME.has(mimeType.toLowerCase())) return { attachment: null, error: `${name} is not a gif/jpeg/png/webp image` };
  if (bytes.length === 0) return { attachment: null, error: `attachment is empty: ${name}` };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { attachment: null, error: `${name} is ${megabytes(bytes.length)}; an image can be ${megabytes(MAX_IMAGE_BYTES)} (10 MB encoded)` };
  }
  if (name.length > 255) return { attachment: null, error: `file name too long: ${name}` };
  const size = imageDimensions(bytes);
  if (size !== null && Math.max(size.width, size.height) > IMAGE_LIMITS.maxDimension) {
    return { attachment: null, error: `${name} is ${size.width}×${size.height}; images can be at most ${IMAGE_LIMITS.maxDimension} px a side` };
  }
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  return { attachment: { type: "image", name, mimeType, sizeBytes: bytes.length, dataUrl }, error: null };
}

export async function buildImageAttachments(
  paths: readonly string[],
  cwd: string,
): Promise<{ attachments: ImageAttachmentUpload[]; error: string | null }> {
  const attachments: ImageAttachmentUpload[] = [];
  for (const mention of paths) {
    const resolved = path.resolve(cwd, mention);
    const stat = await fs.stat(resolved).catch(() => null);
    if (stat === null) return { attachments, error: `attachment not found: ${mention}` };
    if (!stat.isFile()) return { attachments, error: `not a file: ${mention}` };
    const mimeType = MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()];
    if (mimeType === undefined) return { attachments, error: `${mention} is not a gif/jpeg/png/webp image` };
    const bytes = await fs.readFile(resolved);
    const built = attachmentFromBytes(path.basename(resolved), mimeType, bytes);
    if (built.error !== null) return { attachments, error: built.error };
    attachments.push(built.attachment);
  }
  return { attachments, error: null };
}

/** The base64 payload and type of a `data:` URL; null for anything else. */
export function decodeDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(dataUrl);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}

/**
 * The fallback for a provider that cannot take images: the prompt names
 * them, so the model at least knows they were sent.
 */
export function imageMention(prompt: string, names: readonly string[]): string {
  return names.length === 0 ? prompt : `${prompt}\n\n[attached images: ${names.join(", ")}]`;
}

/** An image file's type by its extension; PNG when the extension says nothing. */
export function imageMimeForPath(file: string): string {
  return MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? "image/png";
}

/** File extension for an image type. */
export function imageExtension(mimeType: string): string {
  const subtype = mimeType.split("/")[1] ?? "png";
  return `.${subtype === "jpeg" ? "jpg" : subtype}`;
}
