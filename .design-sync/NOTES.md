# design-sync notes — Moxen TUI

The TUI renders to a terminal through `@opentui/react`, not the DOM. The sync
ships the real components anyway, compiled for a browser through a DOM shim.

## How the build works

- `.design-sync/pkg/` is a synthetic package (`@moxen/tui`) whose entry
  (`src/index.ts`) re-exports the real components from `src/tui/`, the theme,
  a few pure data builders, and the shim primitives.
- `bun .design-sync/pkg/build.ts` (= `cfg.buildCmd`) bundles it with Bun,
  swapping `@opentui/react/jsx-runtime`, `@opentui/react`, `@opentui/core` and
  the Node built-ins (`path`/`os`/`fs`, reached via `core/config.ts` and
  `tui/model/message.ts`) for `.design-sync/pkg/shim/`. Output: `pkg/dist/`
  (`index.js`, tsc `.d.ts`, `styles.css` with every theme token as a CSS var).
- The shim's `jsx-runtime.ts` routes the lowercase opentui intrinsics
  (`box`, `text`, `scrollbox`, `markdown`, `diff`, `code`, `input`,
  `textarea`, `span`/`b`/`i`/`u`/`br`/`a`) to DOM components in
  `primitives.tsx`; `cells.ts` converts Yoga-in-cells layout to CSS.
