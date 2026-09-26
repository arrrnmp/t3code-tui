import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { ModelSelection } from "../../../types.js";
import { ClaudeDriver } from "../driver.js";
import { claudeEffortChoice, effectiveEffortChoice, effortFlagSettings, promptForEffort } from "../effort.js";
import { FakeTransport, initMessage, successResult } from "./fakes.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function selection(effort: string | null, model = "claude-fable-5-1"): ModelSelection {
  return { instanceId: "claudeAgent", model, ...(effort === null ? {} : { options: [{ id: "effort", value: effort }] }) };
}

const START = { threadId: "thread-1", workingDirectory: "/repo" };

describe("claude effort choices", () => {
  it("reads levels, ultracode and ultrathink off the selection's effort option", () => {
    expect(claudeEffortChoice(selection("high"))).toEqual({ kind: "level", level: "high" });
    expect(claudeEffortChoice(selection("MAX"))).toEqual({ kind: "level", level: "max" });
    expect(claudeEffortChoice(selection("ultracode"))).toEqual({ kind: "ultracode" });
    expect(claudeEffortChoice(selection("ultrathink"))).toEqual({ kind: "ultrathink" });
    expect(claudeEffortChoice(selection(null))).toBeNull();
    expect(claudeEffortChoice(selection("warp-speed"))).toBeNull();
  });

  it("clears ultracode when a plain level replaces it", () => {
    expect(effortFlagSettings({ kind: "level", level: "low" }, "ultracode")).toEqual({ effortLevel: "low", ultracode: null });
    expect(effortFlagSettings({ kind: "level", level: "low" }, "high")).toEqual({ effortLevel: "low" });
    expect(effortFlagSettings({ kind: "ultracode" }, "high")).toEqual({ effortLevel: "xhigh", ultracode: true });
  });

  it("adds the ultrathink keyword to that turn's prompt only", () => {
    expect(promptForEffort("fix it", { kind: "ultrathink" })).toBe("fix it\n\nultrathink");
    expect(promptForEffort("fix it", { kind: "level", level: "high" })).toBe("fix it");
    expect(promptForEffort("fix it", null)).toBe("fix it");
  });
});

describe("claude driver effort", () => {
  it("starts the session at the selected effort", async () => {
    const transport = new FakeTransport([[initMessage()], [initMessage()], [initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, modelSelection: selection("low") }));
    expect(transport.created[0]!.options.effort).toBe("low");
    expect(transport.created[0]!.options.settings).toBeUndefined();

    await Effect.runPromise(driver.startSession({ ...START, threadId: "thread-2", modelSelection: selection("ultracode") }));
    expect(transport.created[1]!.options.effort).toBe("xhigh");
    expect(transport.created[1]!.options.settings).toEqual({ ultracode: true });

    // No choice: the model's default from our catalog, sent explicitly so
    // the picker's label is what runs (Opus 5.5 defaults to medium).
    await Effect.runPromise(driver.startSession({ ...START, threadId: "thread-3", modelSelection: selection(null, "claude-opus-5-5") }));
    expect(transport.created[2]!.options.effort).toBe("medium");
  });

  it("falls back to the catalog default only for models the catalog knows", () => {
    expect(effectiveEffortChoice(selection(null, "claude-opus-5-5"))).toEqual({ kind: "level", level: "medium" });
    expect(effectiveEffortChoice(selection("max", "claude-opus-5-5"))).toEqual({ kind: "level", level: "max" });
    expect(effectiveEffortChoice(selection(null, "claude-unknown-9"))).toBeNull();
  });

  it("applies an effort change mid-session, once, and returns to the model's default when the selection names none", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, modelSelection: selection("medium") }));
    await sleep(20);
    const query = transport.created[0]!;

    const first = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "one", modelSelection: selection("high") }));
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", first.turnId);
    expect(query.flagSettings).toEqual([{ effortLevel: "high" }]);

    const second = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "two", modelSelection: selection("high") }));
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", second.turnId);
    const third = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "three", modelSelection: selection(null) }));
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", third.turnId);
    expect(query.flagSettings).toEqual([{ effortLevel: "high" }, { effortLevel: "medium" }]);
  });

  it("sends ultrathink as a keyword on that turn, without touching the session effort", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession({ ...START, modelSelection: selection("high") }));
    await sleep(20);
    const query = transport.created[0]!;
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "think", modelSelection: selection("ultrathink") }));
    await sleep(20);
    expect(query.prompts.at(-1)).toBe("think\n\nultrathink");
    expect(query.flagSettings).toEqual([]);
    query.push(successResult("ok"));
    await driver.awaitTurn("thread-1", sent.turnId);
    // The transcript keeps what the user wrote.
    const snapshot = await Effect.runPromise(driver.readThread("thread-1"));
    expect(snapshot.turns[0]!.items[0]).toMatchObject({ kind: "user", text: "think" });
  });
});
