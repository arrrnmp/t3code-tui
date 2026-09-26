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
 * Background work (`run_in_background` commands, Monitor watches,
 * background subagents): the live set surfaces as a composer footer segment
 * ("1 shell"), and the palette offers both a "View background tasks" row
 * (opens the browser) and a direct per-task stop row. Both go away once the
 * provider reports the set empty.
 *
 * The footer segment opens the side panel's Background tab; a row there
 * opens the browser (list -> details -> back -> closed). Not from the
 * palette row: swapping one open picker for a
 * different modal type from inside its own row handler doesn't repaint in
 * this harness (the "Rename thread" row has the same gap). Every modal step
 * waits out ModalShell's fade-in, and every bare ESC the parser's
 * escape-sequence timeout, before capturing.
 */
export async function runBackgroundWork(setup: TestRendererSetup): Promise<void> {
  await act(async () => {
    emitLiveRef.current?.(
      activityFrame("bg-set-1", "background.tasks", "1 background task running", {
        tasks: [
          {
            taskId: "bg-1",
            taskType: "local_bash",
            description: "watch the build log",
            toolName: "Bash",
            command: "tail -f build.log",
          },
        ],
      }),
    );
  });
  await setup.flush();
  const running = setup.captureCharFrame();
  console.log("--- composer footer: background segment ---");
  console.log(running);
  if (!running.includes("1 shell")) fail("composer footer did not show the background segment for a running task");

  // Clicking the segment opens the Background tab: the task with its
  // command and a stop control.
  const runningRows = running.split("\n");
  const segmentRow = runningRows.findIndex((row) => row.includes("1 shell"));
  const segmentCol = runningRows[segmentRow]!.indexOf("1 shell");
  await act(async () => setup.mockMouse.click(segmentCol + 2, segmentRow));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  await setup.flush();
  const tab = setup.captureCharFrame();
  console.log("--- side panel: background tab ---");
  console.log(tab);
  if (!tab.includes("Running in the background")) fail("footer segment did not open the Background tab");
  // The strip shortens its labels on a narrow panel so the close control
  // stays reachable; the badge is what this asserts, not the wording.
  if (!/(Background|Bkgd) 1/.test(tab)) fail("Background tab carries no running-count badge");
  if (!tab.includes("tail -f build.log")) fail("Background tab row is missing the task's command");

  // A row opens the browser: grouped by kind, each task its name over the
  // command it runs.
  const tabRows = tab.split("\n");
  const taskRow = tabRows.findIndex((row) => row.includes("Shell · watch the build log"));
  const taskCol = tabRows[taskRow]!.indexOf("Shell · watch the build log");
  await act(async () => setup.mockMouse.click(taskCol + 2, taskRow));
  // ModalShell fades in over ~150ms; capture once it's opaque.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
  await setup.flush();
  const list = setup.captureCharFrame();
  console.log("--- background browser: list ---");
  console.log(list);
  if (!list.includes("Background work")) fail("Background tab row did not open the background browser");
  if (!list.includes("Shells (1)")) fail("background browser did not group the task under Shells");
  if (!list.includes("watch the build log") || !list.includes("tail -f build.log")) {
    fail("background browser row is missing the task's name or command");
  }

  // Enter drills into the task: status, command, and its output.
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  const details = setup.captureCharFrame();
  console.log("--- background browser: details ---");
  console.log(details);
  if (!details.includes("Shell · watch the build log")) fail("details view did not title the task by kind and name");
  if (!details.includes("● running")) fail("details view did not show the running status");
  if (!details.includes("watching build.log")) fail("details view did not show the task's output");

  // esc steps back to the list, a second esc closes the browser. A bare
  // ESC only lands once the input parser's escape-sequence timeout passes.
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
  await act(async () => setup.mockInput.pressEscape());
  await settle();
  await setup.flush();
  if (!setup.captureCharFrame().includes("Shells (1)")) fail("esc from details did not return to the list");
  await act(async () => setup.mockInput.pressEscape());
  await settle();
  await setup.flush();
  if (setup.captureCharFrame().includes("Background work")) fail("esc from the list did not close the browser");
  // The panel keeps focus behind the browser: one more esc closes it.
  await act(async () => setup.mockInput.pressEscape());
  await settle();
  await setup.flush();
  if (setup.captureCharFrame().includes("Running in the background")) fail("esc did not close the side panel");

  // The palette offers to view or stop it.
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  for (const char of "background") {
    await act(async () => setup.mockInput.pressKey(char));
    await setup.flush();
  }
  const filtered = setup.captureCharFrame();
  console.log("--- palette: background rows ---");
  console.log(filtered);
  if (!filtered.includes("View background tasks")) fail("palette does not offer to view background tasks");
  if (!filtered.includes("Stop background: watch the build log")) fail("palette does not offer to stop the background task");
  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();

  // The set empties: the footer segment and both palette rows go.
  await act(async () => {
    emitLiveRef.current?.(activityFrame("bg-set-2", "background.tasks", "0 background tasks running", { tasks: [] }));
  });
  await setup.flush();
  const done = setup.captureCharFrame();
  if (done.includes("1 shell")) fail("background segment stayed after the set emptied");
}
