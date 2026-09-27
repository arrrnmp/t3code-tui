import { describe, expect, it } from "vitest";

import type { ActivityEnvelope, MessageEnvelope } from "../../../core/types.js";
import { describeActivity } from "../activity.js";
import { USAGE_CONTINUE_PROMPT } from "../../../core/threads/views.js";
import { applyThreadFrame, detectUsageLimit, emptyThreadState, isUsageContinue, promptSuggestion, retractedIds, taskNotifications, timeline, untilLabel, type ThreadState, queuedMessages, queuedSummary } from "../thread.js";

function activity(id: string, kind: string, payload: Record<string, unknown>, turnId = "turn-1"): ActivityEnvelope {
  return { id, tone: "info", kind, summary: kind, turnId, createdAt: `2026-09-25T10:00:0${id.length % 10}.000Z`, payload } as unknown as ActivityEnvelope;
}

function message(id: string, text: string): MessageEnvelope {
  return {
    id,
    role: "assistant",
    text,
    turnId: "turn-1",
    streaming: false,
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
  } as unknown as MessageEnvelope;
}

function state(overrides: Partial<ThreadState>): ThreadState {
  return { ...emptyThreadState(), ...overrides };
}

describe("refusal fallback in the transcript", () => {
  it("hides retracted messages and tool calls, and the tombstone itself", () => {
    const activities = [
      activity("t1", "tool-call.started", { toolCallId: "tu-refused", itemType: "command_execution", title: "ls" }),
      activity("t2", "tool-call.started", { toolCallId: "tu-kept", itemType: "command_execution", title: "pwd" }),
      activity("r1", "message.retracted", { messageIds: ["turn-1:msg-refused"], toolCallIds: ["tu-refused"] }),
      activity("m1", "model.changed", { from: "claude-fable-5-1", to: "claude-opus-5", fromLabel: "Claude Fable 5.1", toLabel: "Claude Opus 5", category: "bio", scope: "session" }),
    ];
    const entries = timeline(
      state({ messages: [message("turn-1:msg-refused", "Partial…"), message("turn-1:msg-kept", "Real answer")], activities }),
    );
    expect(entries.filter((entry) => entry.kind === "assistant").map((entry) => entry.text)).toEqual(["Real answer"]);
    expect(entries.filter((entry) => entry.kind === "activity").map((entry) => entry.id).sort()).toEqual(["m1", "t2"]);
    expect(retractedIds(activities).toolCalls).toEqual(new Set(["tu-refused"]));
  });

  it("describes the switch with display names and the category in words", () => {
    expect(
      describeActivity(activity("m1", "model.changed", { from: "claude-fable-5-1", to: "claude-opus-5", fromLabel: "Claude Fable 5.1", toLabel: "Claude Opus 5", category: "cyber", scope: "session" })),
    ).toEqual({ kind: "model-switch", from: "Claude Fable 5.1", to: "Claude Opus 5", category: "cybersecurity", scope: "session", reason: "refusal-fallback" });
    expect(describeActivity(activity("m3", "model.changed", { to: "claude-opus-5", reason: "auto" }))).toMatchObject({ reason: "auto" });
    // Unnamed models fall back to their ids.
    expect(describeActivity(activity("m2", "model.changed", { to: "claude-opus-5", scope: "local" }))).toMatchObject({
      to: "claude-opus-5",
      from: null,
      category: null,
      scope: "local",
    });
  });
});

