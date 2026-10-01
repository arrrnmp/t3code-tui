import { spawnSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { testHarness } from "../../core/testing/harness.js";
import { ensureStoredProject } from "../../core/projects/projects.js";
import { OpenCodeDriver } from "../../core/providers/opencode/driver.js";
import { FakeOpencodeTransport } from "../../core/providers/opencode/tests/fakes.js";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { normalizeConfig } from "../../core/config.js";
import { CliError } from "../../core/errors.js";
import type { ProviderRuntimeEvent } from "../../core/providers/spi.js";
import type { TurnDriver, TurnOutcome } from "../../core/threads/execute.js";
import { createThread, readThread } from "../../core/threads/threads.js";
import { DirectConnection } from "../connection.js";
import { openClient } from "../client.js";
import type { ProviderSummary } from "../../core/catalog/summary.js";
import { recordUsageWindows, resetUsageLimitsForTests } from "../../core/usage/limits.js";

function storeRoot(): string {
  return process.env.MOXEN_STORE_ROOT!;
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * A driver that parks a question mid-turn, the way Claude's `canUseTool`
 * does, and only settles once it is answered or dismissed.
 */
class QuestionDriver implements TurnDriver {
  private readonly sessions = new Set<string>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());
  private parked: ((answer: Record<string, string> | null) => void) | null = null;
  answered: Record<string, string> | null = null;
  dismissed = false;

  hasSession(threadId: string): Effect.Effect<boolean, CliError> {
    return Effect.succeed(this.sessions.has(threadId));
  }

  startSession(input: { threadId: string }): Effect.Effect<unknown, CliError> {
    return Effect.sync(() => {
      this.sessions.add(input.threadId);
      return {};
    });
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
            toolName: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Which direction?",
                  header: "Direction",
                  options: [{ label: "Forward" }, { label: "Sideways" }],
                },
              ],
            },
          },
        } as ProviderRuntimeEvent),
      );
      return { threadId: input.threadId, turnId: "driver-turn-1" };
    });
  }

  interruptTurn(): Effect.Effect<void, CliError> {
    return Effect.void;
  }

  respondToUserInput(
    _threadId: string,
    _requestId: string,
    answers: Record<string, string>,
  ): Effect.Effect<void, CliError> {
    return Effect.sync(() => {
      this.answered = answers;
      this.parked?.(answers);
    });
  }

  respondToRequest(): Effect.Effect<void, CliError> {
    return Effect.sync(() => {
      this.dismissed = true;
      this.parked?.(null);
    });
  }

  async awaitTurn(): Promise<TurnOutcome> {
    // The runner awaits only after sending and persisting the resume
    // cursor; a test that answers inside that gap must not be lost (a real
    // driver keeps the answer). This raced under a loaded suite.
    if (this.answered === null && !this.dismissed) {
      await new Promise<void>((resolve) => {
        this.parked = () => resolve();
      });
    }
    return {
      status: "completed",
      text: this.answered ? `Answered: ${JSON.stringify(this.answered)}` : "Dismissed",
      usage: null,
      error: null,
    };
  }

  get streamEvents(): Stream.Stream<ProviderRuntimeEvent> {
    return Stream.fromQueue(this.queue);
  }
}

describe("DirectConnection parked questions", () => {
  async function askingHarness() {
    const driver = new QuestionDriver();
    const harness = await testHarness({
      drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver },
    });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    const workspaceRoot = await realpath(harness.work);
    const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
    await connection.dispatch({
      type: "thread.create",
      commandId: "c-qc",
      threadId: "thread-q",
      projectId: ensured.project.id,
      title: "Question",
      modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
    });
    await connection.dispatch({
      type: "thread.turn.start",
      commandId: "c-q",
      threadId: "thread-q",
      message: { text: "plan it" },
    });
    // The question has to reach the ledger while the turn is still parked:
    // the panel reads it from there, and the turn is blocked on the answer.
    await waitFor("question row", async () => {
      const read = await readThread(harness.store, "thread-q");
      return read.activities.some((activity) => activity.kind === "user-input.requested");
    });
    return { driver, connection, harness };
  }

  it("writes a parked question to the ledger and answers it through dispatch", async () => {
    const { driver, connection, harness } = await askingHarness();
    const read = await readThread(harness.store, "thread-q");
    const asked = read.activities.find((activity) => activity.kind === "user-input.requested");
    expect((asked?.payload as { requestId?: string }).requestId).toBe("req-1");

    await connection.dispatch({
      type: "thread.user-input.respond",
      commandId: "c-a",
      threadId: "thread-q",
      requestId: "req-1",
      // The panel sends multi-select answers as arrays; the SPI takes strings.
      answers: { "Which direction?": ["Forward", "Sideways"] },
    });
    expect(driver.answered).toEqual({ "Which direction?": "Forward, Sideways" });

    await waitFor("turn completion", async () => {
      const done = await readThread(harness.store, "thread-q");
      return done.turns[0]?.status === "completed";
    });
  });

  it("dismissing releases the turn instead of only closing the panel", async () => {
    const { driver, connection, harness } = await askingHarness();
    await connection.dispatch({
      type: "thread.user-input.dismiss",
      commandId: "c-d",
      threadId: "thread-q",
      requestId: "req-1",
    });
    expect(driver.dismissed).toBe(true);
    await waitFor("turn completion", async () => {
      const done = await readThread(harness.store, "thread-q");
      return done.turns[0]?.status === "completed";
    });
  });
});

