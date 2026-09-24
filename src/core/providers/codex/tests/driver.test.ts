import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
import type { ProviderRuntimeEvent } from "../../spi.js";
import { CodexDriver, codexContextUsageOf } from "../driver.js";
import { FakeCodexTransport } from "./fakes.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function collectEvents(driver: CodexDriver, count: number): Promise<ProviderRuntimeEvent[]> {
  const chunk = await Effect.runPromise(Stream.runCollect(Stream.take(driver.streamEvents, count)));
  return [...chunk];
}

function openedRequestId(events: ProviderRuntimeEvent[], type: string): string {
  const opened = events.find((event) => event.type === type);
  expect(opened).toBeDefined();
  return (opened as { requestId: string }).requestId;
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (cause) {
    if (cause instanceof CliError) return cause.code;
    throw cause;
  }
  throw new Error("expected a CliError");
}

const START = { threadId: "thread-1", workingDirectory: "/repo" };

describe("codex session resume", () => {
  it("reattaches to the thread a previous process started, without replaying turns", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, resumeCursor: "codex-thread-old" }));
    const server = transport.sessions[0]!.server;
    expect(server.requestsTo("thread/resume")[0]!.params).toMatchObject({
      threadId: "codex-thread-old",
      excludeTurns: true,
      cwd: "/repo",
    });
    expect(server.requestsTo("thread/start")).toEqual([]);
    expect(driver.resumeCursor("thread-1")).toBe("codex-thread-old");
  });

  it("starts a new thread when the app-server lost the old one", async () => {
    const transport = new FakeCodexTransport({ lostThreads: ["codex-thread-old"] });
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, resumeCursor: "codex-thread-old" }));
    expect(transport.sessions[0]!.server.requestsTo("thread/start")).toHaveLength(1);
    expect(driver.resumeCursor("thread-1")).toBe("codex-thread-1");
  });
});

