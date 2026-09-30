/**
 * Replaces `@opentui/react/jsx-runtime` (the tsconfig's `jsxImportSource`):
 * every lowercase opentui intrinsic is routed to its DOM rendering in
 * `primitives.tsx`; components and fragments pass straight through to React.
 */
import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";
import { Box, Code, Diff, Fallback, Input, LineBreak, Link, makeSpan, Markdown, ScrollBox, Text, Textarea } from "./primitives.js";

const INTRINSICS: Record<string, unknown> = {
  box: Box,
  text: Text,
  scrollbox: ScrollBox,
  markdown: Markdown,
  code: Code,
  diff: Diff,
  input: Input,
  textarea: Textarea,
  span: makeSpan(0),
  b: makeSpan(1),
  strong: makeSpan(1),
  i: makeSpan(4),
  em: makeSpan(4),
  u: makeSpan(8),
  br: LineBreak,
  a: Link,
  select: Fallback,
  "tab-select": Fallback,
  "ascii-font": Fallback,
  "line-number": Fallback,
  image: Fallback,
};

const route = (type: unknown) => (typeof type === "string" ? (INTRINSICS[type] ?? type) : type);

export function jsx(type: unknown, props: unknown, key?: unknown) {
  return reactJsx(route(type) as never, props as never, key as never);
}
export function jsxs(type: unknown, props: unknown, key?: unknown) {
  return reactJsxs(route(type) as never, props as never, key as never);
}
export function jsxDEV(type: unknown, props: unknown, key?: unknown) {
  return reactJsx(route(type) as never, props as never, key as never);
}
export { Fragment };
