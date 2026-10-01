import { describe, expect, it } from "vitest";

import { answerForForm, OpencodeEventTranslator, toolContentText, translateTimeline, type OpencodeSubscribedEvent } from "../translate.js";
import {
  EXECUTION_FAILED_EVENTS,
  PERMISSION_EVENTS,
  QUESTION_EVENTS,
  SHELL_TURN_EVENTS,
  STEER_AND_CANCEL_EVENTS,
  TIMELINE_ITEMS,
  TOOL_FAILED_EVENTS,
} from "./v2samples.js";

const SESSION = "ses_f0ddba907ffeHoSABAb2zhuSrx";

function run(translator: OpencodeEventTranslator, events: ReadonlyArray<Record<string, unknown>>): OpencodeSubscribedEvent[] {
  return events.flatMap((event) => translator.translate(event));
}

function parts(events: ReadonlyArray<OpencodeSubscribedEvent>, kind: string): Array<Record<string, any>> {
  return events.flatMap((event) => {
    const part = event.properties.part as Record<string, any> | undefined;
    return event.type === "message.part.updated" && part?.type === kind ? [part] : [];
  });
}

describe("v2 event translation, against a real shell turn", () => {
  const events = run(new OpencodeEventTranslator(), SHELL_TURN_EVENTS);

  it("accumulates text deltas into cumulative parts and reconciles with the ended text", () => {
    const texts = parts(events, "text");
    expect(texts.map((part) => part.text)).toEqual([
      "The shell command executed successfully",
      "The shell command executed successfully and printed `probe-ok`.",
    ]);
    // One part id per (message, ordinal), and the message id is the assistant step's.
    expect(new Set(texts.map((part) => part.id)).size).toBe(1);
    expect(texts[0]!.messageID).toBe("msg_0f224d72f001fI8DzJWxhAWqYl");
  });

  it("walks a tool through pending, running and completed with the command and its output", () => {
    const tools = parts(events, "tool");
    expect(tools.map((part) => part.state.status)).toEqual(["pending", "running", "running", "completed"]);
    const done = tools.at(-1)!;
    expect(done).toMatchObject({
      id: "call_b89aee2d3ba0488fa39560cd",
      callID: "call_b89aee2d3ba0488fa39560cd",
      messageID: "msg_0f22468710012E153TICA4JL4d",
      tool: "shell",
      state: {
        status: "completed",
        input: { command: "echo probe-ok" },
        output: "probe-ok\n",
        metadata: { exit: 0, shellID: "sh_0f224d722002EKmQANgk9fOCcR" },
      },
    });
    expect(done.state.time.start).toBeLessThan(done.state.time.end);
    expect(tools[0]!.state.input).toEqual({});
  });

  it("maps a permission ask to the internal field names", () => {
    const asked = events.find((event) => event.type === "permission.asked");
    expect(asked?.properties).toMatchObject({
      id: "per_0f2247778001tngDfYafZ62Aag",
      sessionID: SESSION,
      permission: "shell",
      patterns: ["echo probe-ok"],
    });
  });

  it("ends the turn with one idle, and drops reasoning, steps, usage and inbox events", () => {
    expect(events.filter((event) => event.type === "session.idle")).toEqual([
      { type: "session.idle", properties: { sessionID: SESSION } },
    ]);
    expect(events.at(-1)?.type).toBe("session.idle");
    const kinds = new Set(events.map((event) => event.type));
    expect([...kinds].sort()).toEqual(["message.part.updated", "permission.asked", "permission.replied", "session.idle"]);
    expect(parts(events, "reasoning")).toEqual([]);
  });

  it("passes a permission reply through with its session and request", () => {
    const replied = run(new OpencodeEventTranslator(), PERMISSION_EVENTS).find((event) => event.type === "permission.replied");
    expect(replied?.properties).toMatchObject({ sessionID: SESSION, requestID: "per_0f2247778001tngDfYafZ62Aag", reply: "once" });
  });
});

