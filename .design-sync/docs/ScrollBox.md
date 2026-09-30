---
category: Primitives
---
opentui's `<scrollbox>`: a vertically scrolling viewport. Give it a bounded height (`flexGrow: 1` inside a sized column, or a numeric `height`); its children stack in a column inside `contentOptions`' padding.

- `stickyScroll` + `stickyStart="bottom"` keeps a transcript pinned to its newest row; lists use `stickyStart="top"`.
- Moxen's scrollbar is thin, arrowless, and coloured through `verticalScrollbarOptions.trackOptions`.

## Props

```ts
interface ScrollBoxProps {
  style?: { flexGrow?: number; height?: number; width?: number | string; zIndex?: number };
  contentOptions?: { paddingLeft?: number; paddingRight?: number; paddingTop?: number; paddingBottom?: number };
  stickyScroll?: boolean;
  stickyStart?: "top" | "bottom";
  verticalScrollbarOptions?: { showArrows?: boolean; trackOptions?: { foregroundColor?: string; backgroundColor?: string } };
  backgroundColor?: string;
  children?: React.ReactNode;
}
```

## Example

```jsx
<ScrollBox style={{ flexGrow: 1 }} contentOptions={{ paddingRight: 1 }} stickyStart="top"
  verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: COLOR.dim, backgroundColor: SURFACE.border } }}>
  {rows.map((r) => <Text key={r} fg={COLOR.text}>{r}</Text>)}
</ScrollBox>
```
