import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import type { ProviderRuntimeEvent } from "../../spi.js";
import { ClaudeDriver } from "../driver.js";
import { FakeTransport, initMessage, successResult } from "./fakes.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recordEvents(driver: ClaudeDriver): ProviderRuntimeEvent[] {
  const events: ProviderRuntimeEvent[] = [];
  Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
  return events;
}

function streamEvent(event: Record<string, unknown>): SDKMessage {
  return { type: "stream_event", event, parent_tool_use_id: null, uuid: `se-${Math.random()}`, session_id: "session-1" } as unknown as SDKMessage;
}

const messageStart = (id: string) => streamEvent({ type: "message_start", message: { id } });
const blockStart = (index: number, type: string) => streamEvent({ type: "content_block_start", index, content_block: { type } });
const textDelta = (index: number, text: string) => streamEvent({ type: "content_block_delta", index, delta: { type: "text_delta", text } });
const thinkingDelta = (index: number, thinking: string) =>
  streamEvent({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } });
const blockStop = (index: number) => streamEvent({ type: "content_block_stop", index });

function completeBlock(messageId: string, block: Record<string, unknown>, uuid: string): SDKMessage {
  return {
    type: "assistant",
    message: { id: messageId, content: [block], usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
    uuid,
    session_id: "session-1",
  } as unknown as SDKMessage;
}

function textParts(events: ProviderRuntimeEvent[]): string[] {
  return events.flatMap((event) => (event.type === "message.part.updated" ? [event.text] : []));
}

const START = { threadId: "thread-1", workingDirectory: "/repo" };

async function started(): Promise<{ driver: ClaudeDriver; transport: FakeTransport; events: ProviderRuntimeEvent[] }> {
  const transport = new FakeTransport([[initMessage()]]);
  const driver = new ClaudeDriver({ transport });
  const events = recordEvents(driver);
  await Effect.runPromise(driver.startSession(START));
  await sleep(20);
  return { driver, transport, events };
}

describe("claude streaming output", () => {
  it("asks for token-level events, summarized thinking, prompt suggestions and markdown previews", async () => {
    const { transport } = await started();
    expect(transport.created[0]!.options.includePartialMessages).toBe(true);
    expect(transport.created[0]!.options.extraArgs).toEqual({ "thinking-display": "summarized" });
    expect(transport.created[0]!.options.promptSuggestions).toBe(true);
    expect(transport.created[0]!.options.toolConfig).toEqual({ askUserQuestion: { previewFormat: "markdown" } });
  });

  it("sends a steer at `next` priority, so it lands at the running turn's next step", async () => {
    const { driver, transport } = await started();
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    await Effect.runPromise(driver.steerTurn("thread-1", "also check the tests"));
    await sleep(20);
    expect(query.messages.map((message) => message.priority)).toEqual([undefined, "next"]);
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", sent.turnId);
  });

  it("passes on the predicted next prompt that follows a turn", async () => {
    const { driver, transport, events } = await started();
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    query.push(successResult("Done."));
    await driver.awaitTurn("thread-1", sent.turnId);
    query.push({ type: "prompt_suggestion", suggestion: "  run the tests  ", uuid: "ps-1", session_id: "session-1" } as unknown as SDKMessage);
    query.push({ type: "prompt_suggestion", suggestion: "   ", uuid: "ps-2", session_id: "session-1" } as unknown as SDKMessage);
    await sleep(20);
    expect(events.filter((event) => event.type === "prompt.suggested")).toEqual([
      { type: "prompt.suggested", provider: "claude", threadId: "thread-1", suggestion: "run the tests" },
    ]);
  });

  it("streams text deltas as they arrive, and the complete block adds nothing twice", async () => {
    const { driver, transport, events } = await started();
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    query.push(messageStart("msg-1"));
    query.push(blockStart(0, "text"));
    query.push(textDelta(0, "Hel"));
    query.push(textDelta(0, "lo there"));
    query.push(completeBlock("msg-1", { type: "text", text: "Hello there" }, "a-1"));
    query.push(blockStop(0));
    query.push(successResult("Hello there"));
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome.text).toBe("Hello there");
    expect(textParts(events)).toEqual(["Hel", "lo there"]);
    expect(events.filter((event) => event.type === "message.part.updated").every((event) => (event as { messageId?: string }).messageId === "msg-1")).toBe(true);
  });

  it("fills in from the complete block what the deltas missed", async () => {
    const { driver, transport, events } = await started();
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    query.push(messageStart("msg-2"));
    query.push(blockStart(0, "text"));
    query.push(textDelta(0, "Partial"));
    query.push(completeBlock("msg-2", { type: "text", text: "Partial answer." }, "a-2"));
    // A second text block in the same message, never streamed at all.
    query.push(completeBlock("msg-2", { type: "text", text: " More." }, "a-3"));
    query.push(successResult("Partial answer. More."));
    await driver.awaitTurn("thread-1", sent.turnId);
    expect(textParts(events).join("")).toBe("Partial answer. More.");
  });

  it("reports a thinking block as it opens and, with its summary and duration, as it closes", async () => {
    const { driver, transport, events } = await started();
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "think" }));
    query.push(messageStart("msg-3"));
    query.push(blockStart(0, "thinking"));
    query.push(thinkingDelta(0, "Weighing the "));
    query.push(thinkingDelta(0, "two options."));
    query.push(completeBlock("msg-3", { type: "thinking", thinking: "Weighing the two options.", signature: "sig" }, "a-4"));
    await sleep(15);
    query.push(blockStop(0));
    query.push(successResult("Option B."));
    await driver.awaitTurn("thread-1", sent.turnId);
    const reasoning = events.filter((event) => event.type === "reasoning.updated") as Array<Extract<ProviderRuntimeEvent, { type: "reasoning.updated" }>>;
    expect(reasoning.map((event) => event.status)).toEqual(["running", "completed"]);
    expect(reasoning[0]).toMatchObject({ reasoningId: "msg-3:0", text: "", turnId: sent.turnId });
    expect(reasoning[1]).toMatchObject({ reasoningId: "msg-3:0", text: "Weighing the two options." });
    expect(reasoning[1]!.durationMs).toBeGreaterThanOrEqual(10);
    // In between, the summary streams live under the same id.
    const deltas = events.filter((event) => event.type === "reasoning.delta") as Array<Extract<ProviderRuntimeEvent, { type: "reasoning.delta" }>>;
    expect(deltas.map((event) => [event.reasoningId, event.text, event.turnId])).toEqual([
      ["msg-3:0", "Weighing the ", sent.turnId],
      ["msg-3:0", "two options.", sent.turnId],
    ]);
  });

  it("still reports thinking that arrives only as a complete block", async () => {
    const { driver, transport, events } = await started();
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "think" }));
    query.push(completeBlock("msg-4", { type: "thinking", thinking: "Quick check." }, "a-5"));
    query.push(successResult("Done."));
    await driver.awaitTurn("thread-1", sent.turnId);
    expect(events.filter((event) => event.type === "reasoning.updated")).toEqual([
      expect.objectContaining({ reasoningId: "msg-4:0", status: "completed", text: "Quick check.", durationMs: null }),
    ]);
  });
});
