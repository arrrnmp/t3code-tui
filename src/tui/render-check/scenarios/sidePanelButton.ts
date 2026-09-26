import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { fail } from "../helpers.js";

/**
 * The side-panel toggle in the Threads sidebar's footer: `◫ panels` while
 * the panel is closed reopens the last-used tab (here Context — the context
 * scenario just before this one leaves it as last), and it reads
 * `◧ hide panels` while one is open. It used to sit on the chat pane's
 * border, where an open panel hid it; the sidebar is always on screen.
 * Runs right after the context scenario, which leaves the panel closed,
 * and closes it again so the shared walkthrough below keeps its
 * closed-panel layout.
 */
export async function runSidePanelButton(setup: TestRendererSetup): Promise<void> {
  const idle = setup.captureCharFrame();
  if (idle.includes("Context usage")) fail("side panel is still open before the button scenario");
  if (!idle.includes("◫ panels")) fail("sidebar has no side-panel toggle while the panel is closed");
  if (!idle.includes("⚙ settings")) fail("sidebar has no settings button");

  const rows = idle.split("\n");
  const buttonRow = rows.findIndex((row) => row.includes("◫ panels"));
  await act(async () => setup.mockMouse.click(rows[buttonRow]!.indexOf("◫ panels") + 1, buttonRow));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  await setup.flush();
  console.log("--- side panel (opened from the sidebar toggle) ---");
  const tab = setup.captureCharFrame();
  console.log(tab);
  if (!tab.includes("Context usage")) fail("sidebar panel toggle did not reopen the last tab");
  // The toggle stays put and says what it now does.
  if (!tab.includes("◧ hide panels")) fail("sidebar panel toggle does not offer to hide the open panel");

  // Back to closed for the scenarios below (same × the context scenario uses).
  const tabBar = tab.split("\n")[0]!;
  await act(async () => setup.mockMouse.click(tabBar.lastIndexOf("×"), 0));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  await setup.flush();
  if (setup.captureCharFrame().includes("Context usage")) fail("the tab bar's × did not close the button-opened panel");
}