describe("codex driver turns", () => {
  it("starts a session with the static policy and runs a turn", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    expect(driver.accountTypeOf("thread-1")).toBe("chatgpt");

    const threadStart = transport.sessions[0]!.server.requestsTo("thread/start")[0]!;
    expect(threadStart.params).toMatchObject({
      cwd: "/repo",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });

    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const server = transport.sessions[0]!.server;
    const turnStart = server.requestsTo("turn/start")[0]!;
    expect(turnStart.params).toMatchObject({
      threadId: "codex-thread-1",
      input: [{ type: "text", text: "hi" }],
    });

    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    server.notify("turn/started", { threadId: "codex-thread-1", turn: { id: "srv-1" } });
    server.notify("item/agentMessage/delta", { text: "hello" });
    server.notify("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 1 },
        last: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 1 },
      },
    });
    server.notify("turn/completed", {
      threadId: "codex-thread-1",
      turn: { id: "srv-1", status: "completed" },
    });
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("hello");
    expect(outcome.usage).toMatchObject({ input: 10, cacheRead: 2, output: 5, thinking: 1 });
    // No `modelContextWindow` or `totalTokens` in this notification: the
    // window stays unknown and used falls back to input + output.
    expect(await driver.contextUsage("thread-1")).toEqual({
      usedTokens: 15,
      maxTokens: null,
      cachedInputTokens: 2,
      autoCompactThreshold: null,
      compactsAutomatically: null,
    });

    const snapshot = await Effect.runPromise(driver.readThread("thread-1"));
    expect(snapshot.turns[0]!.items.map((item) => (item as { kind: string }).kind)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("lists skills for a directory with skills/list, on a session it then closes", async () => {
    const transport = new FakeCodexTransport({
      skills: [
        {
          cwd: "/repo",
          errors: [],
          skills: [
            { name: "deploy", description: "Ship it", interface: { displayName: "Deploy", shortDescription: "Ship" }, enabled: true },
            { name: "old", description: "Retired", enabled: false },
          ],
        },
      ],
    });
    const driver = new CodexDriver({ transport });
    const inventory = await driver.skillInventory("/repo");
    const server = transport.sessions[0]!.server;
    expect(server.requestsTo("skills/list")[0]!.params).toEqual({ cwds: ["/repo"] });
    expect(inventory.trigger).toBe("$");
    expect(inventory.skills).toMatchObject([
      { name: "deploy", displayName: "Deploy", shortDescription: "Ship", enabled: true },
      { name: "old", enabled: false },
    ]);
    // Only the per-call catalog session was started, and it is gone again.
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(false);
  });

  it("passes runtime instructions as developerInstructions", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, instructions: "Report back." }));
    expect(transport.sessions[0]!.server.requestsTo("thread/start")[0]!.params).toMatchObject({
      developerInstructions: "Report back.",
    });
  });

  it("sends no model for codex-default, so the app-server's own default applies", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(
      driver.startSession({ ...START, modelSelection: { instanceId: "codex", model: "codex-default" } }),
    );
    await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "hi", modelSelection: { instanceId: "codex", model: "codex-default" } }),
    );
    const server = transport.sessions[0]!.server;
    expect(server.requestsTo("thread/start")[0]!.params).not.toHaveProperty("model");
    expect(server.requestsTo("turn/start")[0]!.params).not.toHaveProperty("model");
  });

  it("keeps commentary messages out of the turn's answer", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const events: ProviderRuntimeEvent[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const server = transport.sessions[0]!.server;
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    server.notify("turn/started", { threadId: "codex-thread-1", turn: { id: "srv-1" } });
    const agentMessage = (id: string, phase: string, text = "") => ({
      threadId: "codex-thread-1",
      turnId: "srv-1",
      item: { type: "agentMessage", id, text, phase },
    });
    server.notify("item/started", agentMessage("m-1", "commentary"));
    server.notify("item/agentMessage/delta", { itemId: "m-1", delta: "Checking the repo first." });
    server.notify("item/completed", agentMessage("m-1", "commentary", "Checking the repo first."));
    server.notify("item/started", agentMessage("m-2", "final_answer"));
    server.notify("item/agentMessage/delta", { itemId: "m-2", delta: "All " });
    server.notify("item/agentMessage/delta", { itemId: "m-2", delta: "done." });
    server.notify("turn/completed", {
      threadId: "codex-thread-1",
      turn: { id: "srv-1", status: "completed" },
    });
    const outcome = await outcomePromise;
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(outcome.text).toBe("All done.");
    const streamed = events.flatMap((event) => (event.type === "message.part.updated" ? [event.text] : []));
    expect(streamed.join("")).toBe("All done.");
  });

  it("requires auth and rejects concurrent turns", async () => {
    const locked = new FakeCodexTransport({ failRequests: { "account/read": "Not logged in" } });
    const lockedDriver = new CodexDriver({ transport: locked });
    expect(await codeOf(() => Effect.runPromise(lockedDriver.startSession(START)))).toBe(
      "CODEX_AUTH_REQUIRED",
    );

    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "one" }));
    expect(await codeOf(() => Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "two" })))).toBe(
      "TURN_BUSY",
    );
  });

  it("interrupts a running turn", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    await expect(outcomePromise).resolves.toMatchObject({ status: "interrupted" });
    expect(transport.sessions[0]!.server.requestsTo("turn/interrupt")).toHaveLength(1);
  });

  it("constrains plan turns to untrusted approvals", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "hi", interactionMode: "plan" }),
    );
    expect(transport.sessions[0]!.server.requestsTo("turn/start")[0]!.params).toMatchObject({
      approvalPolicy: "untrusted",
    });
  });

  it("enforces medium effort unless overridden", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    expect(transport.sessions[0]!.server.requestsTo("turn/start")[0]!.params).toMatchObject({
      effort: "medium",
    });

    const transport2 = new FakeCodexTransport();
    const driver2 = new CodexDriver({ transport: transport2 });
    await Effect.runPromise(driver2.startSession(START));
    await Effect.runPromise(
      driver2.sendTurn({
        threadId: "thread-1",
        prompt: "hi",
        modelSelection: { instanceId: "codex", model: "gpt-5.4", options: [{ id: "reasoningEffort", value: "high" }] },
      }),
    );
    expect(transport2.sessions[0]!.server.requestsTo("turn/start")[0]!.params).toMatchObject({
      effort: "high",
    });
  });
});

