import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { fail } from "../helpers.js";

/** The timeline diff row, the Worked fold, and the diff-turn picker. */
export async function runDiffPanel(setup: TestRendererSetup): Promise<void> {
  // The timeline's own "diff …" row — the `d` keybinding is gone, so this
  // click is the way a user opens it. Still near the top here (above the
  // fold, no jump-pill overlap yet).
  await act(async () => setup.mockMouse.click(52, 8));
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- turn diff expanded (clicked timeline row) ---");
  console.log(setup.captureCharFrame());

  // The "Worked for" fold in the chat column (top row once the prompt scrolls off).
  await act(async () => setup.mockMouse.click(45, 1));
  await setup.flush();
  // Scroll up so the expanded cards (not just the tail) are visible.
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  console.log("--- work expanded (top) ---");
  console.log(setup.captureCharFrame());
  // A replied turn folds its tools into per-message summary segments inside
  // the expanded Worked fold — no per-tool stacks anywhere. Sweep the whole
  // transcript top to bottom: expand any collapsed fold on sight, and pass
  // iff the aggregate summary shows up somewhere with no per-tool stack ever
  // appearing. Position-free by design — sticky-scroll jumps make fixed
  // coordinates meaningless here. Ends with turn-1 expanded, which is what
  // later steps assume.
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  let sawSummary = false;
  let sawStack = false;
  for (let sweep = 0; sweep < 60; sweep += 1) {
    const frame = setup.captureCharFrame();
    if (frame.includes("Ran 3 commands")) sawSummary = true;
    if (frame.includes("read ×") || frame.includes("Update ×")) sawStack = true;
    if (sawSummary) break;
    const rows = frame.split("\n");
    const shutFold = rows.findIndex((line) => line.includes("▸ Worked for"));
    if (shutFold !== -1) {
      const line = rows[shutFold] ?? "";
      const glyph = line.indexOf("▸");
      await act(async () => setup.mockMouse.click(glyph === -1 ? 50 : glyph, shutFold));
      await setup.flush();
      continue;
    }
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
  }
  console.log("--- work summarized (inside fold) ---");
  console.log(setup.captureCharFrame());
  if (sawStack) fail("tool calls still stack per tool");
  if (!sawSummary) fail("closed turn does not summarize its tools");
  // Wheel down to review the remaining cards.
  for (let wheel = 0; wheel < 18; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(80, 12, "down"));
  }
  await setup.flush();
  console.log("--- work expanded (scrolled) ---");
  console.log(setup.captureCharFrame());

  // Second file header inside the diff panel (below the new diff-turn header
  // row and the first file's content rows).
  await act(async () => setup.mockMouse.click(105, 8));
  await setup.flush();
  console.log("--- second file folded (clicked header) ---");
  console.log(setup.captureCharFrame());

  // The diff panel's own header row opens the turn picker …
  await act(async () => setup.mockMouse.click(110, 1));
  await setup.flush();
  console.log("--- diff-turn picker (open) ---");
  console.log(setup.captureCharFrame());

  // … which closes back to the diff on backdrop click (the esc key calls the
  // same `onClose`; the mock's `pressEscape` is sync-void while clicks are the
  // proven in-harness path — the corner is outside the centered panel).
  await act(async () => setup.mockMouse.click(130, 24));
  await setup.flush();
  console.log("--- diff-turn picker (backdrop closed) ---");
  console.log(setup.captureCharFrame());

  // … and jumps the timeline to the picked turn when its row is picked (Turn
  // 5 here — a different turn than the open Turn 7, so the panel switches too
  // and the jump must land on the settled post-open layout, at the top).
  await act(async () => setup.mockMouse.click(110, 1));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 6));
  await new Promise((resolve) => setTimeout(resolve, 500));
  await setup.flush();
  console.log("--- diff-turn picked (timeline jumped) ---");
  console.log(setup.captureCharFrame());
}
