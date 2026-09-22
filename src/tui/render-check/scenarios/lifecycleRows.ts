import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { fail } from "../helpers.js";

/**
 * Turn bookkeeping never reaches the transcript. The fixture carries a
 * `turn.started` and a `turn.completed` row (markers `LIFECYCLE-*`); both
 * are the store's own lifecycle ledger, and rendering them is what turned
 * a two-message chat into "Worked for 4s · 2 steps" over a prompt echo and
 * a raw turn id. Scroll the whole timeline and prove neither ever paints.
 */
export async function runLifecycleRows(setup: TestRendererSetup): Promise<void> {
  const markers = ["LIFECYCLE-PROMPT-ECHO", "LIFECYCLE-TURN-ID"];
  const check = (frame: string): void => {
    for (const marker of markers) {
      if (frame.includes(marker)) fail(`turn bookkeeping rendered in the transcript: ${marker}`);
    }
  };

  // Ride to the top, then sweep back down, checking every frame on the way.
  for (let wheel = 0; wheel < 80; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "up"));
    await setup.flush();
    check(setup.captureCharFrame());
  }
  console.log("--- timeline top (no lifecycle rows) ---");
  console.log(setup.captureCharFrame());
  for (let wheel = 0; wheel < 80; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    check(setup.captureCharFrame());
  }
  console.log("--- timeline bottom (no lifecycle rows) ---");
  console.log(setup.captureCharFrame());
}
