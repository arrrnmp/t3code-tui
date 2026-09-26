/**
 * Answering a parked question from the CLI. The question lives in the
 * driver of the process running the turn, so this only works when the CLI
 * talks to that process — a shared server — and must refuse, not guess,
 * when it does not.
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../../core/errors.js";
import type { ProviderRuntimeEvent } from "../../../core/providers/spi.js";
import type { TurnDriver, TurnOutcome } from "../../../core/threads/execute.js";
import { testHarness } from "../../../core/testing/harness.js";
import { DirectConnection } from "../../../server/connection.js";
import { RemoteConnection } from "../../../server/transport/remote.js";
import { serve } from "../../../server/transport/serve.js";
import { testEndpoint } from "../../../server/transport/tests/endpoint.js";
import { createHandoverThread } from "../../handover/handover.js";
import { setClientFactory } from "../../infra/client.js";
import { answerQuestion, dismissQuestion, listQuestions } from "../threads.js";

/** Parks one two-question request per turn, settling once it is answered or declined. */
class AskingDriver implements TurnDriver {
  private readonly sessions = new Set<string>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());
  private release: (() => void) | null = null;
  /** Answered before the runner began awaiting: a real driver keeps that, and so must this. */
  private settled = false;
  answered: Record<string, string> | null = null;
  declined = false;

  hasSession(threadId: string): Effect.Effect<boolean, CliError> {
    return Effect.succeed(this.sessions.has(threadId));
  }

  startSession(input: { threadId: string }): Effect.Effect<unknown, CliError> {
    return Effect.sync(() => void this.sessions.add(input.threadId));
  }

  sendTurn(input: { threadId: string }): Effect.Effect<{ threadId: string; turnId: string }, CliError> {
    return Effect.sync(() => {
      Effect.runSync(
        Queue.offer(this.queue, {
          type: "user-input.request.opened",
          provider: "claude",
          threadId: input.threadId,
          requestId: "req-1",
          raw: {
            input: {
              questions: [
                { question: "Which direction?", header: "Direction", options: [{ label: "Forward" }, { label: "Sideways" }] },
                { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "lint" }, { label: "tests" }] },
              ],
            },
          },
        } as ProviderRuntimeEvent),
      );
      return { threadId: input.threadId, turnId: "d-1" };
    });
  }

  interruptTurn(): Effect.Effect<void, CliError> {
    return Effect.void;
  }

  respondToUserInput(_threadId: string, _requestId: string, answers: Record<string, string>): Effect.Effect<void, CliError> {
    return Effect.sync(() => {
      this.answered = answers;
      this.settled = true;
      this.release?.();
    });
  }

  respondToRequest(): Effect.Effect<void, CliError> {
    return Effect.sync(() => {
      this.declined = true;
      this.settled = true;
      this.release?.();
    });
  }

  async awaitTurn(): Promise<TurnOutcome> {
    if (!this.settled) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    return { status: "completed", text: "ok", usage: null, error: null };
  }

  get streamEvents(): Stream.Stream<ProviderRuntimeEvent> {
    return Stream.fromQueue(this.queue);
  }
}

const teardown: Array<() => Promise<void>> = [];

afterEach(async () => {
  setClientFactory(null);
  for (const step of teardown.splice(0).reverse()) await step().catch(() => undefined);
});

async function waitFor(label: string, check: () => Promise<boolean>): Promise<void> {
  // Polls until the condition holds; the ceiling only matters under a loaded suite.
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A server running the turn, and every CLI call going to it. */
async function servedQuestion() {
  const driver = new AskingDriver();
  const harness = await testHarness({ drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver } });
  const endpoint = testEndpoint();
  const api = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
  const server = await serve({ endpoint, api, onClose: () => api.close() });
  const connections: RemoteConnection[] = [];
  setClientFactory(async () => {
    const connection = await RemoteConnection.connect(endpoint);
    connections.push(connection);
    return connection;
  });
  teardown.push(async () => {
    for (const connection of connections) await connection.close();
    await server.close();
  });
  const created = await createHandoverThread(harness.config, { cwd: harness.work, prompt: "Go", noWait: true });
  const threadId = created.thread.id;
  await waitFor("the question", async () => (await listQuestions(harness.config, threadId)).requests.length === 1);
  return { harness, driver, threadId };
}

describe("parked questions from the CLI", () => {
  it("lists and answers them through a shared server", async () => {
    const { harness, driver, threadId } = await servedQuestion();
    const listed = await listQuestions(harness.config, threadId);
    expect(listed.requests[0]).toMatchObject({
      requestId: "req-1",
      questions: [{ question: "Which direction?" }, { question: "Which checks?", multiSelect: true }],
    });

    await expect(answerQuestion(harness.config, threadId, { answers: ["Forward"] })).rejects.toMatchObject({
      code: "INVALID_THREAD_OPTION",
    });
    await expect(answerQuestion(harness.config, threadId, { answers: ["Backward", "lint"] })).resolves.toBeDefined();
    // Free text is allowed unless the question says otherwise.
    expect(driver.answered).toEqual({ "Which direction?": "Backward", "Which checks?": "lint" });
    await waitFor("the turn to settle", async () => (await harness.store.readTurns(threadId))[0]?.status === "completed");
    await expect(listQuestions(harness.config, threadId)).resolves.toMatchObject({ requests: [] });
  });

  it("dismisses them, releasing the turn", async () => {
    const { harness, driver, threadId } = await servedQuestion();
    await dismissQuestion(harness.config, threadId);
    expect(driver.declined).toBe(true);
    await waitFor("the turn to settle", async () => (await harness.store.readTurns(threadId))[0]?.status === "completed");
  });

  it("refuses when the turn runs in another process", async () => {
    const { harness, threadId } = await servedQuestion();
    // An in-process client with its own drivers: no session, no parked question.
    const stranger = new AskingDriver();
    setClientFactory(async () =>
      new DirectConnection({
        storeRoot: harness.root,
        drivers: { claude: () => stranger, codex: () => stranger, grok: () => stranger, opencode: () => stranger },
        config: async () => harness.config,
      }),
    );
    await expect(answerQuestion(harness.config, threadId, { answers: ["Forward", "lint"] })).rejects.toMatchObject({
      code: "REQUEST_NOT_OWNED",
    });
    expect(stranger.answered).toBeNull();
  });
});