describe("DirectConnection dispatch", () => {
  it("creates threads and runs turns to completion", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      const created = (await connection.dispatch({
        type: "thread.create",
        commandId: "c-1",
        threadId: "thread-1",
        projectId: ensured.project.id,
        title: "Hello",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
      })) as { threadId: string };
      expect(created.threadId).toBe("thread-1");

      const sent = await connection.dispatch({
        type: "thread.turn.start",
        commandId: "c-2",
        threadId: "thread-1",
        message: { text: "hi" },
      });
      expect(sent.accepted).toBe(true);

      await waitFor("turn completion", async () => {
        const read = await readThread(harness.store, "thread-1");
        return read.turns[0]?.status === "completed";
      });
      const read = await readThread(harness.store, "thread-1");
      expect(read.messages.map((message) => message.text)).toContain("Completed: hi");
    } finally {
      await connection.close();
    }
  });

  it("rejects unknown threads and command types", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await expect(
        connection.dispatch({
          type: "thread.turn.start",
          threadId: "missing",
          message: { text: "hi" },
        }),
      ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
      // Untyped on purpose: this is what a transport hands over from the
      // wire, and the runtime decoder has to reject it.
      const untyped = connection.dispatch.bind(connection) as (command: unknown) => Promise<unknown>;
      await expect(untyped({ type: "thread.frobnicate" })).rejects.toMatchObject({ code: "UNKNOWN_COMMAND" });
      await expect(untyped(null)).rejects.toMatchObject({ code: "UNKNOWN_COMMAND" });
    } finally {
      await connection.close();
    }
  });

  it("applies lifecycle and meta dispatches", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-1",
        projectId: ensured.project.id,
        title: "T",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });

      await connection.dispatch({ type: "thread.meta.update", threadId: "thread-1", title: "Renamed" });
      await connection.dispatch({
        type: "thread.model-selection.set",
        threadId: "thread-1",
        modelSelection: { instanceId: "grok", model: "grok-build" },
      });
      await connection.dispatch({ type: "thread.runtime-mode.set", threadId: "thread-1", runtimeMode: "auto" });
      await connection.dispatch({ type: "thread.snooze", threadId: "thread-1", snoozedUntil: "2030-01-01T00:00:00.000Z" });
      await connection.dispatch({ type: "thread.settle", threadId: "thread-1" });
      await connection.dispatch({ type: "thread.unsettle", threadId: "thread-1" });
      await connection.dispatch({ type: "thread.unsnooze", threadId: "thread-1" });
      const read = await readThread(harness.store, "thread-1");
      expect(read.thread.title).toBe("Renamed");
      expect(read.thread.modelSelection).toMatchObject({ instanceId: "grok" });
      expect(read.thread.runtimeMode).toBe("auto");
      expect(read.thread.settledAt).toBeNull();
      expect(read.thread.snoozedUntil).toBeNull();

      await connection.dispatch({ type: "thread.archive", threadId: "thread-1" });
      await connection.dispatch({ type: "thread.delete", threadId: "thread-1" });
      const gone = await harness.store.readThreadRecord("thread-1");
      expect(gone?.archivedAt).not.toBeNull();
      expect(gone?.deletedAt).not.toBeNull();

      const project = (await connection.dispatch({
        type: "project.create",
        projectId: "project-2",
        title: "Two",
        workspaceRoot: "/elsewhere",
      })) as { projectId: string; created: boolean };
      expect(project.created).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it("serves getConfig and null turn diffs", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: harness.drivers,
      catalog: async () => ({ providers: [], settings: {} }),
    });
    try {
      expect(await connection.getConfig()).toEqual({ providers: [], settings: {} });
      expect(await connection.turnDiff("missing", 1)).toBeNull();
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection subscriptions", () => {
  it("publishes shell snapshots and picks up new threads", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: harness.drivers,
      shellPollMs: 30,
      threadPollMs: 30,
    });
    const frames: unknown[] = [];
    const unsubscribe = connection.subscribeShell(
      {},
      (item) => frames.push(item),
      () => undefined,
    );
    try {
      await waitFor("shell sync", async () =>
        frames.some((frame) => (frame as { kind?: string }).kind === "synchronized"),
      );
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-shell",
        projectId: ensured.project.id,
        title: "Shell",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });
      await waitFor("thread row", async () =>
        frames.some((frame) => JSON.stringify(frame).includes("thread-shell")),
      );
    } finally {
      unsubscribe();
      await connection.close();
    }
  });

  it("streams provider text deltas into thread frames", async () => {
    const harness = await testHarness();
    const transport = new FakeOpencodeTransport();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: { opencode: () => new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } }) },
      shellPollMs: 30,
      threadPollMs: 30,
    });
    const frames: unknown[] = [];
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-stream",
        projectId: ensured.project.id,
        title: "Stream",
        modelSelection: { instanceId: "opencode/anthropic", model: "claude-opus-4-6" },
      });
      const unsubscribe = connection.subscribeThread(
        "thread-stream",
        {},
        (item) => frames.push(item),
        () => undefined,
      );
      try {
        await connection.dispatch({
          type: "thread.turn.start",
          threadId: "thread-stream",
          message: { text: "hi" },
        });
        await waitFor("prompt on the wire", async () => transport.servers[0]?.callsTo("session.prompt").length === 1);
        // The subscription bridge attaches on the thread poll interval;
        // pushed events have no replay, so let it attach first. (In
        // production the snapshot polls converge anything missed here.)
        await new Promise((resolve) => setTimeout(resolve, 250));
        await transport.servers[0]?.push({
          type: "message.part.updated",
          properties: {
            sessionID: "opencode-session-1",
            part: { id: "p-1", type: "text", text: "hel" },
          },
        });
        await waitFor("stream frame", async () =>
          frames.some((frame) => JSON.stringify(frame).includes("thread.message-sent")),
        );
        const frame = frames.find((entry) => JSON.stringify(entry).includes("thread.message-sent"));
        expect(JSON.stringify(frame)).toContain("hel");
      } finally {
        unsubscribe();
      }
    } finally {
      await connection.close();
    }
  });

  it("records a tool call once, with its payload, while the TUI watches", async () => {
    // The turn runner owns tool rows. This path used to record its own
    // payload-less row per event as well, so a tool-using turn run with the
    // TUI attached got bare duplicates beside the real cards.
    const harness = await testHarness();
    const transport = new FakeOpencodeTransport();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: { opencode: () => new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } }) },
      shellPollMs: 30,
      threadPollMs: 30,
    });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-tools",
        projectId: ensured.project.id,
        title: "Tools",
        modelSelection: { instanceId: "opencode/anthropic", model: "claude-opus-4-6" },
      });
      const unsubscribe = connection.subscribeThread("thread-tools", {}, () => undefined, () => undefined);
      try {
        await connection.dispatch({
          type: "thread.turn.start",
          threadId: "thread-tools",
          message: { text: "run it" },
        });
        await waitFor("prompt on the wire", async () => transport.servers[0]?.callsTo("session.prompt").length === 1);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const part = (status: string) => ({
          type: "message.part.updated" as const,
          properties: {
            sessionID: "opencode-session-1",
            part: {
              id: "prt-1",
              callID: "call-1",
              type: "tool",
              tool: "bash",
              state: { status, input: { command: "git status" } },
            },
          },
        });
        await transport.servers[0]?.push(part("running"));
        await transport.servers[0]?.push(part("completed"));
        await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
        await waitFor("tool rows on disk", async () =>
          (await harness.store.readActivities("thread-tools")).some((row) => row.kind === "tool-call.completed"),
        );
        const rows = await harness.store.readActivities("thread-tools");
        const tools = rows.filter((row) => row.kind.startsWith("tool-call."));
        expect(tools.map((row) => row.kind)).toEqual(["tool-call.started", "tool-call.completed"]);
        expect(tools.every((row) => row.payload !== undefined)).toBe(true);
        // No payload-less echo of the same call alongside them.
        expect(rows.some((row) => row.kind === "tool_execution")).toBe(false);
      } finally {
        unsubscribe();
      }
    } finally {
      await connection.close();
    }
  });
});