describe("codex driver approvals", () => {
  async function approvalSession() {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, runtimeMode: "approval-required" }));
    const threadStart = transport.sessions[0]!.server.requestsTo("thread/start")[0]!;
    expect(threadStart.params).toMatchObject({ approvalPolicy: "untrusted", sandbox: "read-only" });
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const server = transport.sessions[0]!.server;
    return { transport, driver, server };
  }

  it("parks command approvals until answered", async () => {
    const { driver, server } = await approvalSession();
    const eventsPromise = collectEvents(driver, 2);
    const answerPromise = server.ask("item/commandExecution/requestApproval", {
      threadId: "codex-thread-1",
      approvalId: "a-1",
      command: ["rm", "-rf", "/"],
    });
    const events = await eventsPromise;
    const requestId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", requestId, { kind: "accept" }));
    await expect(answerPromise).resolves.toEqual({ decision: "accept" });
  });

  it("acceptForSession auto-approves later prompts", async () => {
    const { driver, server } = await approvalSession();
    const eventsPromise = collectEvents(driver, 2);
    const first = server.ask("item/fileChange/requestApproval", { threadId: "codex-thread-1" });
    const events = await eventsPromise;
    const requestId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(
      driver.respondToRequest("thread-1", requestId, { kind: "acceptForSession" }),
    );
    await expect(first).resolves.toEqual({ decision: "accept" });

    await expect(
      server.ask("item/fileChange/requestApproval", { threadId: "codex-thread-1" }),
    ).resolves.toEqual({ decision: "accept" });
  });

  it("declines, cancels, and rejects unknown or mismatched requests", async () => {
    const { driver, server } = await approvalSession();
    const eventsPromise = collectEvents(driver, 3);
    const declined = server.ask("item/permissions/requestApproval", { threadId: "codex-thread-1" });
    const inputAsked = server.ask("item/tool/requestUserInput", {
      threadId: "codex-thread-1",
      questions: [],
    });
    const events = await eventsPromise;
    const declineId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", declineId, { kind: "decline" }));
    await expect(declined).resolves.toEqual({ decision: "decline" });

    const inputId = openedRequestId(events, "user-input.request.opened");
    expect(
      await codeOf(() => Effect.runPromise(driver.respondToRequest("thread-1", inputId, { kind: "accept" }))),
    ).toBe("REQUEST_MISMATCH");
    expect(
      await codeOf(() => Effect.runPromise(driver.respondToRequest("thread-1", "nope", { kind: "accept" }))),
    ).toBe("REQUEST_UNKNOWN");
    await Effect.runPromise(driver.respondToUserInput("thread-1", inputId, { color: "blue" }));
    await expect(inputAsked).resolves.toEqual({ answers: { color: { answers: ["blue"] } } });
  });

  it("releases a parked question when it is dismissed", async () => {
    // Dismissal used to throw REQUEST_MISMATCH, so closing the panel left
    // the server call blocked until the next interrupt. A declined question
    // answers nothing rather than refusing a permission: `{ decision }` is
    // not a shape `requestUserInput` understands.
    const { driver, server } = await approvalSession();
    // Two opens plus the earlier rate-limits probe event.
    const eventsPromise = collectEvents(driver, 3);
    const asked = server.ask("item/tool/requestUserInput", {
      threadId: "codex-thread-1",
      questions: [],
    });
    const elicited = server.ask("mcpServer/elicitation/request", { threadId: "codex-thread-1" });
    const events = await eventsPromise;
    const ids = events
      .filter((event) => event.type === "user-input.request.opened")
      .map((event) => (event as { requestId: string }).requestId);
    expect(ids).toHaveLength(2);
    await Effect.runPromise(driver.respondToRequest("thread-1", ids[0]!, { kind: "decline" }));
    await Effect.runPromise(driver.respondToRequest("thread-1", ids[1]!, { kind: "decline" }));
    await expect(asked).resolves.toEqual({ answers: {} });
    await expect(elicited).resolves.toEqual({ action: "decline" });
  });

  it("answers elicitation and executes dynamic calls on accept", async () => {
    const { driver, server } = await approvalSession();
    const eventsPromise = collectEvents(driver, 3);
    const elicited = server.ask("mcpServer/elicitation/request", { threadId: "codex-thread-1" });
    const dynamic = server.ask("item/tool/call", {
      threadId: "codex-thread-1",
      callId: "call-1",
      tool: "subagent",
    });
    const events = await eventsPromise;
    // Two user-input/permission opens + the earlier rate-limits probe event.
    expect(events.map((event) => event.type)).toContain("permission.request.opened");
    const dynamicId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", dynamicId, { kind: "accept" }));
    await expect(dynamic).resolves.toEqual({ success: true, contentItems: [] });

    const elicitationId = openedRequestId(events, "user-input.request.opened");
    await Effect.runPromise(driver.respondToUserInput("thread-1", elicitationId, { token: "t" }));
    await expect(elicited).resolves.toEqual({ action: "accept", content: { token: "t" } });
  });
});

