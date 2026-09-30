---
category: Primitives
---
opentui's `<markdown>`: renders a markdown string (headings, lists, task lists, quotes, code, tables) in the TUI's palette. Always pass `syntaxStyle={markdownSyntaxStyle()}` — it carries Moxen's heading/list/code colours; without it everything paints one colour. Markers are concealed (no `#`, `**`), as in the terminal. Blocks are separated by one blank row.

## Props

```ts
interface MarkdownProps {
  content: string;
  /** markdownSyntaxStyle() */
  syntaxStyle: unknown;
  fg?: string;
  streaming?: boolean;
  selectable?: boolean;
  style?: { flexGrow?: number; width?: number | string; marginTop?: number };
}
```

## Example

```jsx
<Markdown content={"## Plan\n\n1. Split `DiffPanel` into sections\n2. Add a **Git** tab\n\n- [x] tests pass"}
  syntaxStyle={markdownSyntaxStyle()} fg={COLOR.text} />
```
