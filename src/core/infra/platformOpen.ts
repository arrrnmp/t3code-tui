/**
 * Hand a URL to the OS default handler.
 *
 * Lived under `cli/` but its only consumer is the TUI, so the import ran
 * client-to-client. It is an OS adapter with no CLI in it at all.
 */
import { spawn } from "node:child_process";

import { CliError } from "../errors.js";

export async function openExternal(url: string): Promise<void> {
  const invocation =
    process.platform === "win32"
      ? { command: "explorer.exe", args: [url] }
      : process.platform === "darwin"
        ? { command: "open", args: [url] }
        : { command: "xdg-open", args: [url] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (cause) => {
      reject(new CliError("OPEN_FAILED", `Could not open ${url}.`, { cause }));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
