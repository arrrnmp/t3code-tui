import { describe, expect, it } from "vitest";

import { applyThreadFrame, emptyThreadState, isQuestionToolActivity, latestPlan, pendingUserInputRequests, resumeCompactionKey, shouldOfferResumeCompaction, timeline } from "../thread.js";

function messageSent(messageId: string, text: string, streaming: boolean) {
  return {
    kind: "event",
    event: {
      type: "thread.message-sent",
      payload: {
        messageId,
        role: "assistant",
        text,
        turnId: "turn-1",
        streaming,
        createdAt: "2026-09-15T00:20:00.000Z",
        updatedAt: "2026-09-15T00:20:00.000Z",
      },
    },
  };
}

describe("applyThreadFrame message streaming", () => {
  it("appends deltas while streaming and keeps text on the empty close", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, messageSent("m1", "Hello ", true));
    state = applyThreadFrame(state, messageSent("m1", "world", true));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe("Hello world");
    expect(state.messages[0]?.streaming).toBe(true);

    // The completion event carries empty text; the accumulated reply survives.
    state = applyThreadFrame(state, messageSent("m1", "", false));
    expect(state.messages[0]?.text).toBe("Hello world");
    expect(state.messages[0]?.streaming).toBe(false);
  });

  it("replaces text when a completed message carries a full body", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, messageSent("m1", "stale", false));
    state = applyThreadFrame(state, messageSent("m1", "fresh", false));
    expect(state.messages[0]?.text).toBe("fresh");
  });
});

describe("applyThreadFrame contextUsage", () => {
  it("decodes contextUsage off a provider-thread.updated event", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "event",
      event: {
        type: "provider-thread.updated",
        payload: {
          id: "pt_1",
          contextUsage: {
            usedTokens: 359_000,
            maxTokens: 1_000_000,
            totalProcessedTokens: 1_400_000,
            cachedInputTokens: 12_000,
            compactsAutomatically: true,
            autoCompactThreshold: 900_000,
          },
        },
      },
    });
    expect(state.contextUsage).toEqual({
      usedTokens: 359_000,
      maxTokens: 1_000_000,
      totalProcessedTokens: 1_400_000,
      cachedInputTokens: 12_000,
      compactsAutomatically: true,
      autoCompactThreshold: 900_000,
    });
    expect(state.unhandled).toEqual({});
  });

  it("ignores a payload missing usedTokens instead of throwing", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "event",
      event: { type: "provider-thread.updated", payload: { id: "pt_1", contextUsage: { maxTokens: 1_000_000 } } },
    });
    expect(state.contextUsage).toBeNull();
  });

  it("picks up contextUsage already present on resnapshot, nested or via providerThreads", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: { id: "t1", contextUsage: { usedTokens: 10_000, maxTokens: 200_000, totalProcessedTokens: null } },
      },
    });
    expect(state.contextUsage).toEqual({
      usedTokens: 10_000,
      maxTokens: 200_000,
      totalProcessedTokens: null,
      cachedInputTokens: null,
      compactsAutomatically: null,
      autoCompactThreshold: null,
    });

    let viaProviderThreads = emptyThreadState();
    viaProviderThreads = applyThreadFrame(viaProviderThreads, {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: { id: "t1" },
        providerThreads: [{ id: "pt_1", contextUsage: { usedTokens: 5_000, maxTokens: null, totalProcessedTokens: null } }],
      },
    });
    expect(viaProviderThreads.contextUsage?.usedTokens).toBe(5_000);
  });

  // The real V1 wire never sends `provider-thread.updated`/`contextUsage` —
  // it reports usage as a `context-window.updated` *activity* instead
  // (confirmed against a live Claude thread's transcript). Without this
  // path `contextUsage` stayed null forever and the context-usage card
  // never appeared.
  const contextWindowActivity = (payload: Record<string, unknown>) => ({
    id: "cw1",
    kind: "context-window.updated",
    tone: "info",
    summary: "Context window updated",
    turnId: "turn-1",
    createdAt: "2026-09-17T05:20:51.000Z",
    payload,
  });

  it("decodes contextUsage off a live context-window.updated activity", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "event",
      event: {
        type: "thread.activity-appended",
        payload: {
          activity: contextWindowActivity({
            usedTokens: 431_553,
            lastUsedTokens: 431_553,
            totalProcessedTokens: 20_964_294,
            inputTokens: 431_544,
            outputTokens: 9,
            maxTokens: 1_000_000,
          }),
        },
      },
    });
    expect(state.contextUsage).toEqual({
      usedTokens: 431_553,
      maxTokens: 1_000_000,
      totalProcessedTokens: 20_964_294,
      cachedInputTokens: null,
      compactsAutomatically: null,
      autoCompactThreshold: null,
    });
  });

  it("decodes contextUsage off a context-window.updated activity on resnapshot", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          id: "t1",
          activities: [contextWindowActivity({ usedTokens: 173_555, maxTokens: 1_000_000, totalProcessedTokens: 4_336_196 })],
        },
      },
    });
    expect(state.contextUsage?.usedTokens).toBe(173_555);
  });
});