describe("v2 question forms", () => {
  it("turns a question form into question.asked and its reply into question.replied", () => {
    const translator = new OpencodeEventTranslator();
    const events = run(translator, QUESTION_EVENTS);
    const asked = events.find((event) => event.type === "question.asked")!;
    expect(asked.properties).toEqual({
      id: "frm_0f225d0f8001PFnM3IuuA7iufm",
      // The session is on the form, not the event's data.
      sessionID: SESSION,
      questions: [
        {
          header: "Color",
          question: "Which color do you prefer?",
          options: [
            { label: "Red", description: "The color red", value: "Red" },
            { label: "Blue", description: "The color blue", value: "Blue" },
          ],
          multiple: false,
          multiSelect: false,
          custom: true,
          allowCustomAnswer: true,
        },
      ],
    });
    expect(events.find((event) => event.type === "question.replied")?.properties).toEqual({
      sessionID: SESSION,
      requestID: "frm_0f225d0f8001PFnM3IuuA7iufm",
    });
    // Settled forms are forgotten; open ones remember the keys their reply needs.
    expect(translator.formFields("frm_0f225d0f8001PFnM3IuuA7iufm")).toBeNull();
    const open = new OpencodeEventTranslator();
    open.translate(QUESTION_EVENTS[0]);
    expect(open.formFields("frm_0f225d0f8001PFnM3IuuA7iufm")).toEqual([{ key: "q0", type: "string" }]);
  });

  it("reads multiselect fields as multiple choice and ignores forms that are not questions", () => {
    const translator = new OpencodeEventTranslator();
    const created = (kind: string, form: Record<string, unknown>) =>
      translator.translate({
        type: "form.created",
        data: { form: { id: "frm_x", sessionID: SESSION, title: "T", metadata: { kind }, ...form } },
      });
    const [asked] = created("question", {
      fields: [{ key: "q0", title: "Pick", type: "multiselect", options: [{ value: "a", label: "A" }] }],
    });
    expect((asked?.properties.questions as Array<Record<string, unknown>>)[0]).toMatchObject({
      header: "Pick",
      multiple: true,
      multiSelect: true,
      custom: false,
    });
    expect(created("auth", { fields: [{ key: "k", type: "string" }] })).toEqual([]);
  });

  it("keys a reply by field key: arrays for multiselect, strings otherwise, skipping unanswered", () => {
    const fields = [
      { key: "q0", type: "string" },
      { key: "q1", type: "multiselect" },
      { key: "q2", type: "string" },
      { key: "q3", type: "integer" },
    ];
    expect(answerForForm(fields, [["Red"], ["a", "b"], [], ["3"]])).toEqual({ q0: "Red", q1: ["a", "b"], q3: 3 });
    expect(answerForForm([], [["x"]])).toEqual({ q0: "x" });
  });

  it("settles a dismissed question as question.rejected", () => {
    const events = run(new OpencodeEventTranslator(), STEER_AND_CANCEL_EVENTS);
    expect(events.filter((event) => event.type.startsWith("question."))).toMatchObject([
      { type: "question.asked" },
      { type: "question.rejected" },
    ]);
  });
});

describe("v2 turn end", () => {
  it("does not end a turn that spans a cancelled form and a steer until the steer's run is over", () => {
    const events = run(new OpencodeEventTranslator(), STEER_AND_CANCEL_EVENTS);
    const types = events.map((event) => event.type);
    // The first execution is interrupted (form cancel) with the steer still queued: no idle there.
    expect(types.filter((type) => type === "session.idle")).toHaveLength(1);
    expect(types.indexOf("session.idle")).toBe(types.length - 1);
  });

  it("reports every interrupt with its reason, flagging a user item still queued", () => {
    const translator = new OpencodeEventTranslator();
    const enqueue = (inboxID: string, type = "user") =>
      translator.translate({ type: "session.inbox.enqueued", data: { sessionID: SESSION, inboxID, item: { type, payload: {} } } });
    const end = () => translator.translate({ type: "session.execution.interrupted", data: { sessionID: SESSION, reason: "user" } });
    const interrupted = (pendingInbox: boolean, reason = "user") => [
      { type: "session.interrupted", properties: { sessionID: SESSION, reason, pendingInbox } },
    ];
    expect(end()).toEqual(interrupted(false));
    // Never held back: an interrupt acknowledgement must not depend on the inbox.
    enqueue("msg_1");
    expect(end()).toEqual(interrupted(true));
    translator.translate({ type: "session.inbox.delivered", data: { sessionID: SESSION, inboxID: "msg_1" } });
    expect(end()).toEqual(interrupted(false));
    // Synthetic reminders (plan-mode switches) never count as queued input.
    enqueue("msg_2", "synthetic");
    expect(end()).toEqual(interrupted(false));
    // Cancelling the queued item (the driver's interrupt does) clears it.
    enqueue("msg_3");
    translator.translate({ type: "session.inbox.cancelled", data: { sessionID: SESSION, inboxID: "msg_3" } });
    expect(end()).toEqual(interrupted(false));
    // The reason is carried as the server sent it.
    expect(
      translator.translate({ type: "session.execution.interrupted", data: { sessionID: SESSION, reason: "inactivity" } }),
    ).toEqual(interrupted(false, "inactivity"));
    // A run that ends normally still holds its idle while a user item waits.
    enqueue("msg_4");
    expect(translator.translate({ type: "session.execution.succeeded", data: { sessionID: SESSION } })).toEqual([]);
  });

  it("maps a failed execution to session.error carrying the error type as its name", () => {
    const events = run(new OpencodeEventTranslator(), EXECUTION_FAILED_EVENTS);
    expect(events).toEqual([
      {
        type: "session.error",
        properties: {
          sessionID: SESSION,
          error: { message: "Model unavailable: opencode/nope", name: "provider.no-route" },
        },
      },
    ]);
  });

  it("maps a server-wide shutdown to a session.error without a session", () => {
    const [event] = new OpencodeEventTranslator().translate({ type: "location.shutdown", data: {} });
    expect(event?.type).toBe("session.error");
    expect(event?.properties.sessionID).toBeUndefined();
    expect(event?.properties.error).toMatchObject({ name: "location.shutdown" });
  });

  it("ignores noise events and malformed input", () => {
    const translator = new OpencodeEventTranslator();
    for (const type of ["server.connected", "project.updated", "skill.updated", "session.usage.updated", "session.step.started"]) {
      expect(translator.translate({ type, data: { sessionID: SESSION } })).toEqual([]);
    }
    expect(translator.translate(null)).toEqual([]);
    expect(translator.translate({ data: {} })).toEqual([]);
  });
});