describe("reasoning rows", () => {
  it("fold the running and finished rows of one stretch into a single card", () => {
    const running = activity("r-a", "reasoning", {
      itemType: "reasoning",
      toolCallId: "reasoning:msg-1:0",
      status: "inProgress",
      text: "",
      startedAt: "2026-09-25T10:00:00.000Z",
      durationMs: null,
    });
    const finished = activity("r-bb", "reasoning", {
      itemType: "reasoning",
      toolCallId: "reasoning:msg-1:0",
      status: "completed",
      text: "  Weighing the two options.  ",
      startedAt: "2026-09-25T10:00:00.000Z",
      durationMs: 12_400,
    });
    expect(describeActivity(running)).toEqual({ kind: "reasoning", text: "", startedAt: "2026-09-25T10:00:00.000Z", durationMs: null, running: true });
    const entries = timeline(state({ activities: [running, finished] })).filter((entry) => entry.kind === "activity");
    expect(entries).toHaveLength(1);
    expect(describeActivity(entries[0]!.activity!)).toEqual({
      kind: "reasoning",
      text: "Weighing the two options.",
      startedAt: "2026-09-25T10:00:00.000Z",
      durationMs: 12_400,
      running: false,
    });
  });
});

describe("task notifications", () => {
  it("reads the settled tasks off a moxen-written message, and nothing off a user's own", () => {
    const written = {
      ...message("n1", "<task-notification>…</task-notification>"),
      role: "user",
      origin: "task-notification",
      notification: {
        tasks: [
          { taskId: "t1", title: "scout routes", status: "completed", durationMs: 192_000, model: "codex/gpt-5.5", branch: "moxen/scout", headline: "2 missing auth checks", filesChanged: 0, additions: 0, deletions: 0 },
          { title: "no id" },
        ],
      },
    } as unknown as MessageEnvelope;
    expect(taskNotifications(written)).toEqual([
      { taskId: "t1", source: "moxen", title: "scout routes", status: "completed", durationMs: 192_000, model: "codex/gpt-5.5", branch: "moxen/scout", headline: "2 missing auth checks", filesChanged: 0, additions: 0, deletions: 0 },
    ]);
    expect(taskNotifications(message("m", "hello"))).toBeNull();
    expect(taskNotifications(null)).toBeNull();
  });
});

describe("waiting messages", () => {
  const user = (id: string, text = "later") => ({ ...message(id, text), role: "user" }) as unknown as MessageEnvelope;
  const waiting = () =>
    state({
      messages: [user("m-queued", "first queued"), user("m-held", "held one"), user("m-scheduled", "at noon"), user("m-continue"), user("m-sent")],
      thread: {
        queuedTurns: [
          { turnId: "t-held", messageId: "m-held", scheduledFor: "2026-09-25T15:13:00.000Z", scheduleReason: "usage-hold" },
          { turnId: "t-sched", messageId: "m-scheduled", scheduledFor: "2026-09-25T12:00:00.000Z", scheduleReason: "user" },
          { turnId: "t-queued", messageId: "m-queued", scheduledFor: null, scheduleReason: null },
          { turnId: "t-cont", messageId: "m-continue", scheduledFor: "2026-09-25T15:14:00.000Z", scheduleReason: "usage-reset" },
        ],
      } as unknown as ThreadState["thread"],
    });

  it("keeps messages the agent has not been sent out of the transcript", () => {
    // They are the Queued panel's until sent — the moment the agent sees them.
    const ids = timeline(waiting()).map((entry) => entry.id);
    expect(ids).toEqual(["m-sent"]);
  });

  it("places a sent queued message where its turn started, not where it was queued", () => {
    const at = (second: number) => `2026-09-25T10:00:${String(second).padStart(2, "0")}.000Z`;
    const entries = timeline(
      state({
        messages: [
          { ...user("m-first", "first"), turnId: "turn-1", createdAt: at(0) } as MessageEnvelope,
          { ...message("r-early", "working on it"), createdAt: at(10) } as MessageEnvelope,
          // Queued at 0:20 while turn-1 still ran; sent at 0:40 when it ended.
          { ...user("m-queued", "while you work"), turnId: "turn-2", createdAt: at(20) } as MessageEnvelope,
          { ...message("r-late", "done"), createdAt: at(30) } as MessageEnvelope,
          // The closing reply is stamped as the turn completes — the same
          // instant the queued turn is promoted.
          { ...message("r-close", "all done"), id: "z-close", createdAt: at(40) } as MessageEnvelope,
          { ...message("r-next", "on the queued one"), turnId: "turn-2", createdAt: at(45) } as MessageEnvelope,
        ],
        activities: [
          { ...activity("q", "turn.queued", {}, "turn-2"), createdAt: at(20) },
          { ...activity("p", "turn.promoted", {}, "turn-2"), createdAt: at(40) },
        ],
      }),
    );
    expect(entries.map((entry) => entry.id)).toEqual(["m-first", "r-early", "r-late", "z-close", "m-queued", "r-next"]);
    expect(entries.find((entry) => entry.id === "m-queued")?.at).toBe(at(40));
  });

  it("lists them for the Queued panel in the order they will go out", () => {
    const items = queuedMessages(waiting());
    // Ungated first (a settle sends the oldest), then timed ones by time.
    // The waiting continue belongs to the usage-limit banner.
    expect(items.map((item) => [item.messageId, item.reason])).toEqual([
      ["m-queued", null],
      ["m-scheduled", "user"],
      ["m-held", "usage-hold"],
    ]);
    expect(items[0]).toMatchObject({ turnId: "t-queued", text: "first queued", attachments: 0, scheduledFor: null });
  });
});

