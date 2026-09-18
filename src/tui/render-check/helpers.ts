import type { TestRendererSetup } from "@opentui/core/testing";

/** Loud, fast failure: a bare throw skips the trailing `process.exit(0)`,
    leaving renderer handles open until the harness hangs instead of going
    red, so every scripted assertion below exits through here. */
export function fail(message: string): never {
  console.error(`render-check FAILED: ${message}`);
  process.exit(1);
}

/** The composer footer's permission segment — its row shifts with the
    footer segments to its right (copy/external/stop), so it's located
    fresh rather than hardcoded. */
export function permissionFooterTarget(setup: TestRendererSetup): { x: number; y: number } {
  const rows = setup.captureCharFrame().split("\n");
  const y = rows.findIndex((line) => line.includes("Full access"));
  if (y === -1) fail("permission footer segment not visible");
  const x = rows[y]?.indexOf("Full access") ?? -1;
  return { x: x === -1 ? 60 : x, y };
}

/** The closing assistant reply's header. Located fresh every time — flat
    tool rows above it reflow the pane, so stale coordinates would miss. */
export function replyHeader(setup: TestRendererSetup): { x: number; y: number } {
  const rows = setup.captureCharFrame().split("\n");
  const y = rows.findIndex((line) => /Claude Opus 5\s+·\s+\d\d:\d\d/.test(line));
  if (y === -1) fail("closing reply header not visible");
  const x = rows[y]?.indexOf("Claude Opus 5") ?? -1;
  // Click the header row well right of the text, still inside the card: a
  // click on a text cell leaves a live selection behind, and any later
  // message-action click reads that stale selection as "that was a drag"
  // and swallows itself. Empty card chrome selects only spaces.
  return { x: x === -1 ? 100 : Math.min(x + 60, 125), y };
}

/** The Worked fold, located by text from the top — flat tool rows reflow
    the pane, so fixed rows miss. Returns its toggle target and whether it
    currently shows collapsed. */
export async function foldTarget(
  setup: TestRendererSetup,
  act: typeof import("react").act,
): Promise<{ x: number; y: number; collapsed: boolean }> {
  await act(async () => setup.mockInput.pressKey("HOME"));
  await setup.flush();
  for (let wheel = 0; wheel < 30; wheel += 1) {
    const rows = setup.captureCharFrame().split("\n");
    const row = rows.findIndex((line) => line.includes("Worked for"));
    if (row !== -1) {
      const line = rows[row] ?? "";
      const glyph = line.indexOf("▸") !== -1 ? line.indexOf("▸") : line.indexOf("▾");
      return { x: glyph === -1 ? 50 : glyph, y: row, collapsed: line.includes("▸") };
    }
    await act(async () => setup.mockMouse.scroll(70, 5, "down"));
    await setup.flush();
  }
  fail("Worked fold not visible");
}

/** Long bash commands clamp with an expander: located fresh for every
    click — expanding reflows the pane, so stale coordinates would miss. */
export function probeBashHeader(setup: TestRendererSetup): { x: number; y: number } {
  const rows = setup.captureCharFrame().split("\n");
  const y = rows.findIndex((line) => line.includes("$ bash"));
  if (y === -1) fail("probe command header not visible");
  const x = rows[y]?.indexOf("$ bash") ?? -1;
  return { x: x === -1 ? 50 : x, y };
}
