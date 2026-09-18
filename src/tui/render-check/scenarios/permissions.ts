import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { fail, permissionFooterTarget } from "../helpers.js";

/** The composer footer's permission segment opens the permission picker,
    whose rows are the provider's supported modes (all four here — the mock
    catalog states none, and t-now is still selected this early). Picking
    dispatches thread.runtime-mode.set and the mock server accepts, closing
    back to the composer. */
export async function runPermissions(setup: TestRendererSetup): Promise<void> {
  await act(async () => {
    const target = permissionFooterTarget(setup);
    await setup.mockMouse.click(target.x, target.y);
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- permission picker (open) ---");
  const permissionOpenFrame = setup.captureCharFrame();
  console.log(permissionOpenFrame);
  if (!permissionOpenFrame.includes("Select permission")) fail("permission footer click did not open the picker");
  if (!permissionOpenFrame.includes("Supervised")) fail("permission picker missing the Supervised row");
  await act(async () => {
    const rows = setup.captureCharFrame().split("\n");
    const y = rows.findIndex((line) => line.includes("Supervised"));
    if (y === -1) fail("Supervised row not visible");
    const x = rows[y]?.indexOf("Supervised") ?? -1;
    await setup.mockMouse.click(x === -1 ? 55 : x, y);
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.flush();
  console.log("--- permission picked (dispatched) ---");
  const permissionDoneFrame = setup.captureCharFrame();
  console.log(permissionDoneFrame);
  if (permissionDoneFrame.includes("Select permission")) fail("permission pick did not close the picker");
}
