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
 * Limits mirror the original server contract: gif/jpeg/png/webp, 10 MiB,
 * 14M-char data URL.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Inline image upload as a `thread.turn.start` message accepts it: bytes
 * ride along as a data URL, so no separate upload round-trip is needed.
 * Limits mirror the original server contract: gif/jpeg/png/webp, 10 MiB,
 * 14M-char data URL.
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

/** File extension for an image type. */
export function imageExtension(mimeType: string): string {
  const subtype = mimeType.split("/")[1] ?? "png";
  return `.${subtype === "jpeg" ? "jpg" : subtype}`;
}
