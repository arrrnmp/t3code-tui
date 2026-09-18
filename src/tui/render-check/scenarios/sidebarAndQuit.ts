import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

/** Initial mount, the settled-section footer toggle, and the full-size
    Ctrl+C quit confirm. */
export async function runSidebarAndQuit(setup: TestRendererSetup): Promise<void> {
  await setup.flush();
  // Markdown parses through tree-sitter off the render pass, so the first frame
  // lands before message bodies exist.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await setup.flush();
  console.log("--- settled collapsed ---");
  console.log(setup.captureCharFrame());
  {
    const frame = setup.captureSpans();
    const backgrounds = new Map<string, number>();
    for (const line of frame.lines) {
      for (const span of line.spans) {
        const { r, g, b } = span.bg;
        const key = [r, g, b].map((value) => Math.round(value * 255)).join(",");
        backgrounds.set(key, (backgrounds.get(key) ?? 0) + span.text.length);
      }
    }
    console.log("distinct backgrounds:", backgrounds.size);
    for (const [color, count] of [...backgrounds].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`  ${color} -> ${count} cells`);
    }
  }

  // Ctrl+C opens a compact, content-sized confirm (not full-screen) with a
  // dimmed backdrop behind it — left-aligned copy, right-aligned actions.
  await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await setup.flush();
  console.log("--- quit confirm (ctrl+c) ---");
  console.log(setup.captureCharFrame());
  await act(async () => setup.mockInput.pressEscape());
  await new Promise((resolve) => setTimeout(resolve, 200));
  await setup.flush();

  // Sidebar geometry: border row, then three 3-line thread cards, then the
  // settled header — clicking it is what a user does to expand the section.
  await act(async () => setup.mockMouse.click(6, 24));
  await setup.flush();
  console.log("--- settled expanded (clicked footer header) ---");
  console.log(setup.captureCharFrame());
}