describe("prompt suggestions", () => {
  const suggestion = activity("p1", "prompt.suggestion", { suggestion: " run the tests " }, "turn-1");
  const latestTurn = (turnId: string) => ({ latestTurn: { turnId, state: "completed" } }) as unknown as ThreadState["thread"];

  it("offers the latest turn's suggestion while the thread is idle, and never in the transcript", () => {
    const idle = state({ activities: [suggestion], thread: latestTurn("turn-1") });
    expect(promptSuggestion(idle)).toBe("run the tests");
    expect(timeline(idle)).toEqual([]);
  });

  it("drops it once another turn exists or one is running", () => {
    expect(promptSuggestion(state({ activities: [suggestion], thread: latestTurn("turn-2") }))).toBeNull();
    expect(
      promptSuggestion(state({ activities: [suggestion], thread: latestTurn("turn-1"), session: { status: "running" } as ThreadState["session"] })),
    ).toBeNull();
    expect(promptSuggestion(state({ activities: [], thread: latestTurn("turn-1") }))).toBeNull();
  });
});

describe("session notices", () => {
  it("reads compaction and auto-mode refusals, and keeps native subagent rows out of the transcript", () => {
    const compacted = activity("n1", "notice", { notice: "compacted", detail: "Summary of the work so far." });
    (compacted as { summary: string }).summary = "Conversation compacted automatically";
    expect(describeActivity(compacted)).toEqual({
      kind: "notice",
      notice: "compacted",
      title: "Conversation compacted automatically",
      detail: "Summary of the work so far.",
    });
    const subagent = activity("s1", "subagent", { toolCallId: "subagent:a1", agentType: "Explore", status: "stopped" });
    expect(timeline(state({ activities: [compacted, subagent] })).map((entry) => entry.id)).toEqual(["n1"]);
  });
});

