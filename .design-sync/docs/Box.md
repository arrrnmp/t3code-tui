---
category: Primitives
---
opentui's `<box>`: a Yoga flex container measured in cells. It is the only layout primitive — there are no CSS classes; all layout goes through `style` (or the same keys as direct props).

Layout rules (opentui's, not the web's):
- `flexDirection` defaults to **"column"**. `flexGrow` defaults to 0.
- `flexShrink` defaults to 0 when a numeric `width`/`height` is set, otherwise 1. Rows of fixed height are written `{ height: 1, flexShrink: 0 }`.
- All lengths are cells: `width: 20` is 20 columns, `height: 3` is 3 rows, `paddingLeft: 2` is two columns. Strings like `"100%"` pass through.
- A border (`border`, or any of `borderStyle` / `borderColor`) takes one full cell on each bordered side. `title` sits in the top border line.
- `position: "absolute"` offsets from just inside the border.

Colour comes from the theme: `backgroundColor={SURFACE.panel}`, `borderColor={SURFACE.border}`, focused pane `borderColor={SURFACE.borderFocus}`.

## Props

```ts
interface BoxProps {
  style?: {
    flexDirection?: "column" | "row" | "column-reverse" | "row-reverse";
    flexGrow?: number; flexShrink?: number; flexBasis?: number | string; flexWrap?: "wrap" | "no-wrap";
    alignItems?: "flex-start" | "center" | "flex-end" | "stretch"; alignSelf?: string;
    justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
    width?: number | string; height?: number | string; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number;
    padding?: number; paddingX?: number; paddingY?: number; paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number;
    margin?: number; marginX?: number; marginY?: number; marginTop?: number; marginRight?: number; marginBottom?: number; marginLeft?: number;
    gap?: number; rowGap?: number; columnGap?: number;
    position?: "relative" | "absolute"; top?: number; left?: number; right?: number; bottom?: number; zIndex?: number;
    overflow?: "visible" | "hidden"; backgroundColor?: string;
  };
  backgroundColor?: string;
  /** true for all four sides, or a list of sides. */
  border?: boolean | ("top" | "right" | "bottom" | "left")[];
  borderStyle?: "single" | "rounded" | "double" | "heavy";
  borderColor?: string;
  title?: string; titleColor?: string; titleAlignment?: "left" | "center" | "right";
  bottomTitle?: string; bottomTitleAlignment?: "left" | "center" | "right";
  opacity?: number;
  /** Chrome sets selectable={false}; only readable text stays selectable. */
  selectable?: boolean;
  onMouseDown?: (event: unknown) => void; onMouseUp?: (event: unknown) => void;
  onMouseOver?: () => void; onMouseOut?: () => void;
  id?: string;
  children?: React.ReactNode;
}
```

## Example

```jsx
<Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Threads " titleColor={COLOR.dim}
     backgroundColor={SURFACE.panel} style={{ width: 36, flexDirection: "column" }}>
  <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
    <Text fg={COLOR.text}>Fix the CI flake</Text>
    <Box style={{ flexGrow: 1 }} />
    <Text fg={COLOR.dim}>2m</Text>
  </Box>
</Box>
```
