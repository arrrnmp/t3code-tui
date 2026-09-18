import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

/** The command palette's copy row, filter-to-delete two-step confirm,
    rename, regenerate title, compact, settle, and archive. */
export async function runCommandPalette(setup: TestRendererSetup): Promise<void> {
  // The command palette opens on ctrl+p from any pane.
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  console.log("--- command palette (open) ---");
  console.log(setup.captureCharFrame());

  // A copy row works inline (toast where the clipboard resolves) and leaves
  // the palette open for the next action.
  await act(async () => setup.mockMouse.click(55, 10));
  await setup.flush();
  console.log("--- palette copy branch ---");
  console.log(setup.captureCharFrame());

  // Typing narrows the filter down to the delete action (one round trip per
  // letter: a synchronous burst would reuse a stale filter closure and only
  // the last letter would survive).
  for (const char of ["d", "e", "l", "e", "t", "e"]) {
    await act(async () => setup.mockInput.pressKey(char));
    await setup.flush();
  }
  console.log("--- palette filtered ---");
  console.log(setup.captureCharFrame());

  // … enter arms the two-step confirm …
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  console.log("--- delete armed ---");
  console.log(setup.captureCharFrame());

  // … and enter again dispatches (the mock server accepts), falling back to
  // the next thread.
  await act(async () => setup.mockInput.pressEnter());
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- thread deleted (fallback selected) ---");
  console.log(setup.captureCharFrame());

  // Rename opens its own prompt, prefilled with the current title …
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 17));
  await setup.flush();
  console.log("--- rename modal (open) ---");
  console.log(setup.captureCharFrame());

  // … typing appends and enter submits (the mock server accepts).
  await act(async () => setup.mockInput.pressKey("!"));
  await setup.flush();
  await act(async () => setup.mockInput.pressEnter());
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- rename submitted ---");
  console.log(setup.captureCharFrame());

  // Regenerate fires a toast and closes back to where the palette opened.
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 16));
  await setup.flush();
  console.log("--- title regenerate fired ---");
  console.log(setup.captureCharFrame());

  // Compact dispatches a /compact turn and closes.
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 19));
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- compact dispatched ---");
  console.log(setup.captureCharFrame());

  // Settle toasts and closes, keeping the thread selected.
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 15));
  await setup.flush();
  console.log("--- thread settled ---");
  console.log(setup.captureCharFrame());

  // Archive last: success toasts and falls back to the next thread.
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
  await setup.flush();
  await act(async () => setup.mockMouse.click(55, 18));
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- thread archived (fallback selected) ---");
  console.log(setup.captureCharFrame());
}
