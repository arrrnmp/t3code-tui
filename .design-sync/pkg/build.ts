/**
 * Builds `.design-sync/pkg/dist/` — Moxen's TUI components compiled for a
 * browser. Run from the repo root: `bun .design-sync/pkg/build.ts`.
 *
 *   dist/index.js      ESM, react external; @opentui/* swapped for ../shim/
 *   dist/index.d.ts    re-export of tsc's declarations (dist/types/)
 *   dist/styles.css    the cell grid + every theme token as a CSS custom property
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { BunPlugin } from "bun";
import { buildTreeSitterAssets } from "./treesitter-assets.ts";

const PKG = dirname(new URL(import.meta.url).pathname);
const SHIM = join(PKG, "shim");
const DIST = join(PKG, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const opentuiShim: BunPlugin = {
  name: "opentui-dom-shim",
  setup(build) {
    build.onResolve({ filter: /^@opentui\/react\/jsx(-dev)?-runtime$/ }, () => ({ path: join(SHIM, "jsx-runtime.ts") }));
    build.onResolve({ filter: /^@opentui\/react$/ }, () => ({ path: join(SHIM, "opentui-react.tsx") }));
    build.onResolve({ filter: /^@opentui\/core$/ }, () => ({ path: join(SHIM, "opentui-core.ts") }));
    build.onResolve({ filter: /^(node:)?(path|os|fs|fs\/promises|module)$/ }, () => ({ path: join(SHIM, "node-builtins.ts") }));
  },
};

// Tree-sitter grammars first: the shim bundles the registry they generate.
const ts = await buildTreeSitterAssets(DIST);
console.log(`tree-sitter: ${ts.grammars} grammars → dist/tree-sitter/ (${(ts.bytes / 1048576).toFixed(1)} MB)`);

const result = await Bun.build({
  entrypoints: [join(PKG, "src/index.ts")],
  outdir: DIST,
  naming: "index.js",
  target: "browser",
  format: "esm",
  minify: false,
  external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [opentuiShim],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Declarations: tsc over the same entry. Type errors in the shim don't block
// emit; the converter reads prop shapes from these.
const tsc = spawnSync(resolve(PKG, "../../node_modules/.bin/tsc"), ["-p", join(PKG, "tsconfig.json")], { encoding: "utf8" });
if (tsc.stdout.trim()) console.error(`[tsc] declarations emitted with diagnostics:\n${tsc.stdout.split("\n").slice(0, 20).join("\n")}`);
writeFileSync(join(DIST, "index.d.ts"), 'export * from "./types/.design-sync/pkg/src/index.js";\n');

// Tokens straight from the theme module, so the CSS can never drift from it.
const theme = await import("../../src/tui/theme.ts");
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\./g, "-").toLowerCase();
const lines: string[] = [];
for (const [k, v] of Object.entries(theme.SURFACE)) lines.push(`  --mx-surface-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(theme.COLOR)) lines.push(`  --mx-color-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(theme.STATUS_COLOR)) lines.push(`  --mx-status-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(theme.DIFF_BG)) lines.push(`  --mx-diff-bg-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(theme.CODE_SYNTAX_TOKENS)) lines.push(`  --mx-syntax-${kebab(k)}: ${v.fg};`);
const pick = await import("../../src/tui/features/pickers/pickermodal.tsx").catch(() => null);
lines.push(`  --mx-pick-bg: ${pick?.PICK_BG ?? "#df9f5f"};`, `  --mx-pick-fg: ${pick?.PICK_FG ?? "#221503"};`);

const css = `@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap");
/* Moxen TUI tokens — generated from src/tui/theme.ts by .design-sync/pkg/build.ts. Do not edit.
   The TUI renders in the user's own terminal font; JetBrains Mono stands in so cell metrics match everywhere. */
:root {
${lines.join("\n")}
  /* The cell grid: one column (--mx-cw) by one row (--mx-lh). */
  --mx-font: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --mx-font-size: 14px;
  --mx-lh: 18px;
  --mx-lh-px: 18;
  /* A hair over one glyph: a line of exactly N glyphs must fit N cells
     despite sub-pixel rounding, as it does in the terminal. */
  --mx-cw: calc(1ch + 0.02px);
}

/* The terminal: every Moxen screen renders inside one of these (see <Terminal>). */
.mx-term {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--mx-font);
  font-size: var(--mx-font-size);
  line-height: var(--mx-lh);
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
  color: var(--mx-color-text);
  -webkit-font-smoothing: antialiased;
  tab-size: 2;
}
.mx-term *, .mx-term *::before, .mx-term *::after { box-sizing: border-box; }
.mx-term ::selection { background: var(--mx-color-selection-bg); }
.mx-border { position: absolute; pointer-events: none; }
.mx-border-title {
  position: absolute;
  height: var(--mx-lh);
  white-space: pre;
  background: var(--mx-bg, var(--mx-surface-base));
  z-index: 1;
}
.mx-input, .mx-textarea {
  font: inherit;
  line-height: var(--mx-lh);
  border: 0;
  outline: 0;
  padding: 0;
  margin: 0;
  caret-color: var(--mx-color-accent);
}
.mx-input::placeholder, .mx-textarea::placeholder { color: var(--mx-placeholder, var(--mx-color-faint)); }
.mx-textarea { position: absolute; inset: 0; width: 100%; height: 100%; resize: none; overflow: auto; }
.mx-term .mx-scroll-viewport { scrollbar-width: thin; }
`;
writeFileSync(join(DIST, "styles.css"), css);
console.log(`built ${join(DIST, "index.js")} (${(result.outputs[0]!.size / 1024).toFixed(0)} KB) + styles.css`);