describe("timeline bookkeeping filtering", () => {
  it("hides context-window.updated and checkpoint.captured rows from the transcript", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      snapshotWith({
        thread: {
          id: "t1",
          activities: [
            {
              id: "cw1",
              kind: "context-window.updated",
              tone: "info",
              summary: "Context window updated",
              turnId: "turn-1",
              createdAt: "2026-09-17T05:20:51.000Z",
              payload: { usedTokens: 1000, maxTokens: 1_000_000, totalProcessedTokens: null },
            },
            {
              id: "cp1",
              kind: "checkpoint.captured",
              tone: "info",
              summary: "Checkpoint captured",
              turnId: "turn-1",
              createdAt: "2026-09-17T05:20:51.000Z",
              payload: { turnCount: 5, status: "ready" },
            },
          ],
        },
      }),
    );
    expect(timeline(state)).toHaveLength(0);
  });

  it("hides AskUserQuestion tool echoes and user-input.resolved, keeping the requested question row", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      snapshotWith({
        thread: {
          id: "t1",
          activities: [
            {
              id: "ask1",
              kind: "tool.completed",
              tone: "tool",
              summary: "Tool call",
              turnId: "turn-1",
              createdAt: "2026-09-17T05:20:51.000Z",
              payload: {
                itemType: "dynamic_tool_call",
                toolCallId: "toolu_ask1",
                status: "completed",
                title: "Tool call",
                detail: "AskUserQuestion: {}",
                data: { toolName: "AskUserQuestion", input: {} },
              },
            },
            {
              id: "req1",
              kind: "user-input.requested",
              tone: "info",
              summary: "User input requested",
              turnId: "turn-1",
              createdAt: "2026-09-17T05:20:52.000Z",
              payload: {
                requestId: "req_1",
                questions: [{ id: "q1", header: "Next", question: "What next?", options: [] }],
              },
            },
            {
              id: "res1",
              kind: "user-input.resolved",
              tone: "info",
              summary: "User input submitted",
              turnId: "turn-1",
              createdAt: "2026-09-17T05:20:53.000Z",
              payload: { requestId: "req_1", answers: {} },
            },
          ],
        },
      }),
    );
    expect(
      isQuestionToolActivity({
        id: "ask1",
        kind: "tool.completed",
        payload: {
          itemType: "dynamic_tool_call",
          data: { toolName: "AskUserQuestion" },
        },
      } as never),
    ).toBe(true);
    const entries = timeline(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.activityKind).toBe("user-input.requested");
  });
});

function snapshotWith(thread: Record<string, unknown>) {
  const inner = (thread.thread as Record<string, unknown> | undefined) ?? thread;
  return { kind: "snapshot", snapshot: { snapshotSequence: 1, thread: inner } };
}

function planActivity(id: string, kind: string, extra: Record<string, unknown>) {
  return {
    id,
    tone: "tool",
    kind,
    summary: kind === "turn.plan.updated" ? "Plan updated" : "0 todos",
    turnId: "turn-1",
    createdAt: "2026-09-15T00:21:00.000Z",
    payload: extra,
  };
}

