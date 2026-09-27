/**
 * What moxen copied last, so pasting it back into moxen brings its images.
 *
 * The system clipboard carries text only (and a pasted image arrives on
 * its own), so a copied prompt with images would lose them on the way back
 * in. Instead the copy is remembered here: its text, and each image saved
 * as a file under the app home. A paste whose text is exactly that copy is
 * recognised and its images are attached again, in order, onto the prompt's
 * own `[Image #N]` tokens. Anywhere else the paste is just the text.
 *
 * Written to disk as well as kept in memory, so another moxen window (or
 * this one after a restart) recognises the copy too. Only the latest copy
 * is kept; its image files replace the previous copy's.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appHomeDir } from "../../core/config.js";
import { attachmentFromBytes, decodeDataUrl, imageExtension, type ImageAttachmentUpload } from "../../core/attachments.js";
import { writeClipboardImage } from "./hostClipboard.js";

/** An image going with a copy: its bytes in a data URL (a draft's), or a file already on disk (a sent message's). */
export interface CopySource {
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl?: string;
  readonly path?: string;
}

interface StashedImage {
  readonly name: string;
  readonly mimeType: string;
  readonly path: string;
}

export interface CopiedPrompt {
  readonly text: string;
  readonly images: readonly StashedImage[];
}

let latest: CopiedPrompt | null = null;

function stashDir(home: string): string {
  return path.join(home, "copied");
}

function stashFile(home: string): string {
  return path.join(home, "copied.json");
}

/** Line endings and surrounding blank space do not make a different paste. */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

const MIME_BY_EXTENSION: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/**
 * Remember `text` as moxen's latest copy, with its images saved alongside.
 * Returns the saved images (what goes to the system clipboard ahead of the
 * text). A copy without images still replaces the previous one, so an old
 * copy's images never come back on an unrelated paste.
 */
export function rememberCopy(text: string, sources: readonly CopySource[], home: string = appHomeDir()): CopiedPrompt {
  const dir = stashDir(home);
  rmSync(dir, { recursive: true, force: true });
  const images: StashedImage[] = [];
  if (sources.length > 0) mkdirSync(dir, { recursive: true });
  sources.forEach((source, index) => {
    const target = path.join(dir, `${index + 1}${imageExtension(source.mimeType)}`);
    try {
      if (source.dataUrl !== undefined) {
        const decoded = decodeDataUrl(source.dataUrl);
        if (decoded === null) return;
        writeFileSync(target, Buffer.from(decoded.data, "base64"));
      } else if (source.path !== undefined) {
        writeFileSync(target, readFileSync(source.path));
      } else {
        return;
      }
      images.push({ name: source.name, mimeType: source.mimeType, path: target });
    } catch {
      // An image that cannot be saved is left out, not the whole copy.
    }
  });
  latest = { text: normalize(text), images };
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(stashFile(home), JSON.stringify(latest));
  } catch {
    // Memory still knows; only another window would miss it.
  }
  return latest;
}

function readStash(home: string): CopiedPrompt | null {
  try {
    const parsed = JSON.parse(readFileSync(stashFile(home), "utf8")) as Partial<CopiedPrompt>;
    if (typeof parsed.text !== "string" || !Array.isArray(parsed.images)) return null;
    return { text: parsed.text, images: parsed.images.filter((image) => typeof image?.path === "string") as StashedImage[] };
  } catch {
    return null;
  }
}

/** Moxen's latest copy, when `pasted` is it; null for any other text. */
export function matchCopy(pasted: string, home: string = appHomeDir()): CopiedPrompt | null {
  const text = normalize(pasted);
  if (text.length === 0) return null;
  if (latest?.text === text) return latest;
  const stored = readStash(home);
  return stored?.text === text ? stored : null;
}

/**
 * The copy's images as attachments again, named `names[i]` (the caller
 * keeps names unique among what is already attached). Images whose files
 * have gone, or that no longer pass the attachment rules, are skipped.
 */
export function copiedAttachments(copied: CopiedPrompt, names: readonly string[]): ImageAttachmentUpload[] {
  const out: ImageAttachmentUpload[] = [];
  copied.images.forEach((image, index) => {
    try {
      const mimeType = MIME_BY_EXTENSION[path.extname(image.path).toLowerCase()] ?? image.mimeType;
      const built = attachmentFromBytes(names[index] ?? image.name, mimeType, readFileSync(image.path));
      if (built.attachment !== null) out.push(built.attachment);
    } catch {
      // Gone since the copy: nothing to attach.
    }
  });
  return out;
}

/** `name`, or `name` with a counter before its extension, so no two attachments share one. */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let counter = 2; taken.has(candidate); counter += 1) candidate = `${stem}-${counter}${ext}`;
  taken.add(candidate);
  return candidate;
}

/** Clipboard managers poll for changes; writes closer than this can merge into one entry. */
const HISTORY_GAP_MS = 600;

/**
 * Copy a prompt with its images: each image to the system clipboard first
 * (one entry apiece in a clipboard history — macOS's, Raycast's), then the
 * text last, so a plain paste anywhere is the text. Over SSH only the text
 * travels (the host clipboard there is the remote machine's). Remembered
 * either way, so pasting it back into moxen attaches the images again.
 */
export async function copyPrompt(
  clipboard: { copyText: (text: string) => Promise<boolean>; isRemote: () => boolean },
  text: string,
  sources: readonly CopySource[],
): Promise<{ ok: boolean; images: number }> {
  const copied = rememberCopy(text, sources);
  let images = 0;
  if (!clipboard.isRemote()) {
    for (const image of copied.images) {
      if (await writeClipboardImage(image.path, image.mimeType)) {
        images += 1;
        await new Promise((resolve) => setTimeout(resolve, HISTORY_GAP_MS));
      }
    }
  }
  return { ok: await clipboard.copyText(text), images };
}

/** What a copy toast says: plain, or how the images went along. */
export function copiedToast(attached: number, onClipboard: number): string {
  if (attached === 0) return "Copied to clipboard";
  const images = `${attached} image${attached === 1 ? "" : "s"}`;
  return onClipboard > 0
    ? `Copied with ${images} (in clipboard history too) · paste here to attach them`
    : `Copied · paste here to attach the ${images}`;
}

/** For tests: forget the in-memory copy (the file stays). */
export function forgetCopyForTests(): void {
  latest = null;
}

/** For tests: the files a copy saved. */
export function stashedFiles(home: string): string[] {
  try {
    return readdirSync(stashDir(home));
  } catch {
    return [];
  }
}
