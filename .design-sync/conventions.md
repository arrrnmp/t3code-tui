# Moxen TUI — how to build with it

Moxen is a **terminal** app. Every component here is the real TUI component, rendered on a character grid in the browser. Designs are terminal screens: monospace cells, box-drawing borders, no pixels, no images, no rounded cards, no shadows.

## Setup: always inside `<Terminal>`

Everything renders inside `Terminal` (it sets the monospace font, the cell grid and the base surface). Outside it, nothing lines up.

```jsx
const { Terminal, Box, Text, Sidebar, COLOR, SURFACE } = window.MoxenTUI;

<Terminal width={100} height={30}>
  <Box style={{ flexDirection: "row", flexGrow: 1 }}>{/* panes */}</Box>
</Terminal>
```

- **All numbers are cells.** `width: 36` = 36 columns; `height: 3` = 3 rows; `paddingLeft: 2` = two columns. Never px.
- Components take their size from props (`width`, `height`, `screenWidth`, `screenHeight`, `left`, `top`). Keep them consistent with the Terminal size. Modals (`PickerModal`, `SettingsModal`, `RenameModal`, `ModalShell`, …) get the full `screenWidth`/`screenHeight` and place themselves with `left`/`top`/`width`/`height`.
- Panes that fill the height (Sidebar, the chat pane, `SidePanelFrame`) must sit in a row parent: `<Box style={{ flexDirection: "row", flexGrow: 1 }}>`.

## Styling idiom: layout props + theme tokens, no CSS classes

There is no class vocabulary. Lay out with `Box` (a Yoga flexbox in cells) and write text with `Text`; colour only through the theme objects:

| Token | Use |
|---|---|
| `SURFACE.base` / `.panel` / `.raised` / `.hover` / `.border` / `.borderFocus` | app background → pane fill → modal/input fill → hover fill → borders → focused pane border |
| `COLOR.text` / `.bright` / `.dim` / `.faint` | body → emphasis → meta → hints |
| `COLOR.accent` / `.user` / `.agent` / `.warn` / `.danger` / `.added` / `.removed` / `.command` / `.tool` | focus & links, speaker colours, states, diff counts, commands |
| `STATUS_COLOR.running` / `.blocked` / `.active` / `.snoozed` / `.settled` | thread status glyphs |
| `DIFF_BG.added` / `.removed` / `.addedLineNumber` / `.removedLineNumber` | diff rows |
| `PICK_BG` / `PICK_FG` | the highlighted (selected) row in pickers and answer panels |

Rules that make it read as Moxen: chrome stays quiet (panes step a few lightness levels on one zinc hue); colour carries meaning, not decoration. Panes use `borderStyle="rounded"`, `borderColor={SURFACE.border}` (`SURFACE.borderFocus` when focused), and a `title=" Name "` in the top border. Fixed rows are `{ height: 1, flexShrink: 0 }`. Flex defaults are opentui's: `flexDirection` is **column**, `flexGrow` 0. Right-align meta with a spacer `<Box style={{ flexGrow: 1 }} />`. Chrome gets `selectable={false}`.

Text helpers for fixed-width rows: `truncate(value, width)`, `spread(left, right, width)`, `rule(width)`; the focus bar glyph `MARKER` (`▌`), spinners `SPINNER_FRAMES`. Markdown, `Code` and `Diff` always take `syntaxStyle={markdownSyntaxStyle()}`; `Code`/`Diff` also take a `filetype` (`"typescript"`, `"bash"`, `"python"`, …) and are syntax-highlighted with the TUI's own tree-sitter grammars; markdown fences highlight by their info string (```ts).

Data builders produce the exact shapes panes expect: `buildSidebarSections(shell, options)` → `Sidebar sections`; `groupTurns(entries)` → `Timeline groups`; `splitPatchByFile(patch)` → `PatchFile[]` for `DiffPanel` / `FileSection`.

## Where the truth lives

- `styles.css` → `_ds_bundle.css`: every token as a CSS variable (`--mx-surface-panel`, `--mx-color-accent`, …) and the cell size (`--mx-cw`, `--mx-lh`).
- Each component's `<Name>.prompt.md` and `<Name>.d.ts`: its props and working examples. The primitives' docs (`Box`, `Text`, `ScrollBox`, `Markdown`, `Diff`, `Input`, `Textarea`) list every layout prop.

## Example: a new pane in the Moxen idiom

```jsx
<Terminal width={60} height={10}>
  <Box style={{ flexDirection: "row", flexGrow: 1 }}>
    <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Checks " titleColor={COLOR.dim}
         backgroundColor={SURFACE.panel} style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
      {[["typecheck", "✓", COLOR.added], ["vitest", "●", COLOR.warn], ["render-check", "✗", COLOR.danger]].map(([name, glyph, color]) => (
        <Box key={name} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          <Text fg={COLOR.text}>{name}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text fg={color}>{glyph}</Text>
        </Box>
      ))}
    </Box>
  </Box>
</Terminal>
```