describe("timeline plan filtering", () => {
  it("hides plan cards from the transcript but keeps the tasks panel fed", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      snapshotWith({
        thread: {
          id: "t1",
          activities: [
            planActivity("p1", "turn.plan.updated", { plan: [{ step: "First", status: "inProgress" }] }),
            planActivity("p2", "tool.completed", {
              itemType: "dynamic_tool_call",
              toolCallId: "call-todo",
              status: "completed",
              title: "0 todos",
              data: { tool: "todowrite", state: { status: "completed", input: { todos: [] } } },
            }),
          ],
        },
      }),
    );
    expect(timeline(state)).toHaveLength(0);
    expect(latestPlan(state)?.items).toHaveLength(1);
  });

  it("hides stripped wire-shape todowrite rows by title", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      snapshotWith({
        thread: {
          id: "t1",
          activities: [planActivity("p3", "tool.started", { itemType: "dynamic_tool_call", title: "todowrite", data: {} })],
        },
      }),
    );
    expect(timeline(state)).toHaveLength(0);
  });

  it("attaches checkpoint +/- counts to edit rows", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      snapshotWith({
        thread: {
          id: "t1",
          activities: [
            {
              id: "e1",
              tone: "tool",
              kind: "tool.completed",
              summary: "src\\tui\\app.tsx",
              turnId: "turn-1",
              createdAt: "2026-09-15T00:22:00.000Z",
              payload: {
                itemType: "file_change",
                toolCallId: "call-edit",
                status: "completed",
                title: "src\\tui\\app.tsx",
                data: { files: [{ path: "C:/repo/src/tui/app.tsx" }] },
              },
            },
          ],
          checkpoints: [
            {
              turnId: "turn-1",
              checkpointTurnCount: 1,
              status: "ready",
              files: [{ path: "src/tui/app.tsx", kind: "modified", additions: 15, deletions: 3 }],
            },
          ],
        },
      }),
    );
    const entries = timeline(state);
    // One activity row plus the turn-diff summary row for the checkpoint.
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.kind === "activity")?.editStats).toEqual({ added: 15, removed: 3 });
  });

  it("surfaces a proposed plan as its own timeline row", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      snapshotWith({
        thread: {
          id: "t1",
          proposedPlans: [
            {
              id: "plan-1",
              turnId: "turn-1",
              planMarkdown: "## Plan\n\n- step one",
              implementedAt: null,
              implementationThreadId: null,
              createdAt: "2026-09-16T09:08:00.000Z",
              updatedAt: "2026-09-16T09:08:00.000Z",
            },
          ],
        },
      }),
    );
    const entries = timeline(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "proposed-plan", turnId: "turn-1" });
    expect(entries[0]?.proposedPlan?.planMarkdown).toBe("## Plan\n\n- step one");
  });

  it("upserts a plan delivered as a live event by its shape, not a fixed event type", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "event",
      event: {
        type: "thread.proposed-plan-set",
        payload: {
          id: "plan-1",
          turnId: "turn-1",
          planMarkdown: "draft",
          createdAt: "2026-09-16T09:08:00.000Z",
          updatedAt: "2026-09-16T09:08:00.000Z",
        },
      },
    });
    expect(state.proposedPlans).toHaveLength(1);
    state = applyThreadFrame(state, {
      kind: "event",
      event: {
        type: "thread.proposed-plan-set",
        payload: {
          id: "plan-1",
          turnId: "turn-1",
          planMarkdown: "revised",
          createdAt: "2026-09-16T09:08:00.000Z",
          updatedAt: "2026-09-16T09:09:00.000Z",
        },
      },
    });
    expect(state.proposedPlans).toHaveLength(1);
    expect(state.proposedPlans[0]?.planMarkdown).toBe("revised");
  });
});