/** Completes every turn at once and records what the connection asked of it. */
class RecordingDriver implements TurnDriver {
  private readonly sessions = new Set<string>();
  private turn = 0;
  readonly starts: Array<{ threadId: string; resumeCursor?: string }> = [];
  readonly sends: Array<{ threadId: string; modelSelection?: { model: string } }> = [];
  readonly rollbacks: Array<{ threadId: string; numTurns: number }> = [];

  constructor(private readonly nativeId: string) {}

  rollbackThread(threadId: string, numTurns: number): Effect.Effect<unknown, CliError> {
    return Effect.sync(() => void this.rollbacks.push({ threadId, numTurns }));
  }

  hasSession(threadId: string): Effect.Effect<boolean, CliError> {
    return Effect.succeed(this.sessions.has(threadId));
  }

  startSession(input: { threadId: string; resumeCursor?: string }): Effect.Effect<unknown, CliError> {
    return Effect.sync(() => {
      this.starts.push(input);
      this.sessions.add(input.threadId);
      return {};
    });
  }

  sendTurn(input: { threadId: string; modelSelection?: { model: string } }): Effect.Effect<{ threadId: string; turnId: string }, CliError> {
    return Effect.sync(() => {
      this.sends.push(input);
      this.turn += 1;
      return { threadId: input.threadId, turnId: `driver-turn-${this.turn}` };
    });
  }

  resumeCursor(threadId: string): string | null {
    return this.sessions.has(threadId) ? this.nativeId : null;
  }

  interruptTurn(): Effect.Effect<void, CliError> {
    return Effect.void;
  }

  async awaitTurn(): Promise<TurnOutcome> {
    return { status: "completed", text: "ok", usage: null, error: null };
  }

  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent> = Stream.never;
}

describe("DirectConnection model and session continuity", () => {
  async function recordingHarness(driver: RecordingDriver) {
    const harness = await testHarness({ drivers: { codex: () => driver } });
    const workspaceRoot = await realpath(harness.work);
    const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
    return { harness, projectId: ensured.project.id };
  }

  async function runTurn(connection: DirectConnection, harness: { store: Parameters<typeof readThread>[0] }, text: string) {
    await connection.dispatch({ type: "thread.turn.start", threadId: "thread-m", message: { text } });
    await waitFor(`turn "${text}"`, async () => {
      const read = await readThread(harness.store, "thread-m");
      return read.turns.length > 0 && read.turns.every((turn) => turn.status === "completed");
    });
  }

  it("runs each turn on the model selected when it was sent, even on a live session", async () => {
    const driver = new RecordingDriver("native-1");
    const { harness, projectId } = await recordingHarness(driver);
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await connection.dispatch({
        type: "thread.create",
        threadId: "thread-m",
        projectId,
        title: "Models",
        modelSelection: { instanceId: "codex", model: "model-a" },
      });
      await runTurn(connection, harness, "one");
      await connection.dispatch({
        type: "thread.model-selection.set",
        threadId: "thread-m",
        modelSelection: { instanceId: "codex", model: "model-b" },
      });
      await runTurn(connection, harness, "two");

      // One session throughout: the switch has to reach it per turn.
      expect(driver.starts).toHaveLength(1);
      expect(driver.sends.map((send) => send.modelSelection?.model)).toEqual(["model-a", "model-b"]);
      const turns = await harness.store.readTurns("thread-m");
      expect(turns.map((turn) => turn.modelSelection?.model)).toEqual(["model-a", "model-b"]);
    } finally {
      await connection.close();
    }
  });

  it("hands the next process the provider session the last one ran", async () => {
    const first = new RecordingDriver("native-1");
    const { harness, projectId } = await recordingHarness(first);
    const before = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await before.dispatch({
        type: "thread.create",
        threadId: "thread-m",
        projectId,
        title: "Resume",
        modelSelection: { instanceId: "codex", model: "model-a" },
      });
      await runTurn(before, harness, "remember 7");
      expect(first.starts[0]?.resumeCursor).toBeUndefined();
    } finally {
      await before.close();
    }

    // A new connection with a new driver is what reopening the TUI gets.
    const second = new RecordingDriver("native-2");
    const after = new DirectConnection({ storeRoot: harness.root, drivers: { codex: () => second } });
    try {
      await runTurn(after, harness, "what was it?");
      expect(second.starts).toEqual([expect.objectContaining({ threadId: "thread-m", resumeCursor: "native-1" })]);
    } finally {
      await after.close();
    }
  });

  it("starts sessions with the config's MCP servers, overridden by the project's moxen.json", async () => {
    const driver = new RecordingDriver("native-1");
    const { harness, projectId } = await recordingHarness(driver);
    await writeFile(
      path.join(harness.work, "moxen.json"),
      JSON.stringify({
        mcpServers: {
          shared: { type: "http", url: "https://project.example/mcp" },
          dropped: null,
          local: { command: "node", args: ["server.js"], env: { TOKEN: "t" } },
        },
      }),
    );
    const config = normalizeConfig({
      mcpServers: {
        shared: { command: "global-shared" },
        dropped: { command: "global-dropped" },
      },
    });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => config });
    try {
      await connection.dispatch({
        type: "thread.create",
        threadId: "thread-m",
        projectId,
        title: "MCP",
        modelSelection: { instanceId: "codex", model: "model-a" },
      });
      await runTurn(connection, harness, "use the tools");
      const servers = (driver.starts[0] as unknown as { mcpServers: Array<Record<string, unknown>> }).mcpServers;
      expect(servers.map((server) => server.name)).toEqual(["local", "moxen", "shared"]);
      expect(servers[0]).toEqual({ name: "local", type: "stdio", command: "node", args: ["server.js"], env: { TOKEN: "t" } });
      expect(servers[2]).toEqual({ name: "shared", type: "http", url: "https://project.example/mcp", headers: {} });
      // moxen's own tools, hosted in this process and always loaded; a
      // provider that cannot host them reaches them through the fallback —
      // here the stdio child, bound to this thread and this store (no HTTP
      // endpoint: this connection never became a long-lived owner).
      expect(servers[1]).toMatchObject({ name: "moxen", type: "in-process", alwaysLoad: true });
      expect((servers[1]!.tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(["delegate", "task_status", "models", "task_cancel"]);
      const fallback = servers[1]!.fallback as { type: string; env: Record<string, string>; args: string[] };
      expect(fallback).toMatchObject({ type: "stdio", env: { MOXEN_STORE_ROOT: harness.root } });
      expect(fallback.args.slice(-2)).toEqual(["--thread", "thread-m"]);
    } finally {
      await connection.close();
    }
  });
});

