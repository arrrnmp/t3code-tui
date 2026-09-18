import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

/** Prompt-click message actions: copy, and the revert two-step confirm
    (blocked while running, then succeeding on an idle thread). */
export async function runMessageActions(setup: TestRendererSetup): Promise<void> {
  // Back to the top of the timeline, then click the user prompt: mouse-up on
  // a PromptBlock (not a selection drag) opens message actions.
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  await act(async () => setup.mockMouse.click(60, 5));
  await setup.flush();
  console.log("--- message actions (open) ---");
  console.log(setup.captureCharFrame());

  // Copy closes the modal with a toast …
  await act(async () => setup.mockMouse.click(55, 13));
  await setup.flush();
  console.log("--- message copied ---");
  console.log(setup.captureCharFrame());

  // … reopen (past the 250ms dismiss-guard window, which swallows the
  // mouse-up half of a backdrop-dismiss gesture), arm the revert …
  await new Promise((resolve) => setTimeout(resolve, 350));
  await act(async () => setup.mockMouse.click(60, 5));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 14));
  await setup.flush();
  console.log("--- revert armed ---");
  console.log(setup.captureCharFrame());

  // … and confirm: the turn is still running, so the guard refuses with a
  // toast instead of dispatching (the toast paints above the still-open modal).
  await act(async () => setup.mockMouse.click(55, 14));
  await new Promise((resolve) => setTimeout(resolve, 500));
  await setup.flush();
  console.log("--- revert blocked while running ---");
  console.log(setup.captureCharFrame());

  // Same flow on an idle thread: dismiss the modal via the backdrop first
  // (it stays open on guard failure, so a bare sidebar click would only land
  // on the backdrop), open t-xash from the sidebar, back to the top, and
  // click the prompt again.
  await act(async () => setup.mockMouse.click(130, 24));
  await setup.flush();
  await act(async () => setup.mockMouse.click(10, 6));
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  await act(async () => setup.mockMouse.click(60, 5));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 14));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 14));
  await new Promise((resolve) => setTimeout(resolve, 500));
  await setup.flush();
  console.log("--- turn reverted (resynced) ---");
  console.log(setup.captureCharFrame());
}
