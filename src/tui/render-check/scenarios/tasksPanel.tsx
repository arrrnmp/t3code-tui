import { act } from "react";
import { testRender } from "@opentui/react/test-utils";

import { TasksPanel } from "../../features/taskspanel/taskspanel.js";
import { fail } from "../helpers.js";

/**
 * A checklist longer than the panel: it scrolls inside the panel (no "…
 * N more" rows), opens on the step being worked on, and follows that step
 * when it moves on. Rendered on its own, like the other isolated scenarios.
 */
export async function runTasksPanel(): Promise<void> {
  const items = (active: number) =>
    Array.from({ length: 14 }, (_, index) => ({
      content: `Step ${String(index + 1).padStart(2, "0")} of the plan`,
      status: index < active ? "completed" : index === active ? "inProgress" : "pending",
    }));
  let setActive: ((index: number) => void) | null = null;
  const { useState } = await import("react");
  function Harness() {
    const [active, set] = useState(9);
    setActive = set;
    return <TasksPanel plan={{ items: items(active), at: "2026-09-25T10:00:00.000Z" }} width={90} />;
  }
  const setup = await testRender(<Harness />, { width: 100, height: 14, exitOnCtrlC: false });
  await setup.flush();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  await setup.flush();
  const first = setup.captureCharFrame();
  console.log("--- tasks panel: long checklist ---");
  console.log(first);
  if (!first.includes("9 done, 1 in progress, 4 open")) fail("tasks header did not count done, in progress and open");
  if (/\babove\b|\bmore\b/.test(first)) fail("tasks panel still shows count markers instead of scrolling");
  if (!first.includes("#10 Step 10")) fail("tasks panel did not open on the step in progress");
  if (first.includes("#1 Step 01")) fail("tasks panel did not scroll past the finished steps");

  await act(async () => setActive?.(13));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  await setup.flush();
  const later = setup.captureCharFrame();
  if (!later.includes("#14 Step 14")) fail("tasks panel did not follow the step in progress");
  // No destroy(), as in bootGate: tearing down a second renderer breaks the shared one.
}
