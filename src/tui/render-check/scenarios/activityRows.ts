import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { fail, probeBashHeader } from "../helpers.js";

/** Turn-2's flat activity rows: Claude- and wire-shape Read rows, the
    nameless directory List row, backfilled inline Update hunks (no
    per-file repeat), and the clamped/expandable multiline bash command. */
export async function runActivityRows(setup: TestRendererSetup): Promise<void> {
  // The card stays open (no backdrop/esc — only its × closes it, docked to
  // the chat pane's top-right, clear of the composer below). Scroll the
  // timeline to the bottom: turn-2 carries a Claude-style Read. Break as soon
  // as turn-2's prompt is visible instead of scrolling a fixed distance.
  let bottomFrame = "";
  for (let wheel = 0; wheel < 60; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    bottomFrame = setup.captureCharFrame();
    if (bottomFrame.includes("Also fold the second")) break;
  }
  if (!bottomFrame.includes("Also fold the second")) fail("never scrolled to turn-2");

  // The fold sits a few rows below the prompt, so nudge further down before
  // locating it.
  for (let wheel = 0; wheel < 6; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  }
  await setup.flush();
  bottomFrame = setup.captureCharFrame();

  // Turn-2 has no closing reply yet, so its tools render flat — expanding
  // its fold changes nothing and no per-tool stack may appear. It is the
  // only Worked fold in the bottom frame — turn-1's scrolled far above.
  const bottomRows = bottomFrame.split("\n");
  const foldRow = bottomRows.findIndex((line) => line.includes("Worked for"));
  if (foldRow === -1) fail("turn-2 Worked fold not visible");
  const foldGlyph = bottomRows[foldRow]?.indexOf("▸") ?? -1;
  await act(async () => setup.mockMouse.click(foldGlyph === -1 ? 50 : foldGlyph, foldRow));
  await setup.flush();
  // The rows render flat below the fold — scroll until the first Read shows,
  // then nudge once more for its sibling.
  let readRowFrame = "";
  for (let wheel = 0; wheel < 40; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    readRowFrame = setup.captureCharFrame();
    if (readRowFrame.includes("Read(src/tui/theme.ts)")) break;
  }
  if (!readRowFrame.includes("Read(src/tui/theme.ts)")) fail("turn-2 Read row does not render Read(path)");
  for (let wheel = 0; wheel < 6; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  }
  await setup.flush();
  console.log("--- read row (Read with path in header) ---");
  readRowFrame = setup.captureCharFrame();
  console.log(readRowFrame);
  if (!readRowFrame.includes("Read(src/tui/theme.ts)")) fail("turn-2 Read row does not render Read(path)");
  if (!readRowFrame.includes("Read(src/tui/sidebar.ts)")) fail("wire-shape Read row does not resolve the detail echo");
  if (readRowFrame.includes("read ×") || readRowFrame.includes("Update ×")) fail("tool calls still stack per tool");
  // The List row sits below the reads — one more nudge to bring it into view.
  for (let wheel = 0; wheel < 4; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  }
  await setup.flush();
  console.log("--- list row (List with path in header) ---");
  const listRowFrame = setup.captureCharFrame();
  console.log(listRowFrame);
  if (!listRowFrame.includes("List(src/tui)")) fail("directory row does not render List(path)");
  // The probe edits render flat (no `Update ×N` stack): only the first row
  // carries the backfilled hunks. Scroll until they come into view.
  let inlineFrame = "";
  for (let wheel = 0; wheel < 30; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    inlineFrame = setup.captureCharFrame();
    if (inlineFrame.includes("+ import { DiffPanel }")) break;
  }
  console.log("--- update row (inline diff backfilled) ---");
  console.log(inlineFrame);
  if (!inlineFrame.includes("+ import { DiffPanel }")) fail("inline Update row does not render backfilled hunks");
  const hunkCopies = inlineFrame.split("+ import { DiffPanel }").length - 1;
  if (hunkCopies !== 1) fail(`turn hunks repeat under same-file rows (copies=${hunkCopies})`);
  // Long bash commands clamp with an expander: the probe's tail marker stays
  // hidden until its header is clicked, and hides again on the next click.
  // The header is located fresh for every click — expanding reflows the pane,
  // so stale coordinates would miss.
  let expandFrame = "";
  for (let wheel = 0; wheel < 30; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    expandFrame = setup.captureCharFrame();
    if (expandFrame.includes("$ bash")) break;
  }
  if (!expandFrame.includes("$ bash")) fail("probe command row not visible");
  if (expandFrame.includes("# probe-tail-marker")) fail("probe command renders unclamped");
  await act(async () => {
    const header = probeBashHeader(setup);
    await setup.mockMouse.click(header.x, header.y);
  });
  await setup.flush();
  // The new rows mount below the header — scroll until the expanded content
  // comes into view.
  for (let wheel = 0; wheel < 20; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
    expandFrame = setup.captureCharFrame();
    if (expandFrame.includes("# probe-tail-marker")) break;
  }
  console.log("--- command row (expanded) ---");
  console.log(expandFrame);
  if (!expandFrame.includes("# probe-tail-marker")) fail("command header click did not expand");
  await act(async () => {
    const header = probeBashHeader(setup);
    await setup.mockMouse.click(header.x, header.y);
  });
  await setup.flush();
  // Contracting shrinks the rows away — scroll back up until the header and
  // one of its body markers are visible, then the clamped body must read
  // "more lines" with the tail marker gone.
  for (let wheel = 0; wheel < 30; wheel += 1) {
    await act(async () => setup.mockMouse.scroll(70, 5, "up"));
    await setup.flush();
    expandFrame = setup.captureCharFrame();
    if (expandFrame.includes("$ bash") && (expandFrame.includes("more lines") || expandFrame.includes("# probe-tail-marker")))
      break;
  }
  console.log("--- command row (contracted) ---");
  console.log(expandFrame);
  if (expandFrame.includes("# probe-tail-marker")) fail("command header click did not contract");
  if (!expandFrame.includes("more lines")) fail("contracted command row lost its expander");
}
