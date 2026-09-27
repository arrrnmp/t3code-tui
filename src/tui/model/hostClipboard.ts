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

/**
 * Writing an image to the OS clipboard. opentui's clipboard writes text
 * only, so this drives each platform's own tool, argv only (never a shell
 * string): `osascript` on macOS, `wl-copy` / `xclip` on Linux, PowerShell
 * on Windows. Best effort: false when the tool is missing or refuses.
 */
export function imageWriteCommand(
  file: string,
  mimeType: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; stdinFile?: string } | null {
  if (platform === "darwin") {
    const kind = { "image/png": "PNGf", "image/jpeg": "JPEG", "image/gif": "GIFf" }[mimeType.toLowerCase()];
    if (kind === undefined) return null;
    const quoted = file.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return { command: "osascript", args: ["-e", `set the clipboard to (read (POSIX file "${quoted}") as «class ${kind}»)`] };
  }
  if (platform === "win32") {
    const quoted = file.replace(/'/g, "''");
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${quoted}'))`,
      ],
    };
  }
  if (typeof env.WAYLAND_DISPLAY === "string" && env.WAYLAND_DISPLAY.length > 0) {
    return { command: "wl-copy", args: ["--type", mimeType], stdinFile: file };
  }
  return { command: "xclip", args: ["-selection", "clipboard", "-t", mimeType, "-i", file] };
}

export async function writeClipboardImage(file: string, mimeType: string): Promise<boolean> {
  const plan = imageWriteCommand(file, mimeType);
  if (plan === null) return false;
  const { spawn } = await import("node:child_process");
  const { createReadStream } = await import("node:fs");
  return await new Promise<boolean>((resolve) => {
    let child;
    try {
      child = spawn(plan.command, plan.args, { stdio: [plan.stdinFile === undefined ? "ignore" : "pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 10_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    // wl-copy stays behind to serve the selection; it exits once replaced,
    // so its spawn succeeding is as good as it gets.
    child.on("spawn", () => {
      if (plan.command === "wl-copy") {
        clearTimeout(timer);
        setTimeout(() => resolve(true), 200);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    if (plan.stdinFile !== undefined && child.stdin !== null) createReadStream(plan.stdinFile).pipe(child.stdin);
  });
}
