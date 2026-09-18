import { promises as fs } from "node:fs";
import path from "node:path";

import { createHostClipboard } from "@opentui/core";

import type { ImageAttachmentUpload } from "../../cli/threads/threadApi.js";

/**
 * Inline image upload as the client `thread.turn.start` command accepts it:
 * bytes ride along as a data URL, so no separate upload round-trip (and no
 * dependence on the server's attachment-upload capability) is needed. Limits
 * mirror the server contract: gif/jpeg/png/webp, 10 MiB, 14M-char data URL.
 */
export type { ImageAttachmentUpload };

const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const SUPPORTED_MIME = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 14_000_000;
export const MAX_PENDING_ATTACHMENTS = 5;

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
  if (bytes.length > MAX_IMAGE_BYTES) return { attachment: null, error: `${name} is larger than 10 MB` };
  if (name.length > 255) return { attachment: null, error: `file name too long: ${name}` };
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  if (dataUrl.length > MAX_DATA_URL_CHARS) return { attachment: null, error: `${name} is too large to send inline` };
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

/** Reads an image off the OS clipboard (screenshots, copied files that expose pixels). */
export async function readClipboardImage(): Promise<
  { bytes: Uint8Array; mimeType: string; error: null } | { bytes: null; mimeType: null; error: string }
> {
  let host;
  try {
    host = createHostClipboard({ maxReadBytes: MAX_IMAGE_BYTES, timeoutMs: 10_000 });
  } catch (cause) {
    return { bytes: null, mimeType: null, error: `clipboard unavailable: ${String(cause).slice(0, 80)}` };
  }
  try {
    const result = await host.read({
      preferredTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      selection: "clipboard",
    });
    if (result.status !== "read") {
      const reason =
        result.status === "empty" ? "clipboard has no image — copy one first" : `clipboard read ${result.status}`;
      return { bytes: null, mimeType: null, error: reason };
    }
    return { bytes: result.representation.bytes, mimeType: result.representation.mimeType, error: null };
  } catch (cause) {
    return { bytes: null, mimeType: null, error: `clipboard read failed: ${String(cause).slice(0, 80)}` };
  } finally {
    await host.dispose().catch(() => undefined);
  }
}

export function clipboardFileName(mimeType: string): string {
  return `clipboard-${Date.now()}${EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? ".png"}`;
}