describe("v2 tool failures", () => {
  it("reports a failed tool as an error state with the message", () => {
    const [part] = parts(run(new OpencodeEventTranslator(), TOOL_FAILED_EVENTS), "tool");
    expect(part).toMatchObject({
      callID: "call_fb6ddc6b1d774052a7383943",
      state: { status: "error", error: "Unable to execute command: echo second" },
    });
  });

  it("joins the text items of tool content", () => {
    expect(toolContentText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("ab");
    expect(toolContentText(undefined)).toBe("");
  });
});

describe("v2 history translation", () => {
  const messages = translateTimeline(TIMELINE_ITEMS);

  it("maps user and assistant items and drops idle markers", () => {
    expect(messages.map((message) => [message.info.role, message.info.id])).toEqual([
      ["user", "msg_6f89c3f0317c3TtJp3TRZuOMpO"],
      ["assistant", "msg_0f22468710012E153TICA4JL4d"],
      ["assistant", "msg_0f224d72f001fI8DzJWxhAWqYl"],
    ]);
    expect(messages[0]!.parts).toEqual([
      { id: "msg_6f89c3f0317c3TtJp3TRZuOMpO:text", messageID: "msg_6f89c3f0317c3TtJp3TRZuOMpO", type: "text", text: expect.stringContaining("echo probe-ok") },
    ]);
  });

  it("gives assistant messages their model, tokens and the user message they answer", () => {
    expect(messages[1]!.info).toMatchObject({
      providerID: "opencode",
      modelID: "longcat-2.5-preview-free",
      parentID: "msg_6f89c3f0317c3TtJp3TRZuOMpO",
      tokens: { input: 3028, output: 19, reasoning: 32, cache: { read: 5632, write: 0 } },
      time: { completed: 1790768895785 },
    });
    expect(messages[2]!.info.parentID).toBe("msg_6f89c3f0317c3TtJp3TRZuOMpO");
  });

  it("maps content: reasoning and text parts, tools with their output", () => {
    expect(messages[1]!.parts.map((part) => part.type)).toEqual(["reasoning", "tool"]);
    expect(messages[1]!.parts[1]).toMatchObject({
      callID: "call_b89aee2d3ba0488fa39560cd",
      tool: "shell",
      state: { status: "completed", input: { command: "echo probe-ok" }, output: "probe-ok\n", metadata: { exit: 0 } },
    });
    expect(messages[2]!.parts.map((part) => part.type)).toEqual(["reasoning", "text"]);
    expect(messages[2]!.parts[1]).toMatchObject({ text: "The shell command executed successfully and printed `probe-ok`." });
  });

  it("marks the prompt answered by the idle marker, and completes replies the server left open", () => {
    expect(messages[0]!.info.settled).toBe(true);
    const open = translateTimeline([
      { id: "msg_u", type: "user", time: { created: 1 }, text: "hi" },
      { id: "msg_a", type: "assistant", time: { created: 2 }, model: { id: "m", providerID: "p" }, content: [] },
      { id: "msg_i", type: "idle", time: { created: 9 }, outcome: "interrupted" },
    ]);
    expect(open[1]!.info.time).toEqual({ created: 2, completed: 9 });
  });

  it("leaves a prompt with no idle marker unsettled, and keeps attachments' names but not their bytes", () => {
    const [user] = translateTimeline([
      { id: "msg_u", type: "user", time: { created: 1 }, text: "look", files: [{ data: "AAAA", mime: "image/png", name: "a.png", source: { type: "inline" } }] },
    ]);
    expect(user!.info.settled).toBeUndefined();
    expect(user!.parts[1]).toEqual({ id: "msg_u:file:0", messageID: "msg_u", type: "file", mime: "image/png", filename: "a.png" });
    expect(JSON.stringify(user)).not.toContain("AAAA");
  });

  it("drops items that are not conversation", () => {
    expect(
      translateTimeline([
        { id: "a", type: "synthetic", time: {} },
        { id: "b", type: "compaction", time: {} },
        { id: "c", type: "model-switched", time: {} },
        { id: "d", type: "shell", time: {} },
      ]),
    ).toEqual([]);
  });
});
