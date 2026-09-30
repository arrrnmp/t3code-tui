/**
 * Yoga-in-cells -> CSS. opentui lays every renderable out with Yoga on a
 * character grid: numbers are cells (columns horizontally, rows vertically),
 * the default flex direction is column, flexGrow defaults to 0, and
 * flexShrink defaults to 0 when a numeric width/height is set, else 1
 * (`setupYogaProperties` in @opentui/core). Yoga's min size is 0, so every
 * node gets `min-width/min-height: 0` to stop CSS's `auto` minimum from
 * refusing to shrink.
 */
import type { CSSProperties } from "react";

/** One column / one row, as CSS lengths. Set on `.mx-term` (see styles.css). */
export const CW = "var(--mx-cw)";
export const LH = "var(--mx-lh)";

type Axis = "x" | "y";
const unit = (axis: Axis) => (axis === "x" ? CW : LH);

export function cells(value: unknown, axis: Axis): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value === 0 ? "0" : `calc(${value} * ${unit(axis)})`;
  if (typeof value === "string") return value; // "100%", "auto", ...
  return undefined;
}

const LAYOUT_KEYS = [
  "flexDirection", "flexGrow", "flexShrink", "flexBasis", "flexWrap", "alignItems", "alignSelf", "alignContent",
  "justifyContent", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "position", "top", "left",
  "right", "bottom", "zIndex", "overflow", "margin", "marginX", "marginY", "marginTop", "marginBottom", "marginLeft",
  "marginRight", "padding", "paddingX", "paddingY", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "gap", "rowGap", "columnGap", "backgroundColor", "opacity", "visible",
] as const;

/** opentui accepts layout both as direct props and inside `style` — merge them (style wins). */
export function mergeLayout(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of LAYOUT_KEYS) if (props[key] !== undefined) out[key] = props[key];
  const style = props.style as Record<string, unknown> | undefined;
  if (style) for (const [k, v] of Object.entries(style)) if (v !== undefined) out[k] = v;
  return out;
}

export interface BorderSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export function borderSides(border: unknown): BorderSides {
  if (border === true) return { top: true, right: true, bottom: true, left: true };
  if (Array.isArray(border)) {
    return { top: border.includes("top"), right: border.includes("right"), bottom: border.includes("bottom"), left: border.includes("left") };
  }
  return { top: false, right: false, bottom: false, left: false };
}

const NONE: BorderSides = { top: false, right: false, bottom: false, left: false };

/** Layout props -> CSS. `sides` adds the one-cell inset a drawn border occupies. */
export function layoutCss(l: Record<string, unknown>, sides: BorderSides = NONE, defaults: { flexDirection?: string } = {}): CSSProperties {
  const css: CSSProperties = {
    display: l.visible === false ? "none" : "flex",
    flexDirection: ((l.flexDirection as string) ?? defaults.flexDirection ?? "column") as CSSProperties["flexDirection"],
    flexGrow: (l.flexGrow as number) ?? 0,
    flexShrink: (l.flexShrink as number) ?? (typeof l.width === "number" || typeof l.height === "number" ? 0 : 1),
    boxSizing: "border-box",
    minWidth: cells(l.minWidth, "x") ?? 0,
    minHeight: cells(l.minHeight, "y") ?? 0,
    position: (l.position as CSSProperties["position"]) ?? "relative",
  };
  const set = (k: keyof CSSProperties, v: unknown) => {
    if (v !== undefined) (css as Record<string, unknown>)[k] = v;
  };
  set("flexBasis", cells(l.flexBasis, "x"));
  set("flexWrap", l.flexWrap);
  set("alignItems", l.alignItems);
  set("alignSelf", l.alignSelf);
  set("alignContent", l.alignContent);
  set("justifyContent", l.justifyContent);
  set("width", cells(l.width, "x"));
  set("height", cells(l.height, "y"));
  set("maxWidth", cells(l.maxWidth, "x"));
  set("maxHeight", cells(l.maxHeight, "y"));
  set("top", cells(l.top, "y"));
  set("bottom", cells(l.bottom, "y"));
  set("left", cells(l.left, "x"));
  set("right", cells(l.right, "x"));
  set("zIndex", l.zIndex);
  if (l.overflow === "hidden" || l.overflow === "scroll") css.overflow = "hidden";
  set("backgroundColor", l.backgroundColor === "transparent" ? undefined : l.backgroundColor);
  set("opacity", l.opacity);

  const edge = (base: unknown, axisV: unknown, own: unknown) => (own ?? axisV ?? base) as number | string | undefined;
  set("marginTop", cells(edge(l.margin, l.marginY, l.marginTop), "y"));
  set("marginBottom", cells(edge(l.margin, l.marginY, l.marginBottom), "y"));
  set("marginLeft", cells(edge(l.margin, l.marginX, l.marginLeft), "x"));
  set("marginRight", cells(edge(l.margin, l.marginX, l.marginRight), "x"));

  set("paddingTop", cells(edge(l.padding, l.paddingY, l.paddingTop), "y"));
  set("paddingBottom", cells(edge(l.padding, l.paddingY, l.paddingBottom), "y"));
  set("paddingLeft", cells(edge(l.padding, l.paddingX, l.paddingLeft), "x"));
  set("paddingRight", cells(edge(l.padding, l.paddingX, l.paddingRight), "x"));
  // A drawn border occupies one full cell per side, like Yoga's border
  // edge: absolute children offset from inside it, as in opentui. The
  // line itself is painted over this transparent edge by `.mx-border`.
  if (sides.top || sides.right || sides.bottom || sides.left) {
    css.borderStyle = "solid";
    css.borderColor = "transparent";
    css.borderTopWidth = sides.top ? LH : 0;
    css.borderBottomWidth = sides.bottom ? LH : 0;
    css.borderLeftWidth = sides.left ? CW : 0;
    css.borderRightWidth = sides.right ? CW : 0;
  }

  set("rowGap", cells(l.rowGap ?? l.gap, "y"));
  set("columnGap", cells(l.columnGap ?? l.gap, "x"));
  return css;
}

/** opentui `TextAttributes` bits -> CSS. */
export function attributeCss(attributes: number | undefined): CSSProperties {
  const a = attributes ?? 0;
  const css: CSSProperties = {};
  if (a & 1) css.fontWeight = 700;
  if (a & 2) css.opacity = 0.6;
  if (a & 4) css.fontStyle = "italic";
  const lines: string[] = [];
  if (a & 8) lines.push("underline");
  if (a & 128) lines.push("line-through");
  if (lines.length) css.textDecoration = lines.join(" ");
  if (a & 64) css.visibility = "hidden";
  return css;
}
