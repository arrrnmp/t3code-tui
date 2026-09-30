---
category: Primitives
---
opentui's `<diff>`: a unified diff with a line-number gutter and added/removed row backgrounds. Moxen always colours it from `DIFF_BG` (`added`, `removed`, `addedLineNumber`, `removedLineNumber`). For a file-by-file view use `FileSection` / `DiffPanel`, which wrap this. Pass `filetype` (from the file's extension) and `syntaxStyle={markdownSyntaxStyle()}` and every line is highlighted with the TUI's tree-sitter grammars, exactly as in the terminal.

## Props

```ts
interface DiffProps {
  /** A unified diff (one file's hunks). */
  diff: string;
  view?: "unified" | "split";
  filetype?: string;
  syntaxStyle?: unknown;
  fg?: string;
  showLineNumbers?: boolean;
  wrapMode?: "word" | "char" | "none";
  addedBg?: string; removedBg?: string;
  addedContentBg?: string; removedContentBg?: string;
  addedLineNumberBg?: string; removedLineNumberBg?: string;
  lineNumberFg?: string;
}
```

## Example

```jsx
<Diff diff={patch} view="unified" fg={COLOR.text} showLineNumbers wrapMode="none"
  addedBg={DIFF_BG.added} removedBg={DIFF_BG.removed}
  addedContentBg={DIFF_BG.added} removedContentBg={DIFF_BG.removed}
  addedLineNumberBg={DIFF_BG.addedLineNumber} removedLineNumberBg={DIFF_BG.removedLineNumber}
  lineNumberFg={COLOR.dim} />
```
