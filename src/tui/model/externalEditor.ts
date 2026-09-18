import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { commandExists } from "../../cli/infra/process.js";

export interface EditorCommand {
  command: string;
  args: string[];
}

/**
 * Splits `"code --wait"` into command + leading args; the draft file is
 * always appended last by the caller — never via shell concatenation.
 * Quoted segments stay intact, so Windows installs like
 * `"C:\Program Files\Microsoft VS Code\Code.exe" --wait` survive.
 */
export function parseEditorCommand(raw: string): EditorCommand {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/gu;
  for (const match of raw.trim().matchAll(pattern)) {
    const part = match[1] ?? match[2] ?? match[3] ?? "";
    if (part.length > 0) parts.push(part);
  }
  const [command, ...args] = parts;
  return { command: command ?? "vi", args };
}

/**
 * Resolves the external editor from `VISUAL`/`EDITOR`, falling back to
 * `notepad` on Windows and `vi` elsewhere. Synchronous legacy primitive —
 * prefer `preferredEditorCommand`, which checks availability first.
 */
export function resolveEditorCommand(env: NodeJS.ProcessEnv = process.env): EditorCommand {
  const raw = env.VISUAL || env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  return parseEditorCommand(raw);
}

/**
 * Ordered default cascade when no editor is configured. Explicit user
 * choice (`$VISUAL`/`$EDITOR`, even vim) always wins over this — it only
 * decides the fallback, preferring graphical editors where we know one:
 * VS Code, then Zed, then TextEdit (`open -W` waits for quit) on macOS;
 * Notepad on Windows; plain `vi` elsewhere (Linux deliberately untouched).
 */
export function defaultEditorCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "darwin") return ["code --wait", "zed --wait", "open -W -e"];
  if (platform === "win32") return ["notepad"];
  return ["vi"];
}

/**
 * Availability-aware resolution: an explicit `$VISUAL`/`$EDITOR` is used
 * as-is, otherwise the first cascade entry found on `PATH` wins, with the
 * last entry as the unchecked final fallback.
 */
export async function preferredEditorCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (command: string) => Promise<boolean> = commandExists,
): Promise<EditorCommand> {
  const explicit = env.VISUAL || env.EDITOR;
  if (explicit !== undefined && explicit.trim().length > 0) return parseEditorCommand(explicit);
  const candidates = defaultEditorCandidates(platform);
  for (const candidate of candidates) {
    const parsed = parseEditorCommand(candidate);
    if (await exists(parsed.command)) return parsed;
  }
  return parseEditorCommand(candidates[candidates.length - 1] ?? "vi");
}

/** Writes the current draft to a temp file for the editor to open. */
export async function createTempDraftFile(initialText: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "t3code-draft-"));
  const file = path.join(dir, "draft.md");
  await writeFile(file, initialText, "utf8");
  return { dir, file };
}

export async function readTempDraftFile(file: string): Promise<string> {
  return await readFile(file, "utf8");
}

export async function cleanupTempDraftFile(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Spawns the editor attached to the terminal (`stdio: "inherit"`). The TUI
 * keeps rendering underneath behind its "save and close" overlay — no
 * renderer suspend/resume dance. Resolves with the exit code; rejects only
 * when the process cannot start.
 *
 * On Windows the spawn goes through `cmd.exe`: native `CreateProcess`
 * cannot execute `.cmd`/`.bat` shims (VS Code's `code`, `code.cmd`) and
 * skips PATHEXT resolution, so without a shell the most common Windows
 * editors fail with ENOENT and the editor never opens. Argv stays an
 * array — Node does the `cmd.exe` quoting, nothing is concatenated.
 */
export async function runEditorAttached(command: string, args: readonly string[], file: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, [...args, file], {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32",
    });
    child.on("error", (cause) => reject(cause));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
