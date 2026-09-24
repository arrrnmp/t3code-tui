import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { emitLiveRef } from "../fixtures.js";
import { fail } from "../helpers.js";

/** The `$` skill mention popup, and the context-usage footer segment /
    card triggered by a live provider-thread.updated event. */
export async function runSkillsAndContext(setup: TestRendererSetup): Promise<void> {
  // Focus the composer and type a `$` mention: the skill picker floats above
  // the composer, live-filtered by the query typed after `$`.
  await act(async () => setup.mockMouse.click(60, 19));
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("$"));
  await setup.flush();
  console.log("--- skill picker (unfiltered — names must stay full-width even with long descriptions) ---");
  const unfiltered = setup.captureCharFrame();
  console.log(unfiltered);
  // Skills come from the provider's own inventory (`skills.list`).
  if (!unfiltered.includes("xlsx")) fail("skill picker is empty: the provider's inventory never reached it");
  if (unfiltered.includes("agent-only-skill")) fail("skill picker offers an agent-only skill");
  for (const char of ["p", "d"]) {
    await act(async () => setup.mockInput.pressKey(char));
    await setup.flush();
  }
  console.log("--- skill picker (filtered on $pd) ---");
  console.log(setup.captureCharFrame());

  // Enter inserts the highlighted skill and closes the picker instead of
  // submitting the draft.
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  console.log("--- skill inserted ---");
  const inserted = setup.captureCharFrame();
  console.log(inserted);
  // Claude runs a skill as `/name`, not Codex's `$name`.
  if (!inserted.includes("/pdf")) fail("picked skill was not inserted with Claude's / prefix");

  // A live provider-thread.updated event (Claude Code only, per the driver)
  // carries `contextUsage` and surfaces the context-window footer segment.
  await act(async () => {
    emitLiveRef.current?.({
      kind: "event",
      event: {
        type: "provider-thread.updated",
        payload: {
          id: "pt_1",
          contextUsage: { usedTokens: 359_000, maxTokens: 1_000_000, totalProcessedTokens: 1_400_000 },
        },
      },
    });
  });
  await setup.flush();
  console.log("--- context-usage footer segment ---");
  console.log(setup.captureCharFrame());

  // Clicking the segment opens the full card (%, bar, total processed, compact).
  await act(async () => setup.mockMouse.click(105, 23));
  await setup.flush();
  console.log("--- context-usage card (open) ---");
  console.log(setup.captureCharFrame());
}
