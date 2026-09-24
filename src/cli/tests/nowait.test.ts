/**
 * `--no-wait` through the real CLI entry, not the command functions: the
 * flag never worked on `threads create` or `threads send`. Commander stores
 * `--no-wait` as `wait: false`, the commands read `noWait`, and every such
 * call blocked until the turn settled — forever, for a turn parked on a
 * question. Found live; the envelope tests call the functions directly and
 * could not see it.
 *
 * The CLI runs as a real subprocess against a server in this process whose
 * turns never settle, so only a CLI that truly does not wait can exit.
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { testHarness } from "../../core/testing/harness.js";
import { DirectConnection } from "../../server/connection.js";
import { serve } from "../../server/transport/serve.js";

const CLI = path.resolve("src/cli/index.ts");
// The CLI runs on Bun (TypeScript directly); vitest itself may run on Node.
const BUN = process.versions.bun ? process.execPath : "bun";

function endpointFor(name: string): string {
  return process.platform === "win32"
    ? ["", "", ".", "pipe", `${name}-${process.pid}`].join("\\")
    : path.join(process.env.TMPDIR ?? "/tmp", `${name}-${process.pid}.sock`);
}

/** Run the CLI; resolves with its exit and output, or `timedOut` after `ms`. */
function runCli(args: string[], env: NodeJS.ProcessEnv, ms: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(BUN, [CLI, "--json", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

describe("--no-wait through the CLI entry", () => {
  it("returns at acceptance for threads create and threads send, with the turn still running", async () => {
    const harness = await testHarness({ leaveTurnsRunning: true });
    const endpoint = endpointFor("moxen-nowait");
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    const server = await serve({ endpoint, api: connection, onClose: () => connection.close() });
    const env = { ...process.env, MOXEN_SERVER: "daemon", MOXEN_SERVER_ENDPOINT: endpoint };
    try {
      const created = await runCli(
        ["threads", "create", "--cwd", harness.work, "--checkout", "local", "--no-wait", "--prompt", "Never settles"],
        env,
        30_000,
      );
      expect(created.timedOut).toBe(false);
      expect(created.stdout, created.stderr).not.toBe("");
      const createdEnvelope = JSON.parse(created.stdout) as { ok: boolean; data: { thread: { id: string } } };
      expect(createdEnvelope.ok).toBe(true);

      const threadId = createdEnvelope.data.thread.id;
      const sent = await runCli(["threads", "send", "--thread", threadId, "--no-wait", "--delivery", "queue", "--prompt", "Queued"], env, 30_000);
      expect(sent.timedOut).toBe(false);
      expect((JSON.parse(sent.stdout) as { ok: boolean }).ok).toBe(true);

      const turns = await harness.store.readTurns(threadId);
      expect(turns[0]?.status).toBe("running");
    } finally {
      await server.close();
    }
  }, 90_000);
});
