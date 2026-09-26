import { describe, expect, it } from "vitest";

import { ClaudeDriver } from "../driver.js";
import { assistantText, errorResult, FakeTransport, successResult } from "./fakes.js";

/**
 * `/btw` on Claude: a one-shot answer on a copy of the thread's session.
 * The options are the whole contract — a missing `forkSession` would write
 * the side question into the real session, and a missing `tools: []`
 * would let it act on the repository.
 */
describe("Claude side questions", () => {
  it("asks on a tool-less, unpersisted copy of the session and returns its text", async () => {
    const transport = new FakeTransport([[assistantText("It is using JWTs in auth.ts."), successResult("It is using JWTs in auth.ts.")]]);
    const driver = new ClaudeDriver({ transport });
    const answer = await driver.sideQuestion({
      cursor: "session-abc",
      workingDirectory: "/work",
      question: "Which auth scheme did we settle on?",
      model: "claude-opus-5",
    });
    expect(answer).toEqual({ text: "It is using JWTs in auth.ts.", withContext: true });

    const query = transport.created[0]!;
    expect(query.options).toMatchObject({
      cwd: "/work",
      resume: "session-abc",
      forkSession: true,
      persistSession: false,
      tools: [],
      maxTurns: 1,
      model: "claude-opus-5",
    });
    // Told it has no tools, so it answers rather than writing fake tool calls.
    expect(query.options.systemPrompt?.append).toMatch(/no tools/i);
    expect(query.prompts).toEqual(["Which auth scheme did we settle on?"]);
    expect(query.closed).toBe(true);
  });

  it("answers without a copy when the thread has no session yet, and says so", async () => {
    const transport = new FakeTransport([[successResult("No context yet.")]]);
    const driver = new ClaudeDriver({ transport });
    const answer = await driver.sideQuestion({ cursor: null, workingDirectory: "/work", question: "hi" });
    expect(answer).toEqual({ text: "No context yet.", withContext: false });
    expect(transport.created[0]!.options.resume).toBeUndefined();
    expect(transport.created[0]!.options.forkSession).toBeUndefined();
  });

  it("fails plainly when the side run errors or comes back empty", async () => {
    const failing = new ClaudeDriver({ transport: new FakeTransport([[errorResult("error_max_turns")]]) });
    await expect(failing.sideQuestion({ cursor: "s", workingDirectory: "/w", question: "q" })).rejects.toThrow(
      "did not get an answer (error_max_turns)",
    );
    const empty = new ClaudeDriver({ transport: new FakeTransport([[successResult("")]]) });
    await expect(empty.sideQuestion({ cursor: "s", workingDirectory: "/w", question: "q" })).rejects.toThrow("came back empty");
  });
});
