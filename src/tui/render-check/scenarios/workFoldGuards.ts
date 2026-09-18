import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { wasModalJustDismissed } from "../../model/modalDismiss.js";
import { fail, foldTarget } from "../helpers.js";
import { emitLiveRef, userInputRequestedFrame } from "../fixtures.js";

/** The Worked-fold toggle and segment-summary toggle both mark the same
    dismiss-guard window as a modal close (they reflow the pane on the same
    click that triggered them); then a second live question, dismissed with
    esc. */
export async function runWorkFoldGuards(setup: TestRendererSetup): Promise<void> {
  // Let the backdrop-dismiss window expire, so the work-toggle assertion below
  // proves the toggle's own mark rather than a stale one.
  await new Promise((resolve) => setTimeout(resolve, 350));

  // Normalize to collapsed, then expand under test (with a gap so the final
  // assertion proves the expanding click's own mark, not the collapse's).
  {
    const target = await foldTarget(setup, act);
    if (!target.collapsed) {
      await act(async () => setup.mockMouse.click(target.x, target.y));
      await setup.flush();
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  {
    const target = await foldTarget(setup, act);
    await act(async () => setup.mockMouse.click(target.x, target.y));
    await setup.flush();
  }
  if (!wasModalJustDismissed()) fail("work toggle did not mark the dismiss window");
  console.log("--- work expanded (guard marked) ---");
  const workExpandedFrame = setup.captureCharFrame();
  console.log(workExpandedFrame);
  if (workExpandedFrame.includes("▸ Worked for")) fail("work toggle did not expand");

  // Scroll down over the timeline to review the expanded flat rows.
  for (let wheel = 0; wheel < 6; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  }
  await setup.flush();
  console.log("--- work expanded (scrolled to tools) ---");
  console.log(setup.captureCharFrame());

  // Let the work-toggle window expire, so the assertion below proves the
  // segment-summary toggle's own mark. Clicking a segment summary expands its
  // flat tools (the per-tool stack toggle this step used to cover is gone —
  // tools render flat inside message-closed segments) and reflows the pane,
  // so it marks the same swallow window too.
  await new Promise((resolve) => setTimeout(resolve, 350));
  {
    // Segments render inside the expanded fold — make sure it is open (the
    // collapse above is what the previous search leaves behind when it runs
    // before this step, not a state this step can assume either way).
    const target = await foldTarget(setup, act);
    if (target.collapsed) {
      await act(async () => setup.mockMouse.click(target.x, target.y));
      await setup.flush();
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  {
    // The segment summary sits just below its fold — step down until it
    // scrolls into view, expand it, and prove the flat tools appear.
    let summaryRow = -1;
    for (let wheel = 0; wheel < 15 && summaryRow === -1; wheel += 1) {
      const rows = setup.captureCharFrame().split("\n");
      summaryRow = rows.findIndex((line) => line.includes("▸ Ran "));
      if (summaryRow !== -1) break;
      await act(async () => setup.mockMouse.scroll(70, 5, "down"));
      await setup.flush();
    }
    const rows = setup.captureCharFrame().split("\n");
    summaryRow = rows.findIndex((line) => line.includes("▸ Ran "));
    if (summaryRow === -1) fail("aggregate summary row not visible");
    const line = rows[summaryRow] ?? "";
    const glyph = line.indexOf("▸");
    await act(async () => setup.mockMouse.click(glyph === -1 ? 50 : glyph, summaryRow));
    await setup.flush();
  }
  if (!wasModalJustDismissed()) fail("summary toggle did not mark the dismiss window");
  console.log("--- summary toggled (guard marked) ---");
  console.log(setup.captureCharFrame());

  // A second request arrives inline; esc dismisses it without answering.
  await act(async () => {
    emitLiveRef.current?.(userInputRequestedFrame("que_live2"));
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressEscape());
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- answer dismissed ---");
  console.log(setup.captureCharFrame());
}
