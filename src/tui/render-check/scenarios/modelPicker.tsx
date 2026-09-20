import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";

import { App, client } from "../fixtures.js";
import { fail } from "../helpers.js";

/** Footer model segment in the thread view: the "Claude Opus 5" label that
    opens the model picker (the timeline reply header carries the same name
    plus a timestamp, so the footer is the occurrence sharing a row with the
    permission segment). */
function threadFooterModelTarget(setup: TestRendererSetup): { x: number; y: number } {
  const rows = setup.captureCharFrame().split("\n");
  const y = rows.findIndex((line) => line.includes("Claude Opus 5") && line.includes("Full access"));
  if (y === -1) fail("composer footer model segment not visible");
  const x = rows[y]?.indexOf("Claude Opus 5") ?? -1;
  return { x: x === -1 ? 50 : x + 2, y };
}

/**
 * I2: the picker is live server data, never a hardcoded list — a disabled
 * instance still reports its models over `getConfig` (Grok below), and the
 * user's hidden-model preferences ride in `settings`. Both must stay out of
 * the offered rows. I1: the same picker must open while drafting with no
 * source thread (zero-thread workspace), storing the pick locally instead of
 * erroring with "no open thread to set the model for".
 */
export async function runModelPicker(setup: TestRendererSetup): Promise<void> {
  // Thread view: the open thread locks the picker to its own provider, so
  // only that provider's visible models are offered.
  await act(async () => {
    const target = threadFooterModelTarget(setup);
    await setup.mockMouse.click(target.x, target.y);
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- model picker (thread view) ---");
  const threadFrame = setup.captureCharFrame();
  console.log(threadFrame);
  if (!threadFrame.includes("Select model")) fail("model footer click did not open the picker");
  if (!threadFrame.includes("Claude Opus 5")) fail("model picker missing the current model");
  if (threadFrame.includes("Claude Old")) fail("model picker offered a hidden model");
  if (threadFrame.includes("Grok")) fail("model picker offered another provider in the locked thread view");
  await act(async () => setup.mockInput.pressEscape());
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  if (setup.captureCharFrame().includes("Select model")) fail("model picker did not close on esc");

  // Zero-thread workspace: fresh install with projects but no threads lands
  // in the creating view — the model picker must open there too (I1), and a
  // disabled provider's models must stay hidden even with no provider lock
  // (I2, the friend's Grok rows).
  const emptyClient = {
    ...client,
    subscribeShell(_options: unknown, onItem: (item: unknown) => void) {
      onItem({
        kind: "snapshot",
        snapshot: {
          snapshotSequence: 1,
          projects: [{ id: "p-cli", title: "t3code-cli", workspaceRoot: "C:\\repo" }],
          threads: [],
        },
      });
      onItem({ kind: "synchronized" });
      return () => {};
    },
    subscribeThread() {
      return () => {};
    },
  };
  const empty = await testRender(
    <App client={emptyClient} onQuit={() => {}} />,
    { width: 140, height: 26, exitOnCtrlC: false },
  );
  try {
    await empty.flush();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await empty.flush();
    const creatingFrame = empty.captureCharFrame();
    console.log("--- empty workspace (creating view) ---");
    console.log(creatingFrame);
    if (!creatingFrame.includes("What should we build in")) fail("empty workspace did not land in the creating view");
    if (creatingFrame.includes("no open thread to set the model for")) {
      fail("empty workspace shows the model error without any interaction");
    }
    const rows = creatingFrame.split("\n");
    const footer = rows.findIndex((line) => line.includes("- · Full access"));
    if (footer === -1) fail("empty creating-view composer footer not visible");
    const x = rows[footer]?.indexOf("- · Full access") ?? -1;
    await act(async () => {
      await empty.mockMouse.click(x === -1 ? 50 : x, footer);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await empty.flush();
    console.log("--- model picker (empty workspace) ---");
    const emptyFrame = empty.captureCharFrame();
    console.log(emptyFrame);
    if (!emptyFrame.includes("Select model")) fail("model picker did not open with zero threads");
    if (emptyFrame.includes("no open thread to set the model for")) {
      fail("model picker errored with zero threads");
    }
    if (!emptyFrame.includes("Claude Opus 5")) fail("empty-workspace picker missing the enabled model");
    if (emptyFrame.includes("Grok")) fail("empty-workspace picker offered a disabled provider");
    if (emptyFrame.includes("Claude Old")) fail("empty-workspace picker offered a hidden model");
    await act(async () => empty.mockInput.pressEscape());
    await empty.flush();
  } finally {
    empty.renderer.destroy();
  }
}
