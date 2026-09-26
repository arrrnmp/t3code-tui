import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { fail } from "../helpers.js";

/** Prompt-click message actions: copy, and the revert two-step confirm
    (blocked while running, then succeeding on an idle thread). */
export async function runMessageActions(setup: TestRendererSetup): Promise<void> {
  // Rows are found by their label, not a fixed row: the modal is centred, so
  // its rows move whenever it gains or loses one.
  // `required` rows fail the walkthrough when missing; the first pass runs
  // wherever the palette scenario left the app, so its rows are best-effort.
  const clickRow = async (label: string, required = false): Promise<void> => {
    const rows = setup.captureCharFrame().split("\n");
    const y = rows.findIndex((line) => line.includes(label));
    if (y === -1) {
      if (required) {
        console.log(rows.join("\n"));
        fail(`message actions row "${label}" not visible`);
      }
      return;
    }
    await act(async () => setup.mockMouse.click(rows[y]!.indexOf(label) + 2, y));
  };
  // Back to the top of the timeline, then click the user prompt: mouse-up on
  // a PromptBlock (not a selection drag) opens message actions.
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  await act(async () => setup.mockMouse.click(60, 5));
  await setup.flush();
  console.log("--- message actions (open) ---");
  console.log(setup.captureCharFrame());

  // Copy closes the modal with a toast …
  await clickRow("Copy");
  await setup.flush();
  console.log("--- message copied ---");
  console.log(setup.captureCharFrame());

  // … reopen (past the 250ms dismiss-guard window, which swallows the
  // mouse-up half of a backdrop-dismiss gesture), arm the revert …
  await new Promise((resolve) => setTimeout(resolve, 350));
  await act(async () => setup.mockMouse.click(60, 5));
  await setup.flush();
  await clickRow("Revert to before this turn");
  await setup.flush();
  console.log("--- revert armed ---");
  console.log(setup.captureCharFrame());

  // … and confirm: the turn is still running, so the guard refuses with a
  // toast instead of dispatching (the toast paints above the still-open modal).
  await clickRow("Confirm revert");
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
  // ModalShell fades in; look for its rows once it is up.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  await setup.flush();
  await clickRow("Revert to before this turn", true);
  await setup.flush();
  await clickRow("Confirm revert", true);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await setup.flush();
  console.log("--- turn reverted (resynced) ---");
  console.log(setup.captureCharFrame());
}
