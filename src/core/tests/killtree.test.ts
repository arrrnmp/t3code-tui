/**
 * Provider CLIs are often started through a shim that launches the real
 * binary (`opencode` → `opencode-ai/bin/opencode.exe`). A plain kill on
 * Windows ended only the shim and orphaned the real server — one per moxen
 * process that used OpenCode, found live. `killProcessTree` must take the
 * grandchild down too.
 */
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { killProcessTree } from "../infra/process.js";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as { code?: string }).code === "EPERM";
  }
};

describe("killProcessTree", () => {
  it("ends the child and the process it launched", async () => {
    // A "shim" that starts a long-lived "real server" and reports its pid.
    // Detached, as the real one effectively is: a plain kill of the shim
    // leaves it running (checked), so only a tree kill passes this.
    const shim = spawn(
      process.execPath,
      [
        "-e",
        `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", detached: true });
         console.log(c.pid);
         setTimeout(() => {}, 60000);`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const grandchild = await new Promise<number>((resolve) => {
      shim.stdout!.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
    });
    expect(alive(grandchild)).toBe(true);

    const exited = new Promise((resolve) => shim.once("exit", resolve));
    killProcessTree(shim, "SIGKILL");
    await exited;
    // The grandchild goes with it (Windows: taskkill /T; elsewhere it is
    // reparented and ends with the pipe, so allow it a moment).
    for (let wait = 0; wait < 40 && alive(grandchild); wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (process.platform === "win32") expect(alive(grandchild)).toBe(false);
    else if (alive(grandchild)) process.kill(grandchild, "SIGKILL");
  });
});