/**
 * Completes a turn only when the test releases it, so ordering around a
 * running turn (queue, steer) is deterministic. Can also refuse to start
 * a session.
 */
class GateDriver implements TurnDriver {
  private readonly sessions = new Set<string>();
  private readonly gates = new Map<string, () => void>();
  private turn = 0;
  readonly prompts: string[] = [];
  readonly steers: string[] = [];
  steerTurn?: (threadId: string, text: string) => Effect.Effect<void, CliError>;

  constructor(private readonly options: { failStart?: boolean; steerable?: boolean } = {}) {
    if (options.steerable) {
      this.steerTurn = (_threadId, text) => Effect.sync(() => void this.steers.push(text));
    }
  }

  hasSession(threadId: string): Effect.Effect<boolean, CliError> {
    return Effect.succeed(this.sessions.has(threadId));
  }

  startSession(input: { threadId: string }): Effect.Effect<unknown, CliError> {
    if (this.options.failStart) return Effect.fail(new CliError("SPAWN_FAILED", "no binary on PATH"));
    return Effect.sync(() => {
      this.sessions.add(input.threadId);
      return {};
    });
  }

  readonly images: Array<ReadonlyArray<{ name: string; mimeType: string; data: string }>> = [];

  sendTurn(input: {
    threadId: string;
    prompt: string;
    images?: ReadonlyArray<{ name: string; mimeType: string; data: string }>;
  }): Effect.Effect<{ threadId: string; turnId: string }, CliError> {
    return Effect.sync(() => {
      this.prompts.push(input.prompt);
      this.images.push(input.images ?? []);
      this.turn += 1;
      return { threadId: input.threadId, turnId: `gate-${this.turn}` };
    });
  }

  interruptTurn(): Effect.Effect<void, CliError> {
    return Effect.void;
  }

  async awaitTurn(_threadId: string, turnId: string): Promise<TurnOutcome> {
    await new Promise<void>((resolve) => this.gates.set(turnId, resolve));
    return { status: "completed", text: `done ${turnId}`, usage: null, error: null };
  }

  /** Let the oldest open turn finish. */
  async release(): Promise<void> {
    await waitFor("an open driver turn", async () => this.gates.size > 0);
    const [turnId, resolve] = [...this.gates.entries()][0]!;
    this.gates.delete(turnId);
    resolve();
  }

  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent> = Stream.never;
}