describe("pendingUserInputRequests", () => {
  const requestedActivity = (requestId: string, id = "a1") => ({
    id,
    kind: "user-input.requested",
    tone: "info",
    summary: "User input requested",
    turnId: "turn-1",
    createdAt: "2026-09-16T09:00:00.000Z",
    payload: {
      requestId,
      questions: [
        {
          id: "q1",
          header: "Next",
          question: "What next?",
          multiSelect: false,
          options: [
            { label: "A", description: "first" },
            { label: "B", description: "second", value: "b-val" },
          ],
        },
      ],
    },
  });

  const resolvedActivity = (requestId: string) => ({
    id: "a2",
    kind: "user-input.resolved",
    tone: "info",
    summary: "User input submitted",
    turnId: "turn-1",
    createdAt: "2026-09-16T09:01:00.000Z",
    payload: { requestId, answers: { q1: "A" } },
  });

  const withActivities = (activities: unknown[]) => ({
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 1,
      thread: {
        id: "t1",
        messages: [],
        activities,
        checkpoints: [],
        proposedPlans: [],
        session: null,
      },
    },
  });

  it("returns requested questions with options until resolved", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(state, withActivities([requestedActivity("que_1")]));
    const pending = pendingUserInputRequests(state);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.requestId).toBe("que_1");
    expect(pending[0]?.questions[0]).toMatchObject({ id: "q1", header: "Next", multiSelect: false });
    expect(pending[0]?.questions[0]?.options).toEqual([
      { label: "A", description: "first", value: null },
      { label: "B", description: "second", value: "b-val" },
    ]);
    state = applyThreadFrame(
      state,
      withActivities([requestedActivity("que_1"), resolvedActivity("que_1")]),
    );
    expect(pendingUserInputRequests(state)).toHaveLength(0);
  });

  it("keeps other requests when one resolves", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      withActivities([requestedActivity("que_1"), requestedActivity("que_2", "a3"), resolvedActivity("que_1")]),
    );
    expect(pendingUserInputRequests(state).map((request) => request.requestId)).toEqual(["que_2"]);
  });

  it("drops malformed requests without input", () => {
    let state = emptyThreadState();
    state = applyThreadFrame(
      state,
      withActivities([
        {
          id: "a9",
          kind: "user-input.requested",
          tone: "info",
          summary: "User input requested",
          turnId: "turn-1",
          createdAt: "2026-09-16T09:00:00.000Z",
          payload: { requestId: "que_x", questions: [{ id: "q1" }] },
        },
      ]),
    );
    expect(pendingUserInputRequests(state)).toHaveLength(0);
  });
});

describe("shouldOfferResumeCompaction", () => {
  // Mirrors the desktop rule: Claude only, >= 100k tokens, snapshot >= 70
  // minutes stale. Builds state through the same snapshot path the live
  // subscription uses so the timestamp wiring is covered too.
  function stateWithWindow(usedTokens: number, createdAt: string) {
    let state = emptyThreadState();
    state = applyThreadFrame(state, {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          id: "t1",
          activities: [
            {
              id: "cw1",
              kind: "context-window.updated",
              tone: "info",
              summary: "Context window updated",
              turnId: "turn-1",
              createdAt,
              payload: { usedTokens, maxTokens: 1_000_000, totalProcessedTokens: null },
            },
          ],
        },
      },
    });
    return state;
  }

  const now = Date.parse("2026-09-17T06:00:00.000Z");

  it("offers resume compaction for a stale Claude snapshot over 100k tokens", () => {
    const state = stateWithWindow(431_553, "2026-09-17T04:40:00.000Z");
    expect(shouldOfferResumeCompaction(state, "claudeAgent", now)).toBe(true);
    expect(resumeCompactionKey(state)).toBe("t1:2026-09-17T04:40:00.000Z");
  });

  it("stays quiet for fresh snapshots, small windows, and other providers", () => {
    const fresh = stateWithWindow(431_553, "2026-09-17T05:50:00.000Z");
    expect(shouldOfferResumeCompaction(fresh, "claudeAgent", now)).toBe(false);
    const small = stateWithWindow(50_000, "2026-09-17T04:00:00.000Z");
    expect(shouldOfferResumeCompaction(small, "claudeAgent", now)).toBe(false);
    const stale = stateWithWindow(431_553, "2026-09-17T04:40:00.000Z");
    expect(shouldOfferResumeCompaction(stale, "codex", now)).toBe(false);
    expect(shouldOfferResumeCompaction(emptyThreadState(), "claudeAgent", now)).toBe(false);
  });
});
