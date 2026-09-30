---
category: Primitives
---
The root of every Moxen screen: a `width`×`height` grid of monospace cells on `SURFACE.base`. Everything Moxen draws is laid out in whole cells inside one of these — nothing renders correctly outside it (no cell font, no grid units).

- Numbers in every layout prop below it are **cells**: columns horizontally, rows vertically.
- Its children stack as a flex **column**. Panes that should fill the height go in a `Box` with `flexDirection: "row"` and `flexGrow: 1`, exactly as the app does.
- Components take their size from props (`width`, `screenWidth`, `screenHeight`, `height`). Keep those in step with the Terminal's own size.

## Props

```ts
interface TerminalProps {
  /** Columns. Default 120. */
  width?: number;
  /** Rows. Default 36. */
  height?: number;
  /** Fill behind the grid. Default SURFACE.base. */
  background?: string;
  children?: React.ReactNode;
}
```

## Example

```jsx
<Terminal width={100} height={30}>
  <Box style={{ flexDirection: "row", flexGrow: 1 }}>
    <Sidebar {...sidebarProps} width={36} height={30} screenWidth={100} />
    <Box style={{ flexGrow: 1 }}>{/* chat pane */}</Box>
  </Box>
</Terminal>
```