describe("DirectConnection capabilities (formerly CLI-only)", () => {
  async function connected(options: { driver?: TurnDriver; config?: Record<string, unknown> } = {}) {
    const driver = options.driver;
    const harness = await testHarness(
      driver ? { drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver } } : {},
    );
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: harness.drivers,
      config: async () => ({ ...harness.config, ...options.config }),
    });
    return { harness, connection };
  }

  it("hands over to a new thread, resolving the project and waiting for the first turn", async () => {
    const { harness, connection } = await connected();
    try {
      const preview = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Plan it", dryRun: true });
      expect(preview.started).toBeNull();
      expect(preview.projectCreated).toBe(true);
      expect((await connection.query({ type: "projects.list" })).projects).toEqual([]);

      const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Plan it", wait: true });
      expect(done.started?.status).toBe("completed");
      expect(done.settings.effectiveThreadEnvMode).toBe("local");
      const read = await connection.query({ type: "thread.read", threadId: done.threadId, lastTurn: true });
      expect(read.thread.view).toBe("messages");
      if (read.thread.view === "messages") {
        expect(read.thread.messages.map((message) => message.text)).toEqual(["Plan it", "Completed: Plan it"]);
      }
      const listed = await connection.query({ type: "threads.list", cwd: harness.work });
      expect(listed.threads.map((thread) => thread.id)).toEqual([done.threadId]);
      expect((await connection.query({ type: "project.resolve", cwd: harness.work })).project?.id).toBe(done.project.id);
    } finally {
      await connection.close();
    }
  });

  it("provisions a worktree when the handover asks for one", async () => {
    const { harness, connection } = await connected();
    try {
      const done = await connection.dispatch({
        type: "thread.handover",
        cwd: harness.work,
        prompt: "Isolated work",
        threadEnvMode: "worktree",
        wait: true,
      });
      expect(done.worktree?.branch).toMatch(/^moxen\//);
      const inspected = await connection.query({ type: "thread.inspect", threadId: done.threadId });
      expect(inspected.thread.worktreePath).toBe(done.worktree?.path);
    } finally {
      await connection.close();
    }
  });

  it("delegates a task, reports it, and treats cancelling a finished one as a no-op", async () => {
    const { harness, connection } = await connected();
    try {
      const parent = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Parent", wait: true });
      const delegated = await connection.dispatch({ type: "thread.delegate", parentThreadId: parent.threadId, task: "Sub task" });
      expect(delegated.task).toMatchObject({ status: "completed", waitTimedOut: false, summary: "Completed: Sub task" });

      const status = await connection.query({
        type: "thread.task.status",
        parentThreadId: parent.threadId,
        taskId: delegated.task.taskId,
      });
      expect(status.task.status).toBe("completed");
      const cancelled = await connection.dispatch({
        type: "thread.task.cancel",
        parentThreadId: parent.threadId,
        taskId: delegated.task.taskId,
      });
      expect(cancelled).toMatchObject({ interruptRequested: false, task: { status: "completed" } });
    } finally {
      await connection.close();
    }
  });

  it("refuses to run turns on an archived thread", async () => {
    const { harness, connection } = await connected();
    try {
      const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Old", wait: true });
      await connection.dispatch({ type: "thread.archive", threadId: done.threadId });
      await expect(
        connection.dispatch({ type: "thread.turn.start", threadId: done.threadId, message: { text: "again" } }),
      ).rejects.toMatchObject({ code: "THREAD_ARCHIVED" });
    } finally {
      await connection.close();
    }
  });

  it("defaults a new thread's model and modes from config, not a hardcoded model", async () => {
    const { harness, connection } = await connected({
      config: { provider: "claudeAgent", model: "claude-opus-5", runtimeMode: "approval-required" },
    });
    try {
      const project = await connection.dispatch({ type: "project.ensure", cwd: harness.work });
      const created = await connection.dispatch({ type: "thread.create", projectId: project.project.id });
      const thread = await harness.store.readThreadRecord(created.threadId);
      expect(thread?.modelSelection).toMatchObject({ instanceId: "claudeAgent", model: "claude-opus-5" });
      expect(thread?.runtimeMode).toBe("approval-required");
    } finally {
      await connection.close();
    }
  });

  it("hides a model from every picker through getConfig", async () => {
    const { connection } = await connected();
    try {
      await connection.dispatch({ type: "model.visibility.set", instanceId: "claudeAgent", model: "claude-old", hidden: true });
      const config = await connection.getConfig();
      expect(config.settings.providerModelPreferences).toEqual({ claudeAgent: { hiddenModels: ["claude-old"] } });
    } finally {
      await connection.close();
    }
  });

  it("runs a queued turn once the turn ahead of it settles", async () => {
    const driver = new GateDriver();
    const { harness, connection } = await connected({ driver });
    try {
      const first = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "First" });
      const queued = await connection.dispatch({
        type: "thread.turn.start",
        threadId: first.threadId,
        message: { text: "Second" },
        delivery: "queue",
      });
      expect(queued).toMatchObject({ delivery: "queued", status: "queued" });

      await driver.release();
      // Promotion used to flip it to `running` with nothing to run it.
      await driver.release();
      await waitFor("both turns to complete", async () => {
        const turns = await harness.store.readTurns(first.threadId);
        return turns.length === 2 && turns.every((turn) => turn.status === "completed");
      });
      expect(driver.prompts).toEqual(["First", "Second"]);
    } finally {
      await connection.close();
    }
  });

  it("steers the running turn without starting a second provider run", async () => {
    const driver = new GateDriver();
    const { harness, connection } = await connected({ driver });
    try {
      const first = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Long job" });
      await waitFor("the first run to reach the driver", async () => driver.prompts.length === 1);
      const steered = await connection.dispatch({
        type: "thread.turn.start",
        threadId: first.threadId,
        message: { text: "Also check the tests" },
        delivery: "steer",
      });
      expect(steered.delivery).toBe("steered");
      expect(steered.turnId).toBe(first.started?.turnId);
      // Give a stray second run the time it would need to show up.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(driver.prompts).toEqual(["Long job"]);
      await driver.release();
      await waitFor("the running turn to complete", async () => {
        const turns = await harness.store.readTurns(first.threadId);
        return turns[0]?.status === "completed";
      });
    } finally {
      await connection.close();
    }
  });

  it("fails the turn, with the reason, when its session cannot start", async () => {
    const { harness, connection } = await connected({ driver: new GateDriver({ failStart: true }) });
    try {
      const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Go", wait: true });
      expect(done.started?.status).toBe("failed");
      const [turn] = await harness.store.readTurns(done.threadId);
      expect(turn?.error).toContain("no binary on PATH");
    } finally {
      await connection.close();
    }
  });

  it("rejects malformed queries at the boundary", async () => {
    const { connection } = await connected();
    try {
      const untyped = connection.query.bind(connection) as (query: unknown) => Promise<unknown>;
      await expect(untyped({ type: "threads.frobnicate" })).rejects.toMatchObject({ code: "UNKNOWN_QUERY" });
      await expect(untyped({ type: "thread.read", threadId: "t", view: "everything" })).rejects.toMatchObject({
        code: "INVALID_THREAD_OPTION",
      });
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection steering", () => {
  async function running(driver: GateDriver) {
    const harness = await testHarness({ drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver } });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    const first = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Long job" });
    await waitFor("the run to reach the driver", async () => driver.prompts.length === 1);
    return { harness, connection, threadId: first.threadId };
  }

  it("hands a steer to the running provider turn", async () => {
    const driver = new GateDriver({ steerable: true });
    const { connection, threadId } = await running(driver);
    try {
      const steered = await connection.dispatch({
        type: "thread.turn.start",
        threadId,
        message: { text: "Also check the tests" },
        delivery: "steer",
      });
      expect(steered).toMatchObject({ delivery: "steered", steerDelivered: true });
      expect(driver.steers).toEqual(["Also check the tests"]);
      await driver.release();
    } finally {
      await connection.close();
    }
  });

  it("only records a steer the provider cannot take, and says so", async () => {
    const driver = new GateDriver();
    const { connection, threadId } = await running(driver);
    try {
      const steered = await connection.dispatch({
        type: "thread.turn.start",
        threadId,
        message: { text: "Also check the tests" },
        delivery: "steer",
      });
      expect(steered).toMatchObject({ delivery: "steered", steerDelivered: false });
      await driver.release();
    } finally {
      await connection.close();
    }
  });

  it("does not open a fresh session to deliver a steer to a turn running elsewhere", async () => {
    const driver = new GateDriver({ steerable: true });
    const { harness, connection, threadId } = await running(driver);
    // A second process: its own drivers, no session for this thread.
    const elsewhereDriver = new GateDriver({ steerable: true });
    const elsewhere = new DirectConnection({
      storeRoot: harness.root,
      drivers: { claude: () => elsewhereDriver, codex: () => elsewhereDriver, grok: () => elsewhereDriver, opencode: () => elsewhereDriver },
      config: async () => harness.config,
    });
    try {
      const steered = await elsewhere.dispatch({
        type: "thread.turn.start",
        threadId,
        message: { text: "From the CLI" },
        delivery: "steer",
      });
      expect(steered).toMatchObject({ delivery: "steered", steerDelivered: false });
      expect(elsewhereDriver.steers).toEqual([]);
      expect(elsewhereDriver.prompts).toEqual([]);
      await driver.release();
    } finally {
      await elsewhere.close();
      await connection.close();
    }
  });
});

