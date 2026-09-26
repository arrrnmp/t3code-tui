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
          contextUsage: { usedTokens: 359_000, maxTokens: 1_000_000, totalProcessedTokens: 1_400_000, costUsd: 4.2 },
        },
      },
    });
  });
  await setup.flush();
  console.log("--- context-usage footer segment ---");
  console.log(setup.captureCharFrame());

  // Clicking the segment opens the side panel's Context tab (the reading,
  // session cost and tokens processed).
  const footer = setup.captureCharFrame().split("\n");
  const segmentRow = footer.findIndex((row) => row.includes("36% · 359k/1m"));
  const segmentCol = footer[segmentRow]!.indexOf("36% · 359k/1m");
  await act(async () => setup.mockMouse.click(segmentCol + 2, segmentRow));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  await setup.flush();
  console.log("--- context tab (from the footer) ---");
  const tab = setup.captureCharFrame();
  console.log(tab);
  if (!tab.includes("359k / 1m")) fail("context-usage segment did not open the Context tab");
  if (!tab.includes("$4.20")) fail("Context tab did not show the session cost");
  if (!tab.includes("1.4m tokens processed")) fail("Context tab did not show the tokens processed");

  // The tab bar's × closes the panel.
  const tabBar = tab.split("\n")[0]!;
  await act(async () => setup.mockMouse.click(tabBar.lastIndexOf("×"), 0));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  await setup.flush();
  if (setup.captureCharFrame().includes("session cost $4.20")) fail("the tab bar's × did not close the Context tab");
}
