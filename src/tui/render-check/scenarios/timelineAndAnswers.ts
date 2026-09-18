import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { wasModalJustDismissed } from "../../model/modalDismiss.js";
import { fail, replyHeader } from "../helpers.js";
import { emitLiveRef, userInputRequestedFrame } from "../fixtures.js";

/** The closing reply's message actions, an inline agent question arriving
    live, answering it, the toast-dismiss swallow window, and the reply
    click past that window opening message actions. */
export async function runTimelineAndAnswers(setup: TestRendererSetup): Promise<void> {
  // The assistant's closing reply opens the same modal: back to the top and
  // click the reply card below the prompt.
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  console.log("--- timeline top (idle) ---");
  console.log(setup.captureCharFrame());

  // Wheel inside the timeline box (not the tasks/composer rows below it)
  // until the closing reply's header scrolls into view, then click it.
  for (let wheel = 0; wheel < 40; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    if (/Claude Opus 5\s+·\s+\d\d:\d\d/.test(setup.captureCharFrame())) break;
  }
  await setup.flush();
  console.log("--- reply visible ---");
  console.log(setup.captureCharFrame());

  // Clicking the assistant's closing reply opens the same modal (Copy plus
  // Revert, resolved through its turn).
  await act(async () => {
    const header = replyHeader(setup);
    await setup.mockMouse.click(header.x, header.y);
  });
  await setup.flush();
  console.log("--- assistant message actions (open) ---");
  console.log(setup.captureCharFrame());

  // An agent question arrives mid-run: dismiss the open modal first (pending
  // answers wait for a free UI), then the inline panel replaces the composer.
  await act(async () => setup.mockMouse.click(130, 24));
  await setup.flush();
  await act(async () => {
    emitLiveRef.current?.(userInputRequestedFrame("que_live1"));
  });
  await setup.flush();
  console.log("--- answer panel (inline) ---");
  console.log(setup.captureCharFrame());

  // Single-select: picking the first option submits and restores the composer.
  await act(async () => setup.mockMouse.click(60, 21));
  await setup.flush();
  console.log("--- answer submitted ---");
  console.log(setup.captureCharFrame());

  // Manually dismissing the "Answer submitted" toast marks the same 250ms
  // swallow window as a modal dismiss: the click's mouse-up lands on timeline
  // content instead of the overlay. The toast stack shifts with timing
  // (auto-expiry), so locate the toast's × cell in the live frame instead of
  // hardcoding its row.
  // Let any earlier dismiss window expire, so the toast assertion below
  // proves the × click's own mark rather than a stale one (the 2500ms toast
  // easily survives the wait).
  await new Promise((resolve) => setTimeout(resolve, 350));
  const answerToastRows = setup.captureCharFrame().split("\n");
  const answerToastRow = answerToastRows.findIndex((line) => line.includes("Answer submitted"));
  if (answerToastRow === -1) fail("expected Answer submitted toast");
  const answerToastX = answerToastRows[answerToastRow]?.lastIndexOf("×") ?? -1;
  if (answerToastX === -1) fail("Answer submitted toast has no ×");
  await act(async () => setup.mockMouse.click(answerToastX, answerToastRow));
  await setup.flush();
  if (!wasModalJustDismissed()) fail("toast × did not mark the dismiss window");
  console.log("--- toast dismissed (manual ×) ---");
  const toastDismissedFrame = setup.captureCharFrame();
  console.log(toastDismissedFrame);
  if (toastDismissedFrame.includes("Answer submitted")) fail("toast × did not dismiss");

  // A reply click inside the window is swallowed — no message-actions modal.
  // Assert the window is still held first, so a slow harness reads as a
  // harness failure instead of a false behavior pass.
  if (!wasModalJustDismissed()) fail("harness outran the 250ms dismiss window");
  await act(async () => {
    const header = replyHeader(setup);
    await setup.mockMouse.click(header.x, header.y);
  });
  await setup.flush();
  console.log("--- reply click inside toast-dismiss window (swallowed) ---");
  const swallowedFrame = setup.captureCharFrame();
  console.log(swallowedFrame);
  if (swallowedFrame.includes("Message actions"))
    fail("reply click inside toast-dismiss window opened message actions");

  // Past the window the same click opens message actions.
  await new Promise((resolve) => setTimeout(resolve, 350));
  await act(async () => {
    const header = replyHeader(setup);
    await setup.mockMouse.click(header.x, header.y);
  });
  await setup.flush();
  console.log("--- reply click past window (actions open) ---");
  const reopenedFrame = setup.captureCharFrame();
  console.log(reopenedFrame);
  if (!reopenedFrame.includes("Message actions"))
    fail("reply click past window did not open message actions");

  // Backdrop-dismiss restores the closed state the answer flow below expects.
  await act(async () => setup.mockMouse.click(130, 24));
  await setup.flush();
}
