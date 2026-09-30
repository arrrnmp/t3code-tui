---
category: Primitives
---
opentui's `<text>`: one run of styled terminal text. `fg` is required in practice (the default is pure white, which Moxen never uses for body text); `bg` paints behind the glyphs only.

- Wraps at word boundaries by default (`wrapMode="word"`); `"none"` keeps one line (clip or `truncate()` it yourself); `"char"` breaks anywhere.
- `attributes` is opentui's `TextAttributes` bitmask: 1 bold, 2 dim, 4 italic, 8 underline, 32 inverse, 128 strikethrough — combine with `|`.
- Children are plain strings. Build fixed-width rows with the theme helpers: `truncate(value, width)`, `spread(left, right, width)`, `rule(width)`.
- Colour carries meaning: `COLOR.text` body, `COLOR.bright` emphasis, `COLOR.dim` meta, `COLOR.faint` hints, `COLOR.accent` focus/links, `COLOR.warn` / `COLOR.danger` / `COLOR.added` states.

## Props

```ts
interface TextProps {
  fg?: string;
  bg?: string;
  /** TextAttributes bitmask. */
  attributes?: number;
  wrapMode?: "word" | "char" | "none";
  content?: string;
  selectable?: boolean;
  style?: { width?: number | string; height?: number; flexGrow?: number; flexShrink?: number; marginTop?: number; marginLeft?: number; paddingLeft?: number };
  onMouseDown?: (event: unknown) => void;
  onMouseOver?: () => void; onMouseOut?: () => void;
  children?: React.ReactNode;
}
```

## Example

```jsx
<Box style={{ flexDirection: "row", columnGap: 1 }}>
  <Text fg={COLOR.bright} attributes={1}>Refactor the diff panel</Text>
  <Text fg={COLOR.dim}>· 4m ago</Text>
  <Text fg="#221503" bg="#df9f5f"> selected </Text>
</Box>
```