describe("codex driver compaction, rollback, models", () => {
  it("starts native compaction and observes the boundary", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    expect(driver.compaction).toMatchObject({ type: "native" });
    const eventsPromise = collectEvents(driver, 2);
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const server = transport.sessions[0]!.server;
    await Effect.runPromise(driver.compaction.start("thread-1"));
    expect(server.requestsTo("thread/compact/start")).toHaveLength(1);
    server.notify("thread/compacted", { threadId: "codex-thread-1" });
    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toContain("thread.state.changed");
  });

  it("rolls back via revert, falling back to rollback", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    for (const [prompt, serverId] of [["one", "srv-1"], ["two", "srv-2"]] as const) {
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt }));
      const done = driver.awaitTurn("thread-1", sent.turnId);
      server.notify("turn/started", { threadId: "codex-thread-1", turn: { id: serverId } });
      server.notify("turn/completed", {
        threadId: "codex-thread-1",
        turn: { id: serverId, status: "completed" },
      });
      await done;
    }
    const snapshot = await Effect.runPromise(driver.rollbackThread("thread-1", 1));
    expect(server.requestsTo("thread/revert")[0]!.params).toMatchObject({
      threadId: "codex-thread-1",
      beforeTurnId: "srv-2",
    });
    expect(snapshot.turns).toHaveLength(1);

    expect(await codeOf(() => Effect.runPromise(driver.rollbackThread("thread-1", 0)))).toBe(
      "INVALID_ROLLBACK",
    );
    // More than this process has seen: the app-server holds the history,
    // so the count goes to it to honour or refuse.
    await Effect.runPromise(driver.rollbackThread("thread-1", 5));
    expect(server.requestsTo("thread/rollback").at(-1)!.params).toEqual({ threadId: "codex-thread-1", numTurns: 5 });
  });

  it("rolls back a resumed thread whose earlier turns ran in another process", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, resumeCursor: "codex-thread-old" }));
    await Effect.runPromise(driver.rollbackThread("thread-1", 2));
    expect(transport.sessions[0]!.server.requestsTo("thread/rollback")[0]!.params).toEqual({
      threadId: "codex-thread-old",
      numTurns: 2,
    });
  });

  it("lists models without an allowlist", async () => {
    const transport = new FakeCodexTransport({ models: [{ id: "gpt-a" }, { model: "gpt-b" }] });
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await expect(driver.listModels("thread-1")).resolves.toEqual([{ id: "gpt-a" }, { id: "gpt-b" }]);
  });

  it("reads the paginated data envelope with display names and efforts", async () => {
    const transport = new FakeCodexTransport({ models: [{ id: "gpt-5.6-terra" }], modelsEnvelope: "data" });
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await expect(driver.listModels("thread-1")).resolves.toEqual([
      {
        id: "gpt-5.6-terra",
        name: "GPT-5.6-Terra",
        reasoningEfforts: ["low", "medium"],
      },
    ]);
  });

  it("rewrites limit errors with reset times", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 5400;
    const transport = new FakeCodexTransport({
      rateLimits: { primary: { usedPercent: 100, resetsAt, windowDurationMins: 300 } },
    });
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const done = driver.awaitTurn("thread-1", sent.turnId);
    transport.sessions[0]!.server.notify("turn/completed", {
      threadId: "codex-thread-1",
      turn: { id: "srv-9", status: "failed", error: "usage limit exceeded" },
    });
    const outcome = await done;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("resets in");
  });

  it("consumes reset credits and stops sessions", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await driver.consumeResetCredit("thread-1");
    const server = transport.sessions[0]!.server;
    expect(server.requestsTo("account/rateLimitResetCredit/consume")).toHaveLength(1);
    // Initial probe + post-consume re-probe.
    expect(server.requestsTo("account/rateLimits/read")).toHaveLength(2);
    await Effect.runPromise(driver.stopSession("thread-1"));
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(false);
    await sleep(10);
  });
});