describe("usage limits", () => {
  const now = Date.parse("2026-09-25T14:00:00.000Z");
  const hit = activity("u1", "usage.limit", { label: "Session", rateLimitType: "five_hour", resetsAt: "2026-09-25T15:12:00.000Z" });

  it("blocks while the latest turn's limit has not reset", () => {
    expect(detectUsageLimit(state({ activities: [hit] }), now)).toEqual({
      label: "Session",
      rateLimitType: "five_hour",
      resetsAt: new Date("2026-09-25T15:12:00.000Z"),
      wrapUp: false,
    });
    expect(describeActivity(hit)).toEqual({ kind: "usage-limit", label: "Session", resetsAt: "2026-09-25T15:12:00.000Z", wrapUp: false });
  });

  it("reads a graceful wrap-up as the same limit, still in force", () => {
    const wrap = activity("w1", "usage.wrap-up", { label: "Session", rateLimitType: "five_hour", resetsAt: "2026-09-25T15:12:00.000Z" });
    expect(detectUsageLimit(state({ activities: [wrap] }), now)).toMatchObject({ label: "Session", wrapUp: true });
    expect(describeActivity(wrap)).toMatchObject({ kind: "usage-limit", wrapUp: true });
  });

  it("lets go once the window resets, or once a later turn ran", () => {
    expect(detectUsageLimit(state({ activities: [hit] }), Date.parse("2026-09-25T15:13:00.000Z"))).toBeNull();
    const later = activity("x1", "tool-call.started", { toolCallId: "c" }, "turn-2");
    expect(detectUsageLimit(state({ activities: [hit, later] }), now)).toBeNull();
    expect(detectUsageLimit(state({ activities: [] }), now)).toBeNull();
  });

  it("reads the wait in hours and minutes", () => {
    expect(untilLabel(new Date("2026-09-25T15:12:00.000Z"), now)).toBe("in 1h 12m");
    expect(untilLabel(new Date("2026-09-25T14:04:30.000Z"), now)).toBe("in 5m");
    expect(untilLabel(new Date("2026-09-27T16:00:00.000Z"), now)).toBe("in 2d 2h");
    expect(untilLabel(new Date("2026-09-25T13:00:00.000Z"), now)).toBe("now");
  });
});

describe("continuing after a usage limit", () => {
  const now = Date.parse("2026-09-25T14:00:00.000Z");
  const hit = activity("u1", "usage.limit", { label: "Session", resetsAt: "2026-09-25T15:12:00.000Z" });
  const prompt = (id: string, turnId: string, text: string, origin?: string): MessageEnvelope =>
    ({ ...message(id, text), role: "user", turnId, ...(origin === undefined ? {} : { origin }) }) as MessageEnvelope;
  const thread = (queued: Array<{ turnId: string; messageId: string }>) =>
    ({ id: "t", queuedTurns: queued.map((row) => ({ ...row, scheduledFor: "2026-09-25T15:13:00.000Z", scheduleReason: "usage-reset" })) }) as unknown as ThreadState["thread"];

  it("keeps the limit in force while the continue waits, and hides the waiting continue", () => {
    const scheduled = activity("s1", "turn.scheduled", { scheduledFor: "2026-09-25T15:13:00.000Z", reason: "usage-reset" }, "turn-2");
    const waiting = state({
      activities: [hit, scheduled],
      messages: [prompt("m2", "turn-2", "The usage limit that stopped the last turn has reset. Continue.", "usage-continue")],
      thread: thread([{ turnId: "turn-2", messageId: "m2" }]),
    });
    expect(detectUsageLimit(waiting, now)?.label).toBe("Session");
    const entries = timeline(waiting);
    expect(entries.map((entry) => entry.id)).toEqual(["u1"]);
  });

  it("drops a scheduled message cancelled before it ran, prompt and all", () => {
    const scheduled = activity("s1", "turn.scheduled", { scheduledFor: "2026-09-25T15:13:00.000Z" }, "turn-2");
    const cancelled = activity("i1", "turn.interrupted", { beforeStart: true }, "turn-2");
    const entries = timeline(state({ activities: [hit, scheduled, cancelled], messages: [prompt("m2", "turn-2", "later please")] }));
    expect(entries.map((entry) => entry.id)).toEqual(["u1"]);
    expect(detectUsageLimit(state({ activities: [hit, scheduled, cancelled] }), now)?.label).toBe("Session");
  });

  it("recognises an older cancel by a queued turn interrupted without being promoted", () => {
    const queued = activity("q1", "turn.queued", {}, "turn-2");
    const stopped = activity("i1", "turn.interrupted", {}, "turn-2");
    expect(timeline(state({ activities: [queued, stopped], messages: [prompt("m2", "turn-2", "queued one")] }))).toEqual([]);
    const promoted = activity("p1", "turn.promoted", {}, "turn-2");
    const ran = timeline(state({ activities: [queued, promoted, stopped], messages: [prompt("m2", "turn-2", "queued one")] }));
    expect(ran.map((entry) => entry.id)).toEqual(["m2"]);
  });

  it("tells a continue apart from the user's own prompts, tagged or by its text", () => {
    expect(isUsageContinue(prompt("a", "t", "anything", "usage-continue"))).toBe(true);
    expect(isUsageContinue(prompt("b", "t", USAGE_CONTINUE_PROMPT))).toBe(true);
    expect(isUsageContinue(prompt("c", "t", "Continue the task"))).toBe(false);
    expect(isUsageContinue(null)).toBe(false);
  });
});

