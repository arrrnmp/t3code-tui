/** @jsxImportSource react */
/**
 * DOM renderings of the opentui intrinsics (`<box>`, `<text>`, `<scrollbox>`,
 * `<markdown>`, `<diff>`, `<code>`, `<input>`, `<textarea>` and the inline
 * text modifiers). Each takes the same props as its opentui counterpart, so
 * the TUI's own components render unmodified; `jsx-runtime.ts` routes the
 * lowercase intrinsics here.
 */
import {
  Children,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Lexer, type Token, type Tokens } from "marked";
import { attributeCss, borderSides, CW, LH, layoutCss, mergeLayout } from "./cells.js";
import { StyledText, SyntaxStyle, type StyleDef, type TextChunk } from "./opentui-core.js";
import { toKeyEvent } from "./opentui-react.js";
import { infoStringToFiletype, splitLines, useHighlight } from "./treesitter.js";

type AnyProps = Record<string, any>;

/* ---------------------------------------------------------------- mouse -- */

/** opentui mouse handlers get a MouseEvent with cell coordinates. */
function mouseHandlers(p: AnyProps) {
  const wrap = (fn: ((e: unknown) => void) | undefined) =>
    fn
      ? (e: React.MouseEvent) => {
          const target = e.currentTarget as HTMLElement;
          const cw = target.ownerDocument.defaultView?.getComputedStyle(target).getPropertyValue("--mx-cw-px");
          const px = Number.parseFloat(cw ?? "") || 8;
          fn({
            x: Math.floor(e.clientX / px),
            y: Math.floor(e.clientY / 17),
            button: e.button,
            type: e.type,
            stopPropagation: () => e.stopPropagation(),
            preventDefault: () => e.preventDefault(),
          });
          e.stopPropagation();
        }
      : undefined;
  return {
    onMouseDown: wrap(p.onMouseDown),
    onMouseUp: wrap(p.onMouseUp),
    onMouseEnter: wrap(p.onMouseOver),
    onMouseLeave: wrap(p.onMouseOut),
    onWheel: p.onMouseScroll
      ? (e: React.WheelEvent) => p.onMouseScroll({ scroll: { direction: e.deltaY > 0 ? "down" : "up", delta: 1 } })
      : undefined,
  };
}

const interactive = (p: AnyProps) => p.onMouseDown !== undefined || p.onMouseUp !== undefined;

/* ------------------------------------------------------------------ box -- */

const BORDER_WIDTH: Record<string, string> = { single: "1px solid", rounded: "1px solid", heavy: "2px solid", double: "3px double" };

export function Box(p: AnyProps) {
  const layout = mergeLayout(p);
  const hasBorder = p.border ?? (p.borderStyle || p.borderColor || p.focusedBorderColor ? true : false);
  const sides = borderSides(hasBorder);
  const css = layoutCss(layout, sides);
  const bg = layout.backgroundColor as string | undefined;
  if (bg && bg !== "transparent") (css as AnyProps)["--mx-bg"] = bg;
  if (p.selectable === false) css.userSelect = "none";
  if (interactive(p)) css.cursor = "pointer";
  const style = (p.borderStyle as string) ?? "single";
  const color = (p.focused && p.focusedBorderColor) || p.borderColor || "#FFFFFF";
  const drawn = sides.top || sides.right || sides.bottom || sides.left;
  const half = (axis: "x" | "y") => `calc(${axis === "x" ? CW : LH} / 2)`;
  return (
    <div className="mx-box" data-mx-id={p.id} style={css} {...mouseHandlers(p)}>
      {drawn ? (
        <div
          aria-hidden
          className="mx-border"
          style={{
            // Negative: reach from the padding box back into the border cell's centre line.
            top: sides.top ? `calc(-1 * ${half("y")})` : 0,
            bottom: sides.bottom ? `calc(-1 * ${half("y")})` : 0,
            left: sides.left ? `calc(-1 * ${half("x")})` : 0,
            right: sides.right ? `calc(-1 * ${half("x")})` : 0,
            borderTop: sides.top ? `${BORDER_WIDTH[style] ?? "1px solid"} ${color}` : "none",
            borderBottom: sides.bottom ? `${BORDER_WIDTH[style] ?? "1px solid"} ${color}` : "none",
            borderLeft: sides.left ? `${BORDER_WIDTH[style] ?? "1px solid"} ${color}` : "none",
            borderRight: sides.right ? `${BORDER_WIDTH[style] ?? "1px solid"} ${color}` : "none",
            borderRadius: style === "rounded" ? `${half("x")}` : 0,
          }}
        />
      ) : null}
      {drawn && p.title ? <BorderTitle text={p.title} color={p.titleColor ?? color} align={p.titleAlignment} edge="top" /> : null}
      {drawn && p.bottomTitle ? (
        <BorderTitle text={p.bottomTitle} color={p.bottomTitleColor ?? p.titleColor ?? color} align={p.bottomTitleAlignment} edge="bottom" />
      ) : null}
      {p.children}
    </div>
  );
}

