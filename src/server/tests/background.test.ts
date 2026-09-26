/**
 * What a session does around and between our turns, end to end through
 * `ClientApi` and the real store: interim notes kept as their own
 * messages, a turn the provider started itself recorded and completed,
 * background tasks written to the ledger and stoppable.
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { CliError } from "../../core/errors.js";
import type { ProviderRuntimeEvent } from "../../core/providers/spi.js";
import { testHarness } from "../../core/testing/harness.js";
import type { TurnDriver, TurnOutcome } from "../../core/threads/execute.js";
import { noteMessageId } from "../../core/threads/views.js";
import { DirectConnection } from "../connection.js";

const USAGE = { input: 1, cacheRead: 0, cacheCreate: 0, output: 1, thinking: 0 };

/** A driver scripted like Claude Code: notes on the way, a background task, a turn it starts itself. */
class BackgroundDriver implements TurnDriver {
  private readonly sessions = new Set<string>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());
  private readonly outcomes = new Map<string, (outcome: TurnOutcome) => void>();
  /** Like a real driver, a turn that settled before anyone awaited it keeps its outcome. */
  private readonly settled = new Map<string, TurnOutcome>();

  private settle(turnId: string, outcome: TurnOutcome): void {
    const waiter = this.outcomes.get(turnId);
    if (waiter) waiter(outcome);
    else this.settled.set(turnId, outcome);
  }
  private tasks: Array<{ taskId: string; taskType: string | null; description: string }> = [];
  stopped: string[] = [];
  private turn = 0;

  emit(event: ProviderRuntimeEvent): void {
    Effect.runSync(Queue.offer(this.queue, event));
  }

  hasSession(threadId: string) {
    return Effect.succeed(this.sessions.has(threadId));
  }
  startSession(input: { threadId: string }) {
    return Effect.sync(() => void this.sessions.add(input.threadId));
  }
  sendTurn(input: { threadId: string }) {
    return Effect.sync(() => {
      const turnId = `driver-${++this.turn}`;
      const threadId = input.threadId;
      setTimeout(() => {
        this.emit({ type: "message.part.updated", provider: "claude", threadId, turnId, messageId: "m1", text: "Checking the config." });
        this.emit({ type: "assistant.note", provider: "claude", threadId, turnId, messageId: "m1", text: "Checking the config." });
        this.tasks = [{ taskId: "bg1", taskType: "local_bash", description: "watch the log" }];
        this.emit({ type: "background.tasks.changed", provider: "claude", threadId, tasks: this.tasks });
        this.emit({
          type: "background.task", provider: "claude", threadId, turnId, taskId: "bg1", status: "started",
          description: "watch the log", taskType: "local_bash", toolUseId: "tu-1", summary: null,
        });
        setTimeout(() => this.settle(turnId, { status: "completed", text: "Watching.", usage: USAGE, error: null }), 30);
      }, 10);
      return { threadId, turnId };
    });
  }
  /** Claude Code waking the session on its own. */
  wake(threadId: string): string {
    const turnId = `driver-${++this.turn}`;
    this.emit({ type: "turn.started", provider: "claude", threadId, turnId, origin: "background" });
    setTimeout(() => this.settle(turnId, { status: "completed", text: "tick-1", usage: USAGE, error: null }), 50);
    return turnId;
  }
  interruptTurn() {
    return Effect.void;
  }
  awaitTurn(_threadId: string, turnId: string): Promise<TurnOutcome> {
    const done = this.settled.get(turnId);
    if (done) return Promise.resolve(done);
    return new Promise((resolve) => this.outcomes.set(turnId, resolve));
  }
  backgroundTasks() {
    return this.tasks;
  }
  stopBackgroundTask(_threadId: string, taskId: string) {
    return Effect.suspend(() => {
      if (!this.tasks.some((task) => task.taskId === taskId)) return Effect.fail(new CliError("BACKGROUND_TASK_NOT_FOUND", "no such task"));
      this.stopped.push(taskId);
      return Effect.void;
    });
  }
  resumeCursor() {
    return null;
  }
  get streamEvents(): Stream.Stream<ProviderRuntimeEvent> {
    return Stream.fromQueue(this.queue);
  }
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("background work through ClientApi", () => {
  it("keeps notes, records a self-started turn, and lists and stops background tasks", async () => {
    const driver = new BackgroundDriver();
    const harness = await testHarness({ drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver } });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    try {
      const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Watch the log", wait: true, threadEnvMode: "local" });
      const threadId = done.threadId;
      const firstTurn = done.started!.turnId;

      // The note is its own assistant row, under the id the live stream used,
      // and the final answer still comes last.
      const messages = await harness.store.readMessages(threadId);
      const assistant = messages.filter((message) => message.role === "assistant");
      expect(assistant.map((message) => message.text)).toEqual(["Checking the config.", "Watching."]);
      expect(assistant[0]!.id).toBe(noteMessageId(firstTurn, "m1"));

      // Background work: listed live, stoppable, and in the ledger.
      expect(await connection.query({ type: "thread.background.list", threadId })).toEqual({
        live: true,
        tasks: [{ taskId: "bg1", taskType: "local_bash", description: "watch the log" }],
      });
      await connection.dispatch({ type: "thread.background.stop", threadId, taskId: "bg1" });
      expect(driver.stopped).toEqual(["bg1"]);
      await expect(connection.dispatch({ type: "thread.background.stop", threadId, taskId: "nope" })).rejects.toMatchObject({
        code: "BACKGROUND_TASK_NOT_FOUND",
      });
      const activity = await harness.store.readLedger<{ kind: string }>(threadId, "activity");
      expect(activity.map((row) => row.kind)).toEqual(expect.arrayContaining(["background.tasks", "background.started"]));

      // Claude Code wakes the session itself: a stored turn, run to completion.
      driver.wake(threadId);
      await waitFor(async () => (await harness.store.readTurns(threadId)).some((turn) => turn.delivery === "background" && turn.status === "completed"));
      const turns = await harness.store.readTurns(threadId);
      expect(turns.map((turn) => [turn.delivery, turn.status])).toEqual([
        ["started", "completed"],
        ["background", "completed"],
      ]);
      const last = (await harness.store.readMessages(threadId)).at(-1)!;
      expect(last).toMatchObject({ role: "assistant", text: "tick-1", turnId: turns[1]!.id });
    } finally {
      await connection.close();
    }
  });
});
