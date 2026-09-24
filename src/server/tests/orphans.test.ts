/**
 * A turn whose process died mid-turn — a crashed server, a killed CLI, a
 * TUI closed during a turn — used to stay `running` forever, and every
 * later send steered into it and never ran. Reproduced live against a real
 * provider (hard-killing the CLI running a Grok turn); pinned here with the
 * ledger state such a death leaves behind.
 */
import { spawn } from "node:child_process";
import os from "node:os";

import { describe, expect, it } from "vitest";

import { testHarness } from "../../core/testing/harness.js";
import { openThreadStore } from "../../core/threads/store.js";
import { sendTurn } from "../../core/threads/threads.js";
import type { TurnOwner } from "../../core/threads/types.js";
import { DirectConnection } from "../connection.js";

/** The pid of a process that has already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"]);
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}

async function setup() {
  const harness = await testHarness();
  const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
  const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "First", wait: true, threadEnvMode: "local" });
  const store = await openThreadStore(harness.root);
  /** A running turn as a process that died mid-turn left it: recorded, owned, never settled. */
  const strand = async (owner: TurnOwner | null, prompt = "Stranded") => {
    const sent = await sendTurn(store, done.threadId, { prompt });
    await store.updateTurn(done.threadId, sent.turn.id, { owner });
    return sent.turn.id;
  };
  const statusOf = async (turnId: string) => (await store.readTurns(done.threadId)).find((turn) => turn.id === turnId)?.status;
  return { connection, store, threadId: done.threadId, strand, statusOf };
}

describe("orphaned turns", () => {
  it("interrupts a turn whose process died, so the next send runs instead of steering into it", async () => {
    const { connection, threadId, strand, statusOf, store } = await setup();
    try {
      const orphan = await strand({ pid: await deadPid(), host: os.hostname() });
      const sent = await connection.dispatch({ type: "thread.turn.start", threadId, message: { text: "Next" }, wait: true });
      expect(sent.delivery).toBe("started");
      expect(await statusOf(orphan)).toBe("interrupted");
      const turns = await store.readTurns(threadId);
      expect(turns.find((turn) => turn.id === orphan)?.error).toMatch(/exited before it finished/);
      expect(turns.at(-1)).toMatchObject({ status: "completed" });
      const activity = await store.readLedger<{ kind?: string }>(threadId, "activity");
      expect(activity.some((row) => row.kind === "turn.orphaned")).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it("runs the turn queued behind an orphan", async () => {
    const { connection, threadId, strand, statusOf, store } = await setup();
    try {
      const orphan = await strand({ pid: await deadPid(), host: os.hostname() });
      const queued = await sendTurn(store, threadId, { prompt: "Queued work", delivery: "queue" });
      expect(queued.turn.status).toBe("queued");
      // Any read recovers it; the promoted turn is then run to completion.
      await connection.query({ type: "thread.inspect", threadId });
      expect(await statusOf(orphan)).toBe("interrupted");
      await connection.query({ type: "thread.turn.await", threadId, turnId: queued.turn.id });
      expect(await statusOf(queued.turn.id)).toBe("completed");
    } finally {
      await connection.close();
    }
  });

  it("never touches a turn whose owner is alive, on another host, or unrecorded", async () => {
    for (const owner of [{ pid: process.ppid, host: os.hostname() }, { pid: await deadPid(), host: "some-other-machine" }, null]) {
      const { connection, threadId, strand, statusOf } = await setup();
      try {
        const turnId = await strand(owner);
        await connection.query({ type: "thread.inspect", threadId });
        expect(await statusOf(turnId)).toBe("running");
      } finally {
        await connection.close();
      }
    }
  });
});
