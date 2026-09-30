---
category: Primitives
---
opentui's `<code>`: a block of source text, syntax-highlighted with the TUI's own tree-sitter grammars and `CODE_SYNTAX_TOKENS` palette. Give it a `filetype` (`"typescript"`, `"bash"`, `"python"`, `"rust"`, `"json"`, …; aliases like `"ts"`/`"sh"` work) and `syntaxStyle={markdownSyntaxStyle()}`. Unknown filetypes fall back to plain `fg`. Grammars load on demand, so the first paint is plain text for a moment.

## Props

```ts
interface CodeProps {
  content: string;
  filetype?: string;
  /** markdownSyntaxStyle() */
  syntaxStyle?: unknown;
  fg?: string;
  wrapMode?: "word" | "char" | "none";
  style?: { flexGrow?: number; width?: number | string; height?: number };
}
```

## Example

```jsx
<Code content={"bun run check\nbun src/tui/render-check.tsx"} filetype="bash" syntaxStyle={markdownSyntaxStyle()} fg={COLOR.command} />
```