describe("DirectConnection revert", () => {
  async function threeTurns(driver: RecordingDriver, instanceId = "codex") {
    const harness = await testHarness({ drivers: { codex: () => driver, grok: () => driver, claude: () => driver } });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    const project = await connection.dispatch({ type: "project.ensure", cwd: harness.work });
    const { threadId } = await connection.dispatch({
      type: "thread.create",
      projectId: project.project.id,
      modelSelection: { instanceId, model: "m" },
    });
    for (const text of ["one", "two", "three"]) {
      await connection.dispatch({ type: "thread.turn.start", threadId, message: { text }, wait: true });
    }
    return { harness, connection, threadId };
  }

  it("rolls the provider back by the prompts it saw, then cuts the ledger", async () => {
    const driver = new RecordingDriver("native-1");
    const { harness, connection, threadId } = await threeTurns(driver);
    try {
      const turns = await harness.store.readTurns(threadId);
      // A steer delivered into the third turn: one more prompt the provider saw.
      await harness.store.appendLedger(threadId, "messages", {
        id: "steer-1",
        threadId,
        turnId: turns[2]!.id,
        role: "user",
        text: "and also",
        createdAt: new Date().toISOString(),
      });

      const reverted = await connection.dispatch({ type: "thread.conversation.revert", threadId, turnCount: 1 });
      expect(reverted).toMatchObject({ keptTurns: 1, removedTurns: 2, providers: ["codex"], accepted: true });
      expect(driver.rollbacks).toEqual([{ threadId, numTurns: 3 }]);

      const kept = turns[0]!.id;
      expect((await harness.store.readTurns(threadId)).map((turn) => turn.id)).toEqual([kept]);
      expect(new Set((await harness.store.readMessages(threadId)).map((message) => message.turnId))).toEqual(new Set([kept]));
      expect((await harness.store.readActivities(threadId)).every((row) => row.turnId === null || row.turnId === kept)).toBe(true);
      expect((await harness.store.readCheckpoints(threadId)).map((row) => row.turnId)).toEqual([kept]);

      // The thread carries on from there.
      await connection.dispatch({ type: "thread.turn.start", threadId, message: { text: "again" }, wait: true });
      expect(await harness.store.readTurns(threadId)).toHaveLength(2);
    } finally {
      await connection.close();
    }
  });

  it("puts the files back too when asked: to before the first dropped turn, with an undo ref", async () => {
    const driver = new RecordingDriver("native-1");
    const { harness, connection, threadId } = await threeTurns(driver);
    try {
      const thread = await harness.store.readThreadRecord(threadId);
      const cwd = thread!.env.path;
      // Every settled turn recorded what it changed (none of these did).
      expect((await harness.store.readCheckpoints(threadId)).map((row) => row.files)).toEqual([[], [], []]);
      // Work that landed after turn 2's snapshot was taken: a new file.
      await writeFile(path.join(cwd, "agent-made.txt"), "from a dropped turn\n");
      const reverted = await connection.dispatch({ type: "thread.conversation.revert", threadId, turnCount: 1, restoreFiles: true });
      expect(reverted).toMatchObject({ keptTurns: 1, removedTurns: 2, filesRestored: { files: 1 } });
      await expect(readFile(path.join(cwd, "agent-made.txt"), "utf8")).rejects.toThrow();
      const undoRef = (reverted as { filesRestored: { undoRef: string } }).filesRestored.undoRef;
      expect(undoRef).toMatch(/^refs\/moxen\/checkpoints\/.+\/revert-\d+$/);
      expect(spawnSync("git", ["rev-parse", "--verify", undoRef], { cwd }).status).toBe(0);
      // Without the flag the result carries no files field at all (the CLI envelope is pinned).
      const plain = await connection.dispatch({ type: "thread.conversation.revert", threadId, turnCount: 0 });
      expect(plain).not.toHaveProperty("filesRestored");
    } finally {
      await connection.close();
    }
  });

  it("refuses while a turn is in progress", async () => {
    const driver = new GateDriver();
    const harness = await testHarness({ drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver } });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    try {
      const first = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Long job" });
      await expect(
        connection.dispatch({ type: "thread.conversation.revert", threadId: first.threadId, turnCount: 0 }),
      ).rejects.toMatchObject({ code: "THREAD_BUSY" });
      await driver.release();
    } finally {
      await connection.close();
    }
  });

  it("refuses up front when a provider cannot forget, changing nothing", async () => {
    const driver = new RecordingDriver("native-g");
    const { harness, connection, threadId } = await threeTurns(driver, "grok");
    try {
      await expect(connection.dispatch({ type: "thread.conversation.revert", threadId, turnCount: 1 })).rejects.toMatchObject({
        code: "REVERT_UNSUPPORTED",
      });
      expect(driver.rollbacks).toEqual([]);
      expect(await harness.store.readTurns(threadId)).toHaveLength(3);
    } finally {
      await connection.close();
    }
  });

  it("just cuts the ledger when no provider remembers the turns", async () => {
    const driver = new RecordingDriver("native-1");
    const { harness, connection, threadId } = await threeTurns(driver);
    await connection.close();
    // A new process with no session, and a thread with no stored handle.
    const record = (await harness.store.readThreadRecord(threadId))!;
    await harness.store.writeThreadRecord({ ...record, providerSessions: {} });
    const fresh = new RecordingDriver("native-2");
    const later = new DirectConnection({ storeRoot: harness.root, drivers: { codex: () => fresh }, config: async () => harness.config });
    try {
      const reverted = await later.dispatch({ type: "thread.conversation.revert", threadId, turnCount: 2 });
      expect(reverted).toMatchObject({ removedTurns: 1, providers: [] });
      expect(fresh.rollbacks).toEqual([]);
      expect(await harness.store.readTurns(threadId)).toHaveLength(2);
    } finally {
      await later.close();
    }
  });
});

