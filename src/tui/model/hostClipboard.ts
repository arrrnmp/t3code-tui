/**
 * Reading an image off the OS clipboard.
 *
 * The half of the old `attachments.ts` that genuinely belongs to a
 * terminal client: it binds `@opentui/core`. The validation rules it feeds
 * live in `core/attachments.ts`, which both clients and the server share.
 */
import { createHostClipboard } from "@opentui/core";

import { MAX_IMAGE_BYTES } from "../../core/attachments.js";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

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