- Converter: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./.ds-sync/node_modules --out ./ds-bundle`
  (entry comes from `cfg.entry`).

## Gotchas (each cost a debugging cycle)

- **`--node-modules` must be `./.ds-sync/node_modules`, not the repo's.** The
  repo resolves `react@19.3.0` but a hoisted `react-dom@19.2.7`;
  `react-dom/client` refuses a mismatched React and the converter's vendor
  step swallows the error, so every card fails with
  "ReactDOM.createRoot is not a function". `.ds-sync` pins
  `react@19.3.0` + `react-dom@19.3.0` (+ `playwright@1.58.2`, which matches the
  cached chromium-1208). Keep the pair in step with the repo's `react`.
- opentui layout rules the shim encodes (from `@opentui/core` source): default
  `flexDirection: column`; `flexGrow` 0; `flexShrink` 0 when a numeric
  width/height is set else 1; Yoga min size 0; a border takes one full cell
  per side and `position: absolute` offsets from inside it; `borderStyle` /
  `borderColor` imply `border: true`; `<text>` wraps by word by default and
  its `bg` paints behind glyphs only.
- Borders are real transparent CSS borders one cell wide, with the line drawn
  by an absolutely positioned `.mx-border` overlay (negative insets). A box
  with both a border and `overflow: hidden` would clip its own line — none do
  today.
- Previews must reproduce the app's composition. Panes that fill the height
  in the app do so because a row parent stretches them: wrap them in
  `<Box style={{ flexDirection: "row", flexGrow: 1 }}>` inside `<Terminal>`.
- Every preview is terminal-width, so every component has
  `cfg.overrides.<Name>.cardMode = "column"`.
- Groups come from `docsMap` stubs (`.design-sync/docs/groups/*.md`,
  `category:` only). The converter only applies a doc category when the
  src-derived group is "general", so `overrides/source-kit.mjs` (declared in
  `libOverrides`) pins every group to "general" first. Primitives have real
  docs in `.design-sync/docs/<Name>.md`; their `.d.ts` bodies are
  `cfg.dtsPropsFor`, copied from those docs' Props blocks (keep in sync).
- opentui's word wrap also breaks after `- / \ . , ; : ! ? ( ) [ ] { }` and
  at NBSP (`isAsciiWrapBreak`, native utf8.zig); CSS breaks only at spaces.
  The shim inserts `<wbr>` after those characters in word-wrapped `<text>`,
  `<diff wrapMode="word">` and markdown text (found by the diffgit wave on
  FileSection).
- opentui's ScrollBox draws a one-column scrollbar only while content
  overflows (thumb sized in half-cells, `SliderRenderable`); the shim paints
  that column itself and hides the native bar. Its imperative handle
  (`scrollTo`, `scrollChildIntoView`, sticky bottom) needs the root `ref` —
  a missing `ref={outer}` once made every scroll a no-op (TasksPanel
  follows the active step via `scrollTo`).
- The cell is `calc(1ch + 0.02px)` wide: at exactly `1ch`, a line of N glyphs
  in N cells wrapped early from sub-pixel rounding.
- JetBrains Mono is loaded from Google Fonts (`@import` at the top of
  `pkg/dist/styles.css`) as a stand-in for the user's terminal font, so cell
  metrics are the same everywhere. The cell is `1ch` × 18px at 14px.

## Syntax highlighting (tree-sitter in the browser)

- The TUI highlights `<code>`, `<diff>` and markdown fences with tree-sitter:
  opentui's bundled grammars (javascript, typescript, markdown(+inline), zig)
  plus the repo's `src/tui/syntax` parsers. `pkg/treesitter-assets.ts`
  collects exactly those (via `getParsers()` and opentui's own descriptor
  list) into one script per grammar (`dist/tree-sitter/<ft>.js`: base64
  wasm + queries, 20 files, ~25 MB) and a registry bundled into the shim.
- `pkg/shim/treesitter.ts` is a port of opentui's `highlightOnce` (captures,
  injections, conceal metadata) and `treeSitterToTextChunks`, run on
  web-tree-sitter 0.25.10 (opentui's pin). Diff: all displayed lines joined
  and highlighted once, conceal off; `<code>`: conceal on; markdown fences:
  info-string filetype, conceal off, plain `fg` when no language.
- **The converter can't ship extra assets.** After every package-build or
  driver run: `bun .design-sync/pkg/ship-vendor.ts ./ds-bundle` (copies the
  grammar scripts to `_vendor/tree-sitter/`), then recapture anything with
  code. Grammars are fetched relative to `_ds_bundle.js`'s own URL.
- Diff sign colours are DiffRenderable's defaults `#22c55e` / `#ef4444`, not
  theme tokens.

## Verifying fidelity: the opentui reference

`bun .design-sync/pkg/ref/ref.tsx <Name> [<Name>...]` renders each authored
preview through the **real** opentui renderer (`testRender`) and prints a
row-numbered char frame per export (also `.design-sync/.cache/ref/<Name>.<Export>.txt`).
`ref-entry.tsx` backs `Terminal`/`Box`/`Text`/... with real intrinsics. Grade
each cell by comparing the shim screenshot to this frame: same rows, same
columns, same wrap points. The React "not wrapped in act(...)" warnings in
its output are noise. It registers the repo's extra grammars first, as the
app does, and also writes `<Name>.<Export>.spans.json` (per-cell glyph + fg).

**Colour check:** `node .design-sync/pkg/ref/colors.mjs <Name>...` (after
ref.tsx, a build and ship-vendor) diffs every glyph's effective colour in the
browser (ancestor opacity and translucent overlays composited) against
opentui's spans. At sync time: 17,974 glyphs, only time-driven pulses
(LoadingScreen, TasksPanel's active ●, Timeline.Running's "Working" line) and
MonitoringBackdrop.Sidebar's dimmed dots differ. Pass names as separate args
(zsh doesn't split `$VAR`: use `xargs`).

## Preview-authoring rules (from the waves)

- Keep `<Terminal width={..} height={..}>` literal in each export's JSX:
  `ref.tsx` reads the size from the returned element, so a helper component
  wrapping `<Terminal>` makes the reference fall back to 120×36.
- The capture viewport is ~900px ≈ 104 columns: keep previews ≤ 104 wide.
- Keep background content within its pane's height (behind modals): opentui
  squeezes overflowing `<text>` rows (flexShrink 1) differently from CSS.
- States reachable only by keyboard/mouse (SettingsModal's other tabs,
  BackgroundTasksModal's detail view) can't be authored statically;
  MinSizeGate's pass-through needs ≥180×47, wider than the viewport.
- Side-panel tabs compose like app.tsx: row parent (flexGrow 1) → width-W
  column → `SideTabBar left={2} width={W-4}` over the frame's top border →
  `SidePanelFrame width={W} height={H}` with the tab's footer.

## Known render warns

- ScrollBox thumb length differs from opentui's — slightly on short lists
  (ScrollBox.FileList: 5 rows vs 4) and a lot in tall tabs (GitTab: ref
  16.5 rows vs ~23.5). Both use SliderRenderable's formula; opentui appears
  to size the thumb from a content height measured before layout settles
  (probed: CommitView content is ~29 rows, yet the ref thumb implies ~62).
  Track column, colour and thumb start are exact; text rows unaffected.
  Seen in ScrollBox.FileList, TasksPanel.LongPlan (≈4.5 vs 5.5 rows),
  Timeline.Running (ref rows 9–24 vs shim 2–25) and all four GitTab cells.
- Textarea height counts *visual* rows via a hidden mirror (soft wraps
  included), as opentui grows it; the mirror uses opentui's break points
  while the native textarea breaks only at spaces, so a draft right at a
  punctuation break may wrap one word differently inside the box.
- Not authorable statically (state reached only by input): per-segment tool
  expansion in a settled Timeline turn, the Composer's `$`/`/` skill popup.
  Timeline previews hand-build `TimelineEntry` rows — `model/thread.ts`
  `timeline()` needs a full ThreadState and isn't exported.
- Hand-written patches need correct `@@ -a,n +b,m @@` counts: opentui's
  `<diff>` rejects a miscounted hunk ("Error parsing diff") while the shim
  draws it anyway — only the reference catches this.
- **Accepted deviation (sub-cell shrink):** a short glyph `<text>` beside a
  word-wrapping `<text>` in a row (the side panel's `Empty` rows) shrinks by
  a fraction of a cell in CSS; Yoga sizes a wrapping text's basis from its
  measure function and rounds to whole cells. Result: the sentence starts up
  to half a cell off, and in AgentsTab.Empty one wrap point moves
  ("each a" / "thread you can open." vs opentui's "each a thread" / "you can
  open."). Exact parity would need Yoga itself in the browser
  (yoga-layout) instead of CSS flexbox — the one real fix if this matters.
- Rounded borders are drawn with a half-cell CSS radius; opentui's `╭╮╰╯`
  corners read rounder. Tab-strip gap lines (`─` glyphs over the border)
  look a touch thinner than the CSS border line. Positions are exact.
- Floor-card `[RENDER_BLANK]`/`[RENDER_THIN]` only while a component has no
  authored preview.

## Re-sync risks

- `react`/`react-dom` pins in `.ds-sync` must track the repo's `react`.
- Primitive `.d.ts` contracts are hand-written (`cfg.dtsPropsFor`) — a new
  opentui prop used by the TUI won't appear until added to the doc + config.
- The shim covers the opentui surface the TUI uses today (see
  `pkg/shim/`); a new intrinsic or hook import fails the Bun build loudly.
- Image-token extmarks in the Composer are not painted.
- Syntax highlighting depends on opentui internals being extractable
  (`treesitter-assets.ts` reads `defaultParserDescriptors` and the
  extension/basename filetype Maps out of `@opentui/core`'s compiled chunk,
  failing loudly if they move) and on `web-tree-sitter` matching opentui's
  pin (0.25.10).

## Re-sync recipe

1. Stage scripts (`cp -r <skill>/{package-*.mjs,resync.mjs,lib,storybook} .ds-sync/`),
   then in `.ds-sync`: `npm i esbuild ts-morph @types/react playwright@1.58.2 react@<repo react> react-dom@<same>`.
   `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules` (the source-kit fork imports ts-morph).
2. `bun .design-sync/pkg/build.ts` (the shimmed package build + tree-sitter assets — the driver does not run it).
3. Fetch the project's `_ds_sync.json` → `.design-sync/.cache/remote-sync.json`, then
   `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./.ds-sync/node_modules --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`.
3b. `bun .design-sync/pkg/ship-vendor.ts ./ds-bundle`, then recapture code-bearing components
   (`--components Code,Diff,Markdown,FileSection,DiffPanel,GitTab,Timeline,AnswerPanel,SideQuestionModal`).
4. For any preview the verdict lists as pending: `bun .design-sync/pkg/ref/ref.tsx <Name>` and compare against
   `ds-bundle/_screenshots/review/raw/<group>__<Name>__<Export>.png` before grading.
5. A new component in `src/tui` isn't picked up automatically: export it from `.design-sync/pkg/src/index.ts`,
   add a `docsMap` group stub entry and `overrides.<Name>.cardMode: "column"` in config, and author its preview.
