import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { emitLiveRef } from "../fixtures.js";
import { fail } from "../helpers.js";

/** A live activity row, as the server appends it. */
function activityFrame(id: string, kind: string, summary: string, payload: Record<string, unknown>) {
  return {
    kind: "event",
    event: {
      type: "thread.activity-appended",
      payload: {
        activity: { id, kind, summary, tone: "info", turnId: "turn-2", createdAt: new Date().toISOString(), payload },
      },
    },
  };
}

/**
 * Things the provider does to a turn on its own: re-running a flagged
 * request on a fallback model (a card naming both models and why),
 * stopping at a plan usage limit (a card with the window and when it
 * resets, plus the toast), and reasoning (a timed row that expands to its
 * summary).
 */
export async function runProviderInterruptions(setup: TestRendererSetup): Promise<void> {
  // Earlier scenarios leave the chat scrolled up; follow the bottom again
  // the way a user would, so the new rows land in view.
  const jumpToBottom = async (): Promise<void> => {
    // The pill appears on the pane's 300ms scroll poll, not at once.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    await setup.flush();
    const rows = setup.captureCharFrame().split("\n");
    const row = rows.findIndex((line) => line.includes("Jump to bottom"));
    if (row === -1) return;
    await act(async () => setup.mockMouse.click(rows[row]!.indexOf("Jump to bottom") + 2, row));
    // The scroll lands on the next frame; the pill itself polls every 300ms.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    await setup.flush();
  };
  await jumpToBottom();
  await act(async () => {
    emitLiveRef.current?.(
      activityFrame("switch-1", "model.changed", "Switched to Claude Opus 5", {
        from: "claude-fable-5-1",
        to: "claude-opus-5",
        fromLabel: "Claude Fable 5.1",
        toLabel: "Claude Opus 5",
        reason: "refusal-fallback",
        scope: "session",
        category: "bio",
      }),
    );
  });
  await setup.flush();
  await jumpToBottom();
  const switched = setup.captureCharFrame();
  console.log("--- timeline: refusal fallback card ---");
  console.log(switched);
  if (!switched.includes("Switched to Claude Opus 5")) fail("model switch card did not name the fallback model");
  if (!switched.includes("Claude Fable 5.1 flagged this request (biology)")) {
    fail("model switch card did not say which model flagged the request, or why");
  }

  // 72.5 minutes out: "in 1h 13m" (or 12m if the clock ticks over mid-render).
  const resetsAt = new Date(Date.now() + 72.5 * 60_000).toISOString();
  await act(async () => {
    emitLiveRef.current?.(
      activityFrame("limit-1", "usage.limit", "Usage limit reached", {
        provider: "claude",
        rateLimitType: "five_hour",
        label: "Session",
        resetsAt,
      }),
    );
  });
  await setup.flush();
  await jumpToBottom();
  // Above the composer, a banner (not a toast) offers the continue. It
  // takes the rows the card needs on this short screen, so it goes first.
  const bannered = setup.captureCharFrame();
  console.log("--- usage limit banner ---");
  console.log(bannered);
  if (!bannered.includes("Continue at reset")) fail("usage limit banner did not offer to continue when it resets");
  if (!bannered.includes("In a new thread")) fail("usage limit banner did not offer to continue in a new thread");
  // All three actions have to fit the row: an overflow pushes Dismiss off the edge.
  if (!bannered.includes(" Dismiss ")) fail("usage limit banner actions overflowed the row");
  if (!/Resets at \d{2}:\d{2}/.test(bannered)) fail("usage limit banner did not say when the limit resets");
  const limitRows = bannered.split("\n");
  const dismissRow = limitRows.findIndex((line) => line.includes(" Dismiss "));
  await act(async () => setup.mockMouse.click(limitRows[dismissRow]!.indexOf(" Dismiss ") + 2, dismissRow));
  await setup.flush();
  if (setup.captureCharFrame().includes("Continue at reset")) fail("dismissing the usage limit banner did not hide it");
  await jumpToBottom();
  const limited = setup.captureCharFrame();
  console.log("--- timeline: usage limit card ---");
  console.log(limited);
  if (!limited.includes("Usage limit reached")) fail("usage limit card did not render");
  if (!limited.includes("Session limit")) fail("usage limit card did not name the window that ran out");
  if (!/resets \d{2}:\d{2} \(in 1h 1[23]m\)/.test(limited)) fail("usage limit card did not show the reset time and the wait");

  // Reasoning: "Thinking…" while it runs, then a collapsed "Thought for Ns"
  // that expands to the summary on click.
  const reasoningPayload = {
    itemType: "reasoning",
    toolCallId: "reasoning:msg-9:0",
    startedAt: new Date(Date.now() - 3000).toISOString(),
  };
  await act(async () => {
    emitLiveRef.current?.(
      activityFrame("think-1", "reasoning", "Thinking", { ...reasoningPayload, status: "inProgress", text: "", durationMs: null }),
    );
  });
  await setup.flush();
  await jumpToBottom();
  const thinking = setup.captureCharFrame();
  console.log("--- timeline: reasoning running ---");
  console.log(thinking);
  // The timer shows from the first full second; the app's clock ticks on its own schedule.
  if (!thinking.includes("Thinking…")) fail("running reasoning row did not render");

  // The summary streams into the running row as it forms.
  await act(async () => {
    for (const text of ["Checking which cache ", "layout the renderer reads first."]) {
      emitLiveRef.current?.({
        kind: "event",
        event: { type: "thread.reasoning-delta", payload: { toolCallId: "reasoning:msg-9:0", turnId: "turn-2", text } },
      });
    }
  });
  await setup.flush();
  await jumpToBottom();
  const streamingThought = setup.captureCharFrame();
  console.log("--- timeline: reasoning streaming ---");
  console.log(streamingThought);
  if (!streamingThought.includes("Checking which cache layout the renderer reads first.")) {
    fail("running reasoning row did not show the thinking streamed so far");
  }

  await act(async () => {
    emitLiveRef.current?.(
      activityFrame("think-2", "reasoning", "Thought for 12s", {
        ...reasoningPayload,
        status: "completed",
        text: "Comparing the cache layouts before picking one.",
        durationMs: 12_000,
      }),
    );
  });
  await setup.flush();
  await jumpToBottom();
  const thought = setup.captureCharFrame();
  console.log("--- timeline: reasoning finished ---");
  console.log(thought);
  if (!thought.includes("Thought for 12s")) fail("finished reasoning row did not show how long it took");
  if (thought.includes("Comparing the cache layouts")) fail("reasoning summary showed before the row was expanded");
  const rows = thought.split("\n");
  const row = rows.findIndex((line) => line.includes("Thought for 12s"));
  await act(async () => setup.mockMouse.click(rows[row]!.indexOf("Thought for 12s") + 2, row));
  await setup.flush();
  await jumpToBottom();
  const expanded = setup.captureCharFrame();
  console.log("--- timeline: reasoning expanded ---");
  console.log(expanded);
  if (!expanded.includes("Comparing the cache layouts")) fail("clicking the reasoning row did not show its summary");

  // A compaction the provider ran on its own: a titled row, the summary folded.
  await act(async () => {
    emitLiveRef.current?.(
      activityFrame("notice-1", "notice", "Conversation compacted automatically", {
        notice: "compacted",
        provider: "claude",
        detail: "Kept: the render-check plan and the open questions.",
      }),
    );
  });
  await setup.flush();
  await jumpToBottom();
  const compacted = setup.captureCharFrame();
  console.log("--- timeline: compaction notice ---");
  console.log(compacted);
  if (!compacted.includes("Conversation compacted automatically")) fail("compaction notice did not render");
  if (compacted.includes("Kept: the render-check plan")) fail("compaction summary showed before the row was expanded");

  // A delegated task settled: moxen writes it into the thread, drawn as a
  // card rather than a "you" prompt holding the raw notification text.
  await act(async () => {
    emitLiveRef.current?.({
      kind: "event",
      event: {
        type: "thread.message-sent",
        payload: {
          message: {
            id: "notify-1",
            role: "user",
            text: "<task-notification>\nA task you delegated has settled.\n</task-notification>",
            turnId: "turn-9",
            streaming: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            origin: "task-notification",
            notification: {
              tasks: [
                {
                  taskId: "child-1",
                  title: "scout routes",
                  status: "completed",
                  durationMs: 192_000,
                  model: "codex/gpt-5.5",
                  branch: "moxen/scout-routes",
                  headline: "Audited 3 route files: 2 missing auth checks",
                  filesChanged: 2,
                  additions: 14,
                  deletions: 3,
                },
              ],
            },
          },
        },
      },
    });
  });
  await setup.flush();
  await jumpToBottom();
  const notified = setup.captureCharFrame();
  console.log("--- timeline: delegated task settled ---");
  console.log(notified);
  if (!notified.includes('Agent "scout routes" finished') || !notified.includes("3m 12s")) {
    fail("task notification did not render as an agent card with its duration");
  }
  if (!notified.includes("Audited 3 route files: 2 missing auth checks")) fail("task notification card did not show the headline");
  if (!notified.includes("+14 −3 · 2 files") || !notified.includes("branch moxen/scout-routes")) {
    fail("task notification card did not show what the task changed and where");
  }
  if (notified.includes("<task-notification>")) fail("the raw notification text leaked into the transcript");

  // A predicted next prompt: offered in the empty composer, Tab takes it.
  // An earlier scenario leaves "/pdf" in the draft; a non-empty draft offers
  // nothing, so clear it first.
  const draftRows = setup.captureCharFrame().split("\n");
  const draftRow = draftRows.findIndex((line) => line.includes("/pdf"));
  if (draftRow !== -1) {
    await act(async () => setup.mockMouse.click(draftRows[draftRow]!.indexOf("/pdf") + 8, draftRow));
    await setup.flush();
    // "/pdf " plus slack: backspace past the start is harmless.
    for (let index = 0; index < 8; index += 1) await act(async () => setup.mockInput.pressBackspace());
    await setup.flush();
  }
  await act(async () => {
    emitLiveRef.current?.(activityFrame("suggest-1", "prompt.suggestion", "Suggested next prompt", { suggestion: "run the render check again" }));
  });
  await setup.flush();
  const offered = setup.captureCharFrame();
  console.log("--- composer: prompt suggestion ---");
  console.log(offered);
  if (!offered.includes("run the render check again") || !offered.includes("tab  to use it")) {
    fail("the composer did not offer the prompt suggestion");
  }
  const offeredRows = offered.split("\n");
  const composerRow = offeredRows.findIndex((line) => line.includes("run the render check again"));
  await act(async () => setup.mockMouse.click(offeredRows[composerRow]!.indexOf("run the render check again") + 2, composerRow));
  await setup.flush();
  await act(async () => setup.mockInput.pressTab());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  await setup.flush();
  const taken = setup.captureCharFrame();
  console.log("--- composer: suggestion taken ---");
  console.log(taken);
  if (taken.includes("tab  to use it") || !taken.includes("run the render check again")) fail("Tab did not put the suggestion in the draft");
}