describe("codex context usage", () => {
  it("reads the last request against the model's window", () => {
    expect(
      codexContextUsageOf({
        total: { inputTokens: 900_000, cachedInputTokens: 800_000, outputTokens: 20_000, totalTokens: 920_000 },
        last: { inputTokens: 61_000, cachedInputTokens: 58_000, outputTokens: 1_200, totalTokens: 62_200 },
        modelContextWindow: 272_000,
      }),
    ).toEqual({
      usedTokens: 62_200,
      maxTokens: 272_000,
      cachedInputTokens: 58_000,
      autoCompactThreshold: null,
      compactsAutomatically: null,
    });
    expect(codexContextUsageOf({ total: { totalTokens: 5 } })).toBeNull();
  });
});

describe("codex steering", () => {
  it("sends turn/steer pinned to the running server turn", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const server = transport.sessions[0]!.server;
    // Before the app-server names the turn there is nothing to pin to.
    expect(await codeOf(() => Effect.runPromise(driver.steerTurn("thread-1", "too soon")))).toBe("TURN_NOT_RUNNING");

    server.notify("turn/started", { threadId: "codex-thread-1", turn: { id: "srv-1" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await Effect.runPromise(driver.steerTurn("thread-1", "also add tests"));
    expect(server.requestsTo("turn/steer")[0]!.params).toEqual({
      threadId: "codex-thread-1",
      expectedTurnId: "srv-1",
      input: [{ type: "text", text: "also add tests" }],
    });
  });
});

describe("codex images", () => {
  it("sends images as image inputs carrying a data URL", async () => {
    const transport = new FakeCodexTransport();
    const driver = new CodexDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "look", images: [{ name: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=" }] }),
    );
    expect(transport.sessions[0]!.server.requestsTo("turn/start")[0]!.params).toMatchObject({
      input: [{ type: "text", text: "look" }, { type: "image", url: "data:image/png;base64,iVBORw0KGgo=" }],
    });
  });
});
const MCP = [
  { name: "docs", type: "http" as const, url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } },
  { name: "fs", type: "stdio" as const, command: "npx", args: ["-y", "fs-mcp"], env: { ROOT: "/" } },
];

describe("codex MCP injection", () => {
  it("adds each server as its own mcp_servers.<name> override, on start and on resume", async () => {
    const expected = {
      "mcp_servers.docs": { url: "https://docs.example/mcp", http_headers: { Authorization: "Bearer t" } },
      "mcp_servers.fs": { command: "npx", args: ["-y", "fs-mcp"], env: { ROOT: "/" } },
    };
    const fresh = new FakeCodexTransport();
    await Effect.runPromise(new CodexDriver({ transport: fresh }).startSession({ ...START, mcpServers: MCP }));
    expect(fresh.sessions[0]!.server.requestsTo("thread/start")[0]!.params).toMatchObject({ config: expected });

    const resumed = new FakeCodexTransport();
    await Effect.runPromise(
      new CodexDriver({ transport: resumed }).startSession({ ...START, resumeCursor: "codex-thread-old", mcpServers: MCP }),
    );
    expect(resumed.sessions[0]!.server.requestsTo("thread/resume")[0]!.params).toMatchObject({ config: expected });
  });

  it("sends no config override when there are none", async () => {
    const transport = new FakeCodexTransport();
    await Effect.runPromise(new CodexDriver({ transport }).startSession(START));
    expect(transport.sessions[0]!.server.requestsTo("thread/start")[0]!.params).not.toHaveProperty("config");
  });
});
