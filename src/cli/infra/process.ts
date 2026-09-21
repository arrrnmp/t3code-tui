import { spawn } from "node:child_process";

import { CliError } from "../../errors.js";

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
