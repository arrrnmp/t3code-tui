/**
 * Prints opentui's real char frame for every export of the named previews:
 *   bun .design-sync/pkg/ref/ref.tsx Sidebar PickerModal
 * Writes .design-sync/.cache/ref/<Name>.<Export>.txt, and <Name>.<Export>.spans.json
 * (per-cell glyph, fg, attributes — what `colors.mjs` diffs the browser against).
 * Registers the repo's extra tree-sitter grammars first, as the app does at boot.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = import.meta.dir;

const { act } = await import("react");
const { registerSyntaxParsers } = await import("../../../src/tui/syntax/register.ts");
await registerSyntaxParsers();
const { testRender } = await import("@opentui/react/test-utils");
const OUT = resolve(HERE, "../../.cache/ref");
mkdirSync(OUT, { recursive: true });

for (const name of process.argv.slice(2)) {
  // The preview verbatim, with '@moxen/tui' pointed at the real-opentui entry.
  const src = readFileSync(resolve(HERE, "../../previews", `${name}.tsx`), "utf8").replace(/(["'])@moxen\/tui\1/g, JSON.stringify(join(HERE, "ref-entry.tsx")));
  const staged = join(HERE, `.staged.${name}.tsx`);
  writeFileSync(staged, src);
  const mod = await import(staged);
  for (const [exp, Comp] of Object.entries(mod)) {
    if (typeof Comp !== "function") continue;
    const el = (Comp as () => any)();
    const width = el?.props?.width ?? 120;
    const height = el?.props?.height ?? 36;
    try {
      const setup = await testRender(<Comp />, { width, height, exitOnCtrlC: false });
      // Highlighting runs in opentui's parser worker; give it time, then settle.
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 300));
        });
        await setup.flush();
      }
      // Row-numbered so leading blank rows survive any display that trims whitespace.
      const frame = setup
        .captureCharFrame()
        .split("\n")
        .slice(0, height)
        .map((row, i) => `${String(i).padStart(2, "0")}|${row}`)
        .join("\n");
      writeFileSync(join(OUT, `${name}.${exp}.txt`), frame);
      const hex = (c: { r: number; g: number; b: number }) =>
        "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
      const spans = setup.captureSpans();
      const grid = spans.lines.slice(0, height).map((line) => {
        const cells: [string, string, number][] = [];
        for (const span of line.spans) for (const ch of [...span.text]) cells.push([ch, hex(span.fg), span.attributes]);
        return cells;
      });
      writeFileSync(join(OUT, `${name}.${exp}.spans.json`), JSON.stringify(grid));
      console.log(`--- ${name}.${exp} (${width}x${height}) ---\n${frame}`);
      setup.renderer.destroy();
    } catch (e) {
      console.log(`--- ${name}.${exp}: REF ERROR ${(e as Error).message}`);
    }
  }
}
process.exit(0);