describe("DirectConnection images", () => {
  const upload = (name: string) => ({
    type: "image" as const,
    name,
    mimeType: "image/png",
    sizeBytes: 8,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });

  it("saves them with the message and sends them to the provider — queued turns included", async () => {
    const driver = new GateDriver();
    const harness = await testHarness({ drivers: { claude: () => driver, codex: () => driver, grok: () => driver, opencode: () => driver } });
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    try {
      const first = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Busy" });
      await waitFor("the first run", async () => driver.prompts.length === 1);
      await connection.dispatch({
        type: "thread.turn.start",
        threadId: first.threadId,
        message: { text: "What is in this?", attachments: [upload("shot.png")] },
        delivery: "queue",
      });

      const [, queued] = await harness.store.readMessages(first.threadId);
      expect(queued!.attachments).toEqual([
        expect.objectContaining({ type: "image", name: "shot.png", mimeType: "image/png", sizeBytes: 8 }),
      ]);
      const saved = await (await import("node:fs/promises")).readFile(queued!.attachments![0]!.path);
      expect(saved.toString("base64")).toBe("iVBORw0KGgo=");
      const thread = await connection.query({ type: "thread.read", threadId: first.threadId });
      if (thread.thread.view === "messages") {
        expect(thread.thread.messages[1]).toMatchObject({ attachments: [{ name: "shot.png" }] });
      }

      // The queued turn runs later, from the ledger: its image comes off disk.
      await driver.release();
      await waitFor("the queued turn to reach the driver", async () => driver.prompts.length === 2);
      expect(driver.prompts[1]).toBe("What is in this?");
      expect(driver.images[1]).toEqual([{ name: "shot.png", mimeType: "image/png", data: "iVBORw0KGgo=" }]);
      await driver.release();
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection plan usage", () => {
  it("serves the recorded usage windows and fills them into the provider list", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: harness.drivers,
      providers: async () => [
        {
          instanceId: "claudeAgent",
          driver: "claude",
          displayName: "Claude",
          enabled: true,
          status: "ready",
          authStatus: null,
          models: [],
          usageLimits: null,
        } as unknown as ProviderSummary,
      ],
    });
    try {
      const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
      recordUsageWindows("claude", [{ id: "session", label: "Session", resetsAt, exhausted: false, usedPercent: 37 }]);
      const usage = await connection.query({ type: "usage.limits" });
      expect(usage.providers.claude?.windows).toEqual([{ id: "session", kind: "session", label: "Session", usedPercent: 37, resetsAt }]);
      const listed = await connection.query({ type: "providers.list" });
      expect(listed.providers[0]?.usageLimits?.windows[0]?.usedPercent).toBe(37);
    } finally {
      resetUsageLimitsForTests();
      await connection.close();
    }
  });
});