describe("thinking as it streams", () => {
  const running = (text = "") =>
    activity("r1", "reasoning", { itemType: "reasoning", toolCallId: "reasoning:m:0", status: "inProgress", text, startedAt: "2026-09-25T10:00:00.000Z", durationMs: null });
  const delta = (text: string) => ({ kind: "event", event: { type: "thread.reasoning-delta", payload: { toolCallId: "reasoning:m:0", turnId: "turn-1", text } } });

  it("fills the running thought's row with the streamed text", () => {
    let current = state({ activities: [running()] });
    current = applyThreadFrame(current, delta("Weighing the "));
    current = applyThreadFrame(current, delta("two options."));
    const entry = timeline(current).find((row) => row.id === "r1");
    expect(describeActivity(entry!.activity!)).toMatchObject({ kind: "reasoning", running: true, text: "Weighing the two options." });
  });

  it("keeps the streamed text across a snapshot until the thought's completed row lands", () => {
    let current = applyThreadFrame(state({ activities: [running()] }), delta("Half a thought"));
    const snapshot = (activities: unknown[]) => ({ kind: "snapshot", snapshot: { snapshotSequence: 2, thread: { id: "t", activities, messages: [] } } });
    current = applyThreadFrame(current, snapshot([running()]));
    expect(current.liveReasoning).toEqual({ "reasoning:m:0": "Half a thought" });
    const done = activity("r22", "reasoning", { itemType: "reasoning", toolCallId: "reasoning:m:0", status: "completed", text: "Whole thought.", durationMs: 4000 });
    current = applyThreadFrame(current, snapshot([running(), done]));
    expect(current.liveReasoning).toEqual({});
  });
});

describe("the provider's own limit reply", () => {
  it("is hidden in a turn the usage-limit notice covers, kept elsewhere", () => {
    const hit = activity("u1", "usage.limit", { label: "Session", resetsAt: "2026-09-25T15:12:00.000Z" });
    const reply = message("m1", "You've hit your session limit · resets 4:40am (Europe/Madrid)");
    expect(timeline(state({ activities: [hit], messages: [reply] })).map((entry) => entry.id)).toEqual(["u1"]);
    expect(timeline(state({ messages: [reply] })).map((entry) => entry.id)).toEqual(["m1"]);
  });
});

describe("background subagents in the transcript", () => {
  it("folds the subagent's task rows into the Agent call that launched it", () => {
    const agentCall = activity("a1", "tool-call.completed", {
      itemType: "dynamic_tool_call",
      toolCallId: "toolu_1",
      status: "completed",
      data: { tool: "Agent", state: { input: { subagent_type: "Explore", description: "List CLI commands" }, output: "Async agent launched" } },
    });
    const started = activity("b1", "background.started", { taskId: "ag", toolUseId: "toolu_1", status: "started", taskType: "local_agent" });
    const shell = activity("b22", "background.started", { taskId: "sh", toolUseId: "toolu_2", status: "started", taskType: "local_bash" });
    const done = activity("b333", "background.completed", { taskId: "ag", toolUseId: "toolu_1", status: "completed" });

    const running = timeline(state({ activities: [agentCall, started, shell] }));
    expect(running.map((entry) => entry.id)).toEqual(["a1", "b22"]);
    expect(describeActivity(running[0]!.activity!)).toMatchObject({ kind: "agent", title: "Explore", subject: "List CLI commands", state: "working in the background", running: true });

    const finished = timeline(state({ activities: [agentCall, started, shell, done] }));
    expect(finished.map((entry) => entry.id)).toEqual(["a1", "b22"]);
    expect(describeActivity(finished[0]!.activity!)).toMatchObject({ state: "finished", running: false });
  });
});