function BorderTitle({ text, color, align, edge }: { text: ReactNode; color: string; align?: string; edge: "top" | "bottom" }) {
  const pos: CSSProperties = align === "center" ? { left: "50%", transform: "translateX(-50%)" } : align === "right" ? { right: CW } : { left: CW };
  return (
    <span className="mx-border-title" style={{ [edge]: `calc(-1 * ${LH})`, color, ...pos }}>
      {renderContent(text)}
    </span>
  );
}

/* ----------------------------------------------------------------- text -- */

function chunkNode(c: TextChunk, key: number, wrap = false) {
  return (
    <span key={key} style={{ color: c.fg, background: c.bg, ...attributeCss(c.attributes) }}>
      {wrap ? breakable(c.text) : c.text}
    </span>
  );
}

/**
 * opentui's word wrapper (`isAsciiWrapBreak`, native utf8.zig) breaks after
 * `- / \ . , ; : ! ? ( ) [ ] { }` and at any Unicode space incl. NBSP, not
 * only at ASCII spaces as CSS does. A `<wbr>` after each restores those
 * break points without changing the copied text.
 */
const WRAP_BREAK = /([-/\\.,;:!?()[\]{}\u00a0])/;
export function breakable(text: string): ReactNode {
  const parts = text.split(WRAP_BREAK);
  if (parts.length === 1) return text;
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (!part) return;
    out.push(part);
    if (i % 2 === 1) out.push(<wbr key={i} />);
  });
  return out;
}

/** Strings, numbers, StyledText (`t\`...\``), chunk objects and nested span elements. */
export function renderContent(value: unknown, wrap = false): ReactNode {
  if (value === null || value === undefined || value === false || value === true) return null;
  if (value instanceof StyledText) return value.chunks.map((c, i) => chunkNode(c, i, wrap));
  if (typeof value === "object" && (value as TextChunk).__isChunk) return chunkNode(value as TextChunk, 0, wrap);
  if (Array.isArray(value)) return value.map((v, i) => <InlineKey key={i}>{renderContent(v, wrap)}</InlineKey>);
  if (wrap && (typeof value === "string" || typeof value === "number")) return breakable(String(value));
  return value as ReactNode;
}

