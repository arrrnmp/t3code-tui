import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import type { ProviderRuntimeEvent } from "../../spi.js";
import { ClaudeDriver } from "../driver.js";
import { FakeSessionApi, FakeTransport, historyUser, initMessage, refusalFallback, successResult } from "./fakes.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Every event the driver publishes, as it publishes it. */
function recordEvents(driver: ClaudeDriver): ProviderRuntimeEvent[] {
  const events: ProviderRuntimeEvent[] = [];
  Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
  return events;
}

function refusedText(uuid: string, messageId: string, text: string): SDKMessage {
  return {
    type: "assistant",
    message: { id: messageId, content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
    uuid,
    session_id: "session-1",
  } as unknown as SDKMessage;
}

const START = { threadId: "thread-1", workingDirectory: "/repo", modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5-1" } };

describe("claude session hooks", () => {
  type Hooks = NonNullable<import("../transport.js").ClaudeQueryOptions["hooks"]>;
  async function fire(hooks: Hooks, event: keyof Hooks, input: Record<string, unknown>): Promise<unknown> {
    const callback = hooks[event]![0]!.hooks[0]!;
    return await callback(input as never, undefined, { signal: new AbortController().signal });
  }

  it("reports compaction, automatic model switches, auto-mode refusals and native subagents", async () => {
    const transport = new FakeTransport([[initMessage({ model: "claude-fable-5-1" })]]);
    const driver = new ClaudeDriver({ transport });
    const events = recordEvents(driver);
    await Effect.runPromise(driver.startSession(START));
    await sleep(20);
    const hooks = transport.created[0]!.options.hooks!;
    expect(await fire(hooks, "PostCompact", { trigger: "auto", compact_summary: "Kept: the plan." })).toEqual({});
    await fire(hooks, "PostModelSwitch", { source: "sdk", from_model: "claude-fable-5-1", to_model: "claude-opus-5-5" });
    await fire(hooks, "PostModelSwitch", { source: "auto", from_model: "claude-fable-5-1", to_model: "claude-opus-5" });
    await fire(hooks, "PermissionDenied", { tool_name: "Bash", reason: "Deletes files outside the project." });
    await fire(hooks, "SubagentStart", { agent_id: "ag-1", agent_type: "Explore" });
    await fire(hooks, "SubagentStop", { agent_id: "ag-1", agent_type: "Explore", last_assistant_message: "Found 3 callers." });
    await sleep(10);

    expect(events.filter((event) => event.type === "session.notice")).toEqual([
      expect.objectContaining({ notice: "compacted", title: "Conversation compacted automatically", detail: "Kept: the plan." }),
      expect.objectContaining({ notice: "permission-denied", title: "Auto mode denied Bash", detail: "Deletes files outside the project." }),
    ]);
    // Only the switch the CLI made on its own is news.
    expect(events.filter((event) => event.type === "model.changed")).toEqual([
      expect.objectContaining({ from: "claude-fable-5-1", to: "claude-opus-5", toLabel: "Claude Opus 5", reason: "auto", category: null }),
    ]);
    expect(events.filter((event) => event.type === "subagent.updated")).toEqual([
      expect.objectContaining({ agentId: "ag-1", agentType: "Explore", status: "started", lastMessage: null }),
      expect.objectContaining({ agentId: "ag-1", agentType: "Explore", status: "stopped", lastMessage: "Found 3 callers." }),
    ]);
  });

  it("explains a run that died on an API error with the hook's reason", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await sleep(20);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    await fire(transport.created[0]!.options.hooks!, "StopFailure", { error: "overloaded", error_details: "529 from the API" });
    transport.created[0]!.push({ type: "result", subtype: "error_during_execution", is_error: true, uuid: "r", session_id: "session-1" } as unknown as SDKMessage);
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("Claude is overloaded: 529 from the API");
  });
});

describe("claude refusal fallback", () => {
  it("retracts the refused output and moves the session to the fallback model", async () => {
    const transport = new FakeTransport([[initMessage({ model: "claude-fable-5-1" })]]);
    const driver = new ClaudeDriver({ transport });
    const events = recordEvents(driver);
    await Effect.runPromise(driver.startSession(START));
    await sleep(20);
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "explain", modelSelection: START.modelSelection }));
    query.push(refusedText("sdk-refused", "msg-refused", "Partial answer…"));
    query.push(refusalFallback({ retracted_message_uuids: ["sdk-refused", "never-seen"] }));
    query.push(successResult("The real answer."));
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome.text).toBe("The real answer.");

    expect(events.find((event) => event.type === "message.retracted")).toMatchObject({
      turnId: sent.turnId,
      messageIds: ["msg-refused"],
      toolUseIds: [],
    });
    expect(events.find((event) => event.type === "model.changed")).toMatchObject({
      turnId: sent.turnId,
      from: "claude-fable-5-1",
      to: "claude-opus-5",
      fromLabel: "Claude Fable 5.1",
      toLabel: "Claude Opus 5",
      reason: "refusal-fallback",
      scope: "session",
      category: "bio",
    });

    // The next turn, still selecting the thread's model (now the fallback), asks for no switch back.
    const next = await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "more", modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" } }),
    );
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", next.turnId);
    expect(query.models).toEqual([]);
  });

  it("leaves the session model alone when only a subagent's reply fell back", async () => {
    const transport = new FakeTransport([[initMessage({ model: "claude-fable-5-1" })]]);
    const driver = new ClaudeDriver({ transport });
    const events = recordEvents(driver);
    await Effect.runPromise(driver.startSession(START));
    await sleep(20);
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go", modelSelection: START.modelSelection }));
    query.push(refusalFallback({ scope: "local" }));
    query.push(successResult("done"));
    await driver.awaitTurn("thread-1", sent.turnId);
    expect(events.find((event) => event.type === "model.changed")).toMatchObject({ scope: "local" });
    // A later turn on the original model needs no setModel: the session never left it.
    const next = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "again", modelSelection: START.modelSelection }));
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", next.turnId);
    expect(query.models).toEqual([]);
  });

  it("asks the refusal-fallback dialog through the answer panel and answers with the CLI's result ids", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const events = recordEvents(driver);
    await Effect.runPromise(driver.startSession(START));
    await sleep(20);
    expect(transport.created[0]!.options.supportedDialogKinds).toEqual(["refusal_fallback_prompt"]);

    const answer = driver.handleUserDialog(
      {
        dialogKind: "refusal_fallback_prompt",
        payload: { originalModel: "claude-fable-5-1", fallbackModel: "claude-opus-5", apiRefusalCategory: "cyber" },
      },
      { signal: new AbortController().signal, requestId: "dialog-1" },
    );
    await sleep(10);
    const opened = events.find((event) => event.type === "user-input.request.opened") as
      | { requestId: string; raw: { input: { questions: Array<{ question: string; options: Array<{ label: string }> }> } } }
      | undefined;
    expect(opened).toBeDefined();
    const question = opened!.raw.input.questions[0]!;
    expect(question.question).toBe("Claude Fable 5.1 flagged this request (cybersecurity). Re-run it on Claude Opus 5?");
    expect(question.options.map((option) => option.label)).toEqual(["Retry on Claude Opus 5", "Edit prompt"]);

    await Effect.runPromise(driver.respondToUserInput("thread-1", opened!.requestId, { [question.question]: "Retry on Claude Opus 5" }));
    expect(await answer).toEqual({ behavior: "completed", result: "retry_fallback" });
  });

  it("cancels dialogs it does not know, and a dismissed refusal dialog", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const events = recordEvents(driver);
    await Effect.runPromise(driver.startSession(START));
    await sleep(20);
    const signal = new AbortController().signal;
    expect(await driver.handleUserDialog({ dialogKind: "something_new", payload: {} }, { signal, requestId: "d" })).toEqual({ behavior: "cancelled" });

    const answer = driver.handleUserDialog(
      { dialogKind: "refusal_fallback_prompt", payload: { originalModel: "claude-fable-5-1", fallbackModel: "claude-opus-5" } },
      { signal, requestId: "d2" },
    );
    await sleep(10);
    const opened = events.find((event) => event.type === "user-input.request.opened") as { requestId: string };
    await Effect.runPromise(driver.respondToRequest("thread-1", opened.requestId, { kind: "decline" }));
    expect(await answer).toEqual({ behavior: "cancelled" });
  });

  it("rebuilds a rolled-back session with its MCP servers, instructions and effort", async () => {
    const history = [historyUser("u-1", "first"), historyUser("u-2", "second")];
    const transport = new FakeTransport([[initMessage()], [initMessage()]]);
    const driver = new ClaudeDriver({ transport, sessionApi: new FakeSessionApi(history) });
    await Effect.runPromise(
      driver.startSession({
        ...START,
        modelSelection: { ...START.modelSelection, options: [{ id: "effort", value: "low" }] },
        instructions: "Report back.",
        mcpServers: [{ name: "moxen", type: "stdio", command: "bun", args: ["mcp.ts"], env: {} }],
      }),
    );
    await sleep(20);
    const query = transport.created[0]!;
    for (const prompt of ["first", "second"]) {
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt }));
      query.push(successResult("ok"));
      await driver.awaitTurn("thread-1", sent.turnId);
    }
    await Effect.runPromise(driver.rollbackThread("thread-1", 1));
    const rebuilt = transport.created[1]!.options;
    expect(rebuilt.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "Report back." });
    expect(Object.keys(rebuilt.mcpServers ?? {})).toEqual(["moxen"]);
    expect(rebuilt.effort).toBe("low");
  });
});