describe("moxen task calls in the transcript", () => {
  it("titles task_status with the task its delegate call started", () => {
    const tool = (id: string, name: string, input: Record<string, unknown>, output: string) =>
      activity(id, "tool-call.completed", { itemType: "dynamic_tool_call", toolCallId: id, status: "completed", data: { tool: name, state: { input, output } } });
    const entries = timeline(
      state({
        activities: [
          tool("d", "mcp__moxen__delegate", { task: "run it" }, JSON.stringify({ taskId: "task-1", title: "Run bun check", status: "running" })),
          tool("s1", "mcp__moxen__task_status", { taskId: "task-1" }, JSON.stringify({ taskId: "task-1", status: "completed" })),
        ],
      }),
    );
    expect(describeActivity(entries.find((entry) => entry.id === "s1")!.activity!)).toMatchObject({ title: "task status", subject: "Run bun check", state: "finished" });
  });
});

describe("native subagent notices", () => {
  it("opens the turn a finished background subagent woke with its card", () => {
    const at = (second: number) => `2026-09-25T10:00:${String(second).padStart(2, "0")}.000Z`;
    const row = (id: string, kind: string, payload: Record<string, unknown>, second: number, turnId = "turn-1") =>
      ({ ...activity(id, kind, payload, turnId), createdAt: at(second) }) as ActivityEnvelope;
    const activities = [
      row("a", "tool-call.completed", { toolCallId: "toolu_1", status: "completed", data: { tool: "Agent", state: { input: { subagent_type: "Explore", description: "Count TODOs" } } } }, 1),
      row("b", "background.started", { taskId: "ag", toolUseId: "toolu_1", status: "started" }, 1),
      row("c", "background.completed", { taskId: "ag", toolUseId: "toolu_1", status: "completed", summary: "Found 3.\n\n| table | rows |" }, 14),
      row("w", "turn.background", {}, 15, "turn-2"),
    ];
    const notice = timeline(state({ activities })).find((entry) => entry.kind === "user");
    expect(notice?.turnId).toBe("turn-2");
    expect(taskNotifications(notice!.message)).toEqual([
      { taskId: "ag", source: "native", title: "Explore · Count TODOs", status: "completed", durationMs: 13_000, model: null, branch: null, headline: "Found 3.", filesChanged: null, additions: null, deletions: null },
    ]);
    // The card explains the wake-up, so its "Woken by a background task" row goes.
    expect(timeline(state({ activities })).some((entry) => entry.activityKind === "turn.background")).toBe(false);
    // A wake-up nothing explains keeps it.
    expect(timeline(state({ activities: [activities[3]!] })).some((entry) => entry.activityKind === "turn.background")).toBe(true);
    // No wake-up after it: the Agent row says it finished, no card.
    expect(timeline(state({ activities: activities.slice(0, 3) })).some((entry) => entry.kind === "user")).toBe(false);
  });
});

describe("queuedSummary", () => {
  it("counts held messages among the waiting ones, never on top of them", () => {
    expect(queuedSummary(1, 1)).toBe("1 held for the reset");
    expect(queuedSummary(2, 0)).toBe("2 not sent yet");
    expect(queuedSummary(3, 1)).toBe("3 not sent yet, 1 of them held for the reset");
  });
});