function InlineKey({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const WRAP: Record<string, CSSProperties> = {
  word: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  char: { whiteSpace: "pre-wrap", wordBreak: "break-all" },
  none: { whiteSpace: "pre" },
};

export function Text(p: AnyProps) {
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  css.display = layout.visible === false ? "none" : "block";
  css.overflow = "hidden";
  Object.assign(css, WRAP[(p.wrapMode as string) ?? "word"] ?? WRAP.word);
  if (p.truncate) Object.assign(css, { whiteSpace: "pre", textOverflow: "ellipsis" });
  if (p.selectable === false) css.userSelect = "none";
  if (interactive(p)) css.cursor = "pointer";
  delete css.backgroundColor;
  const inverse = ((p.attributes ?? 0) & 32) !== 0;
  const fg = inverse ? p.bg : p.fg;
  const bg = inverse ? (p.fg ?? "#FFFFFF") : (p.bg ?? layout.backgroundColor);
  return (
    <div className="mx-text" style={css} {...mouseHandlers(p)}>
      <span style={{ color: fg ?? "#FFFFFF", background: bg === "transparent" ? undefined : bg, ...attributeCss(p.attributes) }}>
        {renderContent(p.content ?? p.children, (p.wrapMode ?? "word") === "word" && !p.truncate)}
      </span>
    </div>
  );
}

/** `<span>`, `<b>`, `<i>`, `<u>`, `<strong>`, `<em>` inside a `<text>`. */
export function makeSpan(bit: number) {
  return function Span(p: AnyProps) {
    return (
      <span style={{ color: p.fg, background: p.bg, ...attributeCss((p.attributes ?? 0) | bit) }} {...mouseHandlers(p)}>
        {renderContent(p.content ?? p.children)}
      </span>
    );
  };
}

export function LineBreak() {
  return <br />;
}

export function Link(p: AnyProps) {
  return (
    <a href={p.href} style={{ color: p.fg ?? "inherit" }}>
      {renderContent(p.children)}
    </a>
  );
}

/* ------------------------------------------------------------ scrollbox -- */

export function ScrollBox(p: AnyProps) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  css.overflow = "hidden";
  const content = (p.contentOptions ?? {}) as AnyProps;
  const contentCss = layoutCss({ flexShrink: 0, ...mergeLayout(content) });
  const track = (p.verticalScrollbarOptions?.trackOptions ?? {}) as AnyProps;
  const px = () => (outer.current ? Number.parseFloat(getComputedStyle(outer.current).getPropertyValue("--mx-lh-px")) : 0) || 18;

  useImperativeHandle(p.ref, () => {
    const el = () => outer.current?.querySelector<HTMLDivElement>(":scope > .mx-scroll-viewport");
    return {
      get scrollTop() {
        return Math.round((el()?.scrollTop ?? 0) / px());
      },
      set scrollTop(v: number) {
        const e = el();
        if (e) e.scrollTop = v * px();
      },
      get scrollHeight() {
        return Math.round((el()?.scrollHeight ?? 0) / px());
      },
      get viewport() {
        const e = el();
        return { height: Math.round((e?.clientHeight ?? 0) / px()), width: 0 };
      },
      scrollTo(pos: number | { x?: number; y?: number }) {
        const y = typeof pos === "number" ? pos : (pos.y ?? 0);
        el()?.scrollTo({ top: y * px() });
      },
      scrollBy(delta: number | { x?: number; y?: number }) {
        const y = typeof delta === "number" ? delta : (delta.y ?? 0);
        el()?.scrollBy({ top: y * px() });
      },
      scrollChildIntoView(id: string) {
        el()?.querySelector(`[data-mx-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
      },
      content: inner.current,
    };
  });

  // stickyScroll + stickyStart="bottom": stay pinned to the end as content grows.
  useLayoutEffect(() => {
    if (!p.stickyScroll && p.stickyStart !== "bottom") return;
    const viewport = outer.current?.querySelector<HTMLDivElement>(".mx-scroll-viewport");
    if (viewport && p.stickyStart === "bottom") viewport.scrollTop = viewport.scrollHeight;
  });

  // opentui's vertical scrollbar: a one-column track, shown only while the
  // content overflows, with a thumb sized in half-cells like SliderRenderable
  // (size = floor(2·track·viewport/content), start ∝ scroll offset).
  const [bar, setBar] = useState<{ start: number; size: number } | null>(null);
  const measure = () => {
    const vp = outer.current?.querySelector<HTMLDivElement>(".mx-scroll-viewport");
    if (!vp) return;
    const row = px();
    const view = Math.round(vp.clientHeight / row);
    const content = Math.round(vp.scrollHeight / row);
    if (content <= view || view <= 0) {
      setBar((b) => (b === null ? b : null));
      return;
    }
    const track = view * 2;
    const size = Math.max(1, Math.min(track, Math.floor(track * (view / content))));
    const range = content - view;
    const start = Math.round((Math.round(vp.scrollTop / row) / range) * (track - size));
    setBar((b) => (b && b.start === start && b.size === size ? b : { start, size }));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const vp = outer.current?.querySelector<HTMLDivElement>(".mx-scroll-viewport");
    if (!vp || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  const rowCss: CSSProperties = { ...css, flexDirection: "row" };
  return (
    <div ref={outer} className="mx-box" style={rowCss} {...mouseHandlers(p)}>
      <div
        className="mx-scroll-viewport"
        onScroll={measure}
        style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none" }}
      >
        <div ref={inner} className="mx-box" style={contentCss}>
          {p.children}
        </div>
      </div>
      {bar ? (
        <div aria-hidden style={{ position: "relative", width: CW, flexShrink: 0, background: track.backgroundColor ?? "transparent" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `calc(${bar.start / 2} * ${LH})`,
              height: `calc(${bar.size / 2} * ${LH})`,
              background: track.foregroundColor ?? "var(--mx-color-dim)",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- markdown -- */

function styleCss(s: StyleDef | undefined): CSSProperties {
  if (!s) return {};
  return {
    color: s.fg,
    background: s.bg,
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? "italic" : undefined,
    textDecoration: s.underline ? "underline" : undefined,
    opacity: s.dim ? 0.6 : undefined,
  };
}

function inline(tokens: Token[] | undefined, ss: SyntaxStyle | undefined): ReactNode {
  if (!tokens) return null;
  const g = (name: string) => styleCss(ss?.getStyle(name));
  return tokens.map((tok, i) => {
    switch (tok.type) {
      case "strong":
        return <span key={i} style={g("markup.strong")}>{inline((tok as Tokens.Strong).tokens, ss)}</span>;
      case "em":
        return <span key={i} style={g("markup.italic")}>{inline((tok as Tokens.Em).tokens, ss)}</span>;
      case "del":
        return <span key={i} style={{ ...g("markup.strikethrough"), textDecoration: "line-through" }}>{inline((tok as Tokens.Del).tokens, ss)}</span>;
      case "codespan":
        return <span key={i} style={g("markup.raw")}>{(tok as Tokens.Codespan).text}</span>;
      case "link":
        return <span key={i} style={g("markup.link.label")}>{inline((tok as Tokens.Link).tokens, ss)}</span>;
      case "br":
        return <br key={i} />;
      case "text": {
        const t = tok as Tokens.Text;
        return <span key={i}>{t.tokens ? inline(t.tokens, ss) : breakable(t.text)}</span>;
      }
      default:
        return <span key={i}>{"text" in tok ? (tok as { text: string }).text : tok.raw}</span>;
    }
  });
}

function block(tok: Token, i: number, ss: SyntaxStyle | undefined): ReactNode {
  const g = (name: string) => styleCss(ss?.getStyle(name));
  switch (tok.type) {
    case "heading": {
      const h = tok as Tokens.Heading;
      return <div key={i} style={g(`markup.heading.${h.depth}`)}>{inline(h.tokens, ss)}</div>;
    }
    case "paragraph":
      return <div key={i}>{inline((tok as Tokens.Paragraph).tokens, ss)}</div>;
    case "code": {
      // opentui renders fences through a CodeRenderable: highlighted by the
      // info string's filetype, conceal off, plain `fg` when there is none.
      const code = tok as Tokens.Code;
      return <CodeBlock key={i} content={code.text} filetype={code.lang ? infoStringToFiletype(code.lang) : undefined} syntaxStyle={ss} />;
    }
    case "blockquote":
      return (
        <div key={i} style={{ ...g("markup.quote"), display: "flex" }}>
          <span style={{ ...g("conceal"), fontStyle: "normal", whiteSpace: "pre", flexShrink: 0 }}>{"│ "}</span>
          <div>{(tok as Tokens.Blockquote).tokens.map((t, j) => block(t, j, ss))}</div>
        </div>
      );
    case "list": {
      const l = tok as Tokens.List;
      return (
        <div key={i}>
          {l.items.map((item, j) => {
            // "- " (or "1. ") takes markup.list; a task's "[x] "/"[ ] " takes checked/unchecked.
            const marker = l.ordered ? `${Number(l.start || 1) + j}. ` : "- ";
            const box = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
            return (
              <div key={j} style={{ display: "flex" }}>
                <span style={{ ...g("markup.list"), whiteSpace: "pre", flexShrink: 0 }}>{marker}</span>
                {box ? <span style={{ ...g(item.checked ? "markup.list.checked" : "markup.list.unchecked"), whiteSpace: "pre", flexShrink: 0 }}>{box}</span> : null}
                <div style={{ minWidth: 0 }}>
                  {item.tokens
                    .filter((t) => t.type !== "checkbox")
                    .map((t, k) => (t.type === "text" ? <div key={k}>{inline((t as Tokens.Text).tokens ?? [t], ss)}</div> : block(t, k, ss)))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    case "hr":
      return <div key={i} style={{ ...g("punctuation.special"), overflow: "hidden", whiteSpace: "pre" }}>{"─".repeat(200)}</div>;
    case "table": {
      const tb = tok as Tokens.Table;
      const cell = { padding: `0 ${CW}`, borderRight: "1px solid var(--mx-color-rule)", textAlign: "left" as const, fontWeight: "inherit" };
      return (
        <table key={i} style={{ borderCollapse: "collapse", border: "1px solid var(--mx-color-rule)" }}>
          <thead>
            <tr style={g("markup.strong")}>{tb.header.map((h, j) => <th key={j} style={cell}>{inline(h.tokens, ss)}</th>)}</tr>
          </thead>
          <tbody>
            {tb.rows.map((r, j) => (
              <tr key={j}>{r.map((c, k) => <td key={k} style={cell}>{inline(c.tokens, ss)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "space":
      return null;
    default:
      return <div key={i}>{tok.raw}</div>;
  }
}

export function Markdown(p: AnyProps) {
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  css.display = "flex";
  css.rowGap = LH;
  const tokens = useMemo(() => {
    try {
      return new Lexer({ gfm: true }).lex(String(p.content ?? ""));
    } catch {
      return [] as Token[];
    }
  }, [p.content]);
  const ss = p.syntaxStyle as SyntaxStyle | undefined;
  return (
    <div className="mx-markdown" style={{ ...css, color: p.fg ?? ss?.getStyle("default")?.fg, whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: p.selectable === false ? "none" : undefined }}>
      {tokens.map((t, i) => block(t, i, ss)).filter((n) => n !== null)}
    </div>
  );
}

function CodeBlock({ content, filetype, syntaxStyle }: { content: string; filetype: string | undefined; syntaxStyle: SyntaxStyle | undefined }) {
  const chunks = useHighlight(content, filetype, syntaxStyle, false);
  return <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{chunks ? chunks.map((c, i) => chunkNode(c, i)) : content}</div>;
}

/* ----------------------------------------------------------------- code -- */

export function Code(p: AnyProps) {
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  css.display = "block";
  Object.assign(css, WRAP[(p.wrapMode as string) ?? "none"] ?? WRAP.none);
  const ss = p.syntaxStyle as SyntaxStyle | undefined;
  const content = String(p.content ?? "");
  const chunks = useHighlight(content, p.filetype, ss, p.conceal ?? true);
  const wrap = (p.wrapMode ?? "none") !== "none";
  return (
    <div className="mx-code" style={{ ...css, color: p.fg, overflow: "hidden" }}>
      {chunks ? chunks.map((c, i) => chunkNode(c, i, wrap)) : wrap ? breakable(content) : content}
    </div>
  );
}

/* ----------------------------------------------------------------- diff -- */

interface DiffRow {
  kind: "add" | "del" | "ctx" | "hunk";
  oldNo?: number;
  newNo?: number;
  text: string;
}

function parseUnified(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") || line.startsWith("index ")) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      if (rows.length) rows.push({ kind: "hunk", text: "" });
      continue;
    }
    if (line.startsWith("+")) rows.push({ kind: "add", newNo: newNo++, text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    else if (line === "\\ No newline at end of file") continue;
  }
  return rows;
}

export function Diff(p: AnyProps) {
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  const rows = useMemo(() => parseUnified(String(p.diff ?? "")), [p.diff]);
  const width = String(Math.max(...rows.map((r) => r.newNo ?? r.oldNo ?? 0), 1)).length;
  const wrap = WRAP[(p.wrapMode as string) ?? "none"] ?? WRAP.none;
  // Like opentui's unified view: every displayed line joined and highlighted
  // as one CodeRenderable (conceal off by default), then split back per row.
  const lines = useMemo(() => rows.filter((r) => r.kind !== "hunk").map((r) => r.text).join("\n"), [rows]);
  const chunks = useHighlight(lines, p.filetype, p.syntaxStyle as SyntaxStyle | undefined, p.conceal ?? false);
  const lineChunks = useMemo(() => (chunks ? splitLines(chunks) : null), [chunks]);
  let lineIndex = 0;
  return (
    <div className="mx-diff" style={{ ...css, color: p.fg }}>
      {rows.map((r, i) => {
        if (r.kind === "hunk") return <div key={i} style={{ height: LH }} />;
        const bgContent = r.kind === "add" ? (p.addedContentBg ?? p.addedBg) : r.kind === "del" ? (p.removedContentBg ?? p.removedBg) : p.contextBg;
        const bgNo = r.kind === "add" ? (p.addedLineNumberBg ?? p.addedBg) : r.kind === "del" ? (p.removedLineNumberBg ?? p.removedBg) : p.lineNumberBg;
        const sign = r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
        // DiffRenderable's own sign defaults (not theme tokens): #22c55e / #ef4444.
        const signColor = r.kind === "add" ? (p.addedSignColor ?? "#22c55e") : r.kind === "del" ? (p.removedSignColor ?? "#ef4444") : undefined;
        return (
          <div key={i} style={{ display: "flex", flexDirection: "row" }}>
            {p.showLineNumbers !== false ? (
              <span style={{ background: bgNo, color: p.lineNumberFg ?? "var(--mx-color-dim)", whiteSpace: "pre", flexShrink: 0 }}>
                {` ${String(r.newNo ?? r.oldNo ?? "").padStart(width)} `}
              </span>
            ) : null}
            <span style={{ background: bgContent, color: signColor, whiteSpace: "pre", flexShrink: 0 }}>{`${sign} `}</span>
            <span style={{ background: bgContent, flexGrow: 1, minWidth: 0, ...wrap, overflow: "hidden" }}>
              {(() => {
                const styled = lineChunks?.[lineIndex++];
                if (styled) return styled.map((c, k) => chunkNode(c, k, p.wrapMode === "word"));
                return p.wrapMode === "word" ? breakable(r.text) : r.text;
              })()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- input -- */

export function Input(p: AnyProps) {
  const [value, setValue] = useState<string>(p.value ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(p.value ?? ""), [p.value]);
  useEffect(() => {
    if (p.focused) ref.current?.focus({ preventScroll: true });
  }, [p.focused]);
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  const focused = !!p.focused;
  return (
    <input
      ref={ref}
      className="mx-input"
      value={value}
      maxLength={p.maxLength}
      placeholder={typeof p.placeholder === "string" ? p.placeholder : undefined}
      style={{
        ...css,
        display: "block",
        height: css.height ?? LH,
        color: (focused ? p.focusedTextColor : undefined) ?? p.textColor,
        background: (focused ? p.focusedBackgroundColor : undefined) ?? p.backgroundColor ?? "transparent",
        ["--mx-placeholder" as string]: p.placeholderColor ?? "var(--mx-color-faint)",
      }}
      onChange={(e) => {
        setValue(e.target.value);
        p.onInput?.(e.target.value);
        p.onChange?.(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") p.onSubmit?.(value);
      }}
    />
  );
}

/* ------------------------------------------------------------- textarea -- */

export function Textarea(p: AnyProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setTextState] = useState<string>(p.initialValue ?? "");
  const layout = mergeLayout(p);
  const css = layoutCss(layout);
  const minRows = typeof layout.minHeight === "number" ? layout.minHeight : 1;
  const maxRows = typeof layout.maxHeight === "number" ? layout.maxHeight : Number.POSITIVE_INFINITY;
  // opentui grows the textarea by *visual* rows (soft wraps included): count
  // them with a hidden mirror of the text at the same width.
  const mirror = useRef<HTMLDivElement>(null);
  const [visualRows, setVisualRows] = useState(() => text.split("\n").length);
  useLayoutEffect(() => {
    const m = mirror.current;
    if (!m) return;
    const lh = Number.parseFloat(getComputedStyle(m).lineHeight) || 18;
    const next = Math.max(1, Math.round(m.offsetHeight / lh));
    if (next !== visualRows) setVisualRows(next);
  });
  const rows = Math.min(maxRows, Math.max(minRows, visualRows));
  const focused = !!p.focused;

  useEffect(() => {
    if (p.focused) ref.current?.focus({ preventScroll: true });
  }, [p.focused]);

  useImperativeHandle(p.ref, () => {
    const el = () => ref.current;
    const set = (v: string) => {
      const e = el();
      if (e) e.value = v;
      setTextState(v);
      p.onContentChange?.();
    };
    const marks = new Map<number, unknown>();
    let nextMark = 1;
    return {
      get plainText() {
        return el()?.value ?? "";
      },
      get cursorOffset() {
        return el()?.selectionStart ?? 0;
      },
      set cursorOffset(v: number) {
        el()?.setSelectionRange(v, v);
      },
      get scrollY() {
        return 0;
      },
      get lineInfo() {
        const lines = (el()?.value ?? "").split("\n");
        let col = 0;
        return { lineStartCols: lines.map((l) => { const s = col; col += l.length + 1; return s; }) };
      },
      setText: set,
      insertText(v: string) {
        const e = el();
        if (!e) return;
        const s = e.selectionStart;
        set(e.value.slice(0, s) + v + e.value.slice(e.selectionEnd));
        e.setSelectionRange(s + v.length, s + v.length);
      },
      clear: () => set(""),
      focus: () => el()?.focus(),
      blur: () => el()?.blur(),
      extmarks: {
        registerType: () => 1,
        create: (m: unknown) => { const id = nextMark++; marks.set(id, m); return id; },
        delete: (id: number) => marks.delete(id),
        clear: () => marks.clear(),
        get: (id: number) => marks.get(id),
        getAll: () => [...marks.values()],
      },
    };
  });

  const placeholder = p.placeholder;
  return (
    <div className="mx-box" style={{ ...css, height: `calc(${rows} * ${LH})`, maxHeight: undefined, minHeight: undefined, background: layout.backgroundColor as string }}>
      {text === "" && placeholder ? (
        <div aria-hidden className="mx-text" style={{ position: "absolute", inset: 0, pointerEvents: "none", color: p.placeholderColor, whiteSpace: "pre-wrap" }}>
          {renderContent(placeholder)}
        </div>
      ) : null}
      <div
        ref={mirror}
        aria-hidden
        style={{ position: "absolute", left: 0, right: 0, top: 0, visibility: "hidden", pointerEvents: "none", whiteSpace: p.wrapMode === "none" ? "pre" : "pre-wrap", overflowWrap: "anywhere" }}
      >
        {breakable(text) }{"\u200b"}
      </div>
      <textarea
        ref={ref}
        className="mx-textarea"
        defaultValue={p.initialValue}
        style={{
          color: (focused ? p.focusedTextColor : undefined) ?? p.textColor,
          background: "transparent",
          whiteSpace: p.wrapMode === "none" ? "pre" : "pre-wrap",
        }}
        onChange={(e) => {
          setTextState(e.target.value);
          p.onContentChange?.();
        }}
        onKeyDown={(e) => {
          const ev = toKeyEvent(e.nativeEvent);
          p.onKeyDown?.(ev);
          if (ev.defaultPrevented) return;
          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            p.onSubmit?.();
          }
        }}
        onPaste={(e) => {
          if (!p.onPaste) return;
          let prevented = false;
          p.onPaste({ bytes: new TextEncoder().encode(e.clipboardData.getData("text")), preventDefault: () => { prevented = true; } });
          if (prevented) e.preventDefault();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------ everything else -- */

/** `<select>`, `<tab-select>`, `<ascii-font>`, ... — rendered as a plain box so layout survives. */
export function Fallback(p: AnyProps) {
  return <Box {...p}>{Children.toArray(p.children).filter(isValidElement)}</Box>;
}
