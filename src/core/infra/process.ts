import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CliError } from "../errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 60_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (cause) => {
      clearTimeout(timeout);
      reject(new CliError("PROCESS_START_FAILED", `Could not start ${command}.`, { cause }));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const exitCode = code ?? 1;
      if (timedOut) {
        reject(new CliError("PROCESS_TIMEOUT", `${command} timed out.`, { details: { command } }));
        return;
      }
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new CliError("PROCESS_FAILED", `${command} exited with code ${exitCode}.`, {
            details: { command, exitCode, stderr: stderr.trim() },
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export async function commandExists(command: string): Promise<boolean> {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await runProcess(locator, [command], { allowFailure: true, timeoutMs: 5_000 }).catch(
    () => null,
  );
  return result?.exitCode === 0;
}

/** Whether `name` resolves to an executable on `PATH` (with `PATHEXT` on Windows). */
export function binaryOnPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PATH ?? env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE").split(";").filter((ext) => ext.length > 0)
    : [""];
  for (const dir of raw.split(delimiter).filter((entry) => entry.length > 0)) {
    for (const ext of process.platform === "win32" ? ["", ...exts] : exts) {
      try {
        if (fs.statSync(path.join(dir, `${name}${ext}`)).isFile()) return true;
      } catch {
        // Keep scanning.
      }
    }
  }
  return false;
}

/**
 * End a process and everything it started. On Windows a plain kill ends
 * only the direct child, and provider CLIs are often launched through a
 * shim (`opencode` on PATH starts `opencode-ai/bin/opencode.exe`): killing
 * the shim orphaned the real server, one per moxen process that used it.
 * `taskkill /T /F` takes the whole tree. Elsewhere, the signal as asked.
 */
export function killProcessTree(
  child: { readonly pid?: number | undefined; kill(signal?: NodeJS.Signals): unknown },
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (process.platform === "win32" && child.pid) {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10_000,
    });
    if (result.status === 0) return;
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
}