describe("DirectConnection settings", () => {
  it("reads every setting with its descriptor and current value", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const snapshot = await connection.query({ type: "settings.read" });
      // The descriptors ride along so a client talking to a newer server
      // renders the settings that server actually honours.
      const runtimeMode = snapshot.settings.find((view) => view.descriptor.key === "runtimeMode");
      expect(runtimeMode?.descriptor.label).toBe("Tool permissions");
      expect(runtimeMode?.value).toBe("full-access");
      expect(runtimeMode?.explicit).toBe(true);
      const backdrop = snapshot.settings.find((view) => view.descriptor.key === "ui.backdrop");
      expect(backdrop).toMatchObject({ value: "animated", explicit: false });
    } finally {
      await connection.close();
    }
  });

  it("writes a nested key through and answers with the whole snapshot", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const result = await connection.dispatch({
        type: "settings.set",
        key: "providers.claude.thinkingDisplay",
        value: "omitted",
      });
      expect(result.accepted).toBe(true);
      const written = result.settings.find((view) => view.descriptor.key === "providers.claude.thinkingDisplay");
      expect(written).toMatchObject({ value: "omitted", explicit: true });
      // The file is the source of truth: a fresh read must agree.
      const reread = await connection.query({ type: "settings.read" });
      expect(reread.settings.find((view) => view.descriptor.key === "providers.claude.thinkingDisplay")?.value).toBe(
        "omitted",
      );
      expect(JSON.parse(await readFile(reread.path, "utf8"))).toMatchObject({
        providers: { claude: { thinkingDisplay: "omitted" } },
      });
    } finally {
      await connection.close();
    }
  });

  it("refuses a bad value without writing anything", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await expect(
        connection.dispatch({ type: "settings.set", key: "ui.backdrop", value: "sparkly" }),
      ).rejects.toThrow("ui.backdrop must be one of: animated, static, off.");
      const snapshot = await connection.query({ type: "settings.read" });
      expect(snapshot.settings.find((view) => view.descriptor.key === "ui.backdrop")).toMatchObject({
        value: "animated",
        explicit: false,
      });
    } finally {
      await connection.close();
    }
  });

  it("keeps every edit made in one session, the way the TUI connects", async () => {
    // The TUI once handed its connection the config object it launched
    // with. Every read then returned launch-time values (a click flashed
    // and snapped back), and each write re-applied onto that stale object,
    // so a second edit silently undid the first. It now passes the path.
    const harness = await testHarness();
    const configPath = path.join(harness.root, "tui-config.json");
    const connection = await openClient({ mode: "direct", configPath, drivers: harness.drivers });
    try {
      await connection.dispatch({ type: "settings.set", key: "ui.backdrop", value: "off" });
      const second = await connection.dispatch({ type: "settings.set", key: "git.historyLimit", value: "120" });
      const valueOf = (key: string) => second.settings.find((view) => view.descriptor.key === key)?.value;
      expect(valueOf("ui.backdrop")).toBe("off");
      expect(valueOf("git.historyLimit")).toBe(120);
      expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
        ui: { backdrop: "off" },
        git: { historyLimit: 120 },
      });
    } finally {
      await connection.close();
    }
  });

  it("refuses a key it does not know", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await expect(connection.dispatch({ type: "settings.set", key: "nope", value: "1" })).rejects.toThrow(
        "Unknown config key: nope",
      );
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection git and forge", () => {
  it("reads a thread's own checkout, not the process's", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await connection.dispatch({
        type: "thread.create",
        threadId: "git-thread",
        projectId: ensured.project.id,
        title: "Git",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });
      const overview = await connection.query({ type: "git.overview", threadId: "git-thread" });
      expect(overview.isRepository).toBe(true);
      expect(overview.branch).toBe("main");
      // The harness seeds one commit so HEAD resolves.
      expect(overview.commits.length).toBeGreaterThan(0);
      expect(overview.branches.some((branch) => branch.name === "main")).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it("reports no forge for a checkout with no remote, rather than failing", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await connection.dispatch({
        type: "thread.create",
        threadId: "forge-thread",
        projectId: ensured.project.id,
        title: "Forge",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });
      const detection = await connection.query({ type: "forge.detect", threadId: "forge-thread" });
      expect(detection.kind).toBeNull();
      expect(detection.reason).toMatch(/no origin remote/i);
      // An unusable forge yields an empty list, not an error: the panel
      // shows why alongside the history it can still read.
      const listed = await connection.query({ type: "forge.requests.list", threadId: "forge-thread" });
      expect(listed.requests).toEqual([]);
    } finally {
      await connection.close();
    }
  });

  it("refuses git and forge reads for a thread that does not exist", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await expect(connection.query({ type: "git.overview", threadId: "ghost" })).rejects.toThrow("No thread ghost.");
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection continue in a new thread", () => {
  it("opens a thread on the same project, model and checkout, holding the handoff until asked", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await connection.dispatch({
        type: "thread.create",
        threadId: "old-thread",
        projectId: ensured.project.id,
        title: "Auth audit",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "auto-accept-edits",
      });
      const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
      const result = await connection.dispatch({ type: "thread.continue", threadId: "old-thread", scheduledFor });
      expect(result).toMatchObject({ accepted: true, title: "Auth audit (continued)", scheduledFor });

      const fresh = await connection.query({ type: "thread.inspect", threadId: result.threadId });
      const inspected = fresh.thread as unknown as {
        projectId: string;
        modelSelection: { instanceId: string; model: string };
        runtimeMode: string;
      };
      expect(inspected.projectId).toBe(ensured.project.id);
      expect(inspected.modelSelection).toMatchObject({ instanceId: "codex", model: "gpt-5.4" });
      expect(inspected.runtimeMode).toBe("auto-accept-edits");

      // The handoff is the new thread's first message, waiting for its time.
      const read = await connection.query({ type: "thread.read", threadId: result.threadId });
      const messages = (read.thread as unknown as { messages: Array<{ role: string; text: string }> }).messages;
      expect(messages[0]?.role).toBe("user");
      expect(messages[0]?.text.startsWith("# Continuing: Auth audit")).toBe(true);

      // The old thread points at its continuation.
      const old = await connection.query({ type: "thread.read", threadId: "old-thread", view: "turn-items" });
      expect(JSON.stringify(old)).toContain("Continued in");
    } finally {
      await connection.close();
    }
  });

  it("refuses a thread that does not exist", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await expect(connection.dispatch({ type: "thread.continue", threadId: "ghost" })).rejects.toThrow("No thread ghost.");
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection side questions", () => {
  it("refuses plainly for a provider that cannot copy a session, and never touches the thread", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await connection.dispatch({
        type: "thread.create",
        threadId: "btw-thread",
        projectId: ensured.project.id,
        title: "Btw",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });
      await expect(
        connection.dispatch({ type: "thread.side-question", threadId: "btw-thread", question: "what did we decide?" }),
      ).rejects.toThrow(/\/btw needs a provider .* codex cannot/);
      const read = await connection.query({ type: "thread.read", threadId: "btw-thread" });
      expect((read.thread as unknown as { messages: unknown[] }).messages).toEqual([]);
    } finally {
      await connection.close();
    }
  });
});
