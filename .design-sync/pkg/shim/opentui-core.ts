/**
 * Browser stand-in for the parts of `@opentui/core` the TUI imports at
 * value level. Only the surface the components touch is here; the native
 * renderer, tree-sitter and clipboard never run in a browser.
 */

export const TextAttributes = {
  NONE: 0,
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  INVERSE: 1 << 5,
  HIDDEN: 1 << 6,
  STRIKETHROUGH: 1 << 7,
} as const;

export interface StyleDef {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

/** Keeps the style table so `<markdown>`/`<code>`/`<diff>` can paint with the TUI's own palette. */
export class SyntaxStyle {
  readonly styles: Record<string, StyleDef>;
  private ids = new Map<string, number>();
  private constructor(styles: Record<string, StyleDef>) {
    this.styles = { ...styles };
    Object.keys(this.styles).forEach((name, i) => this.ids.set(name, i + 1));
  }
  static create(): SyntaxStyle {
    return new SyntaxStyle({});
  }
  static fromStyles(styles: Record<string, StyleDef>): SyntaxStyle {
    return new SyntaxStyle(styles);
  }
  /** Resolves `markup.heading.3` -> `markup.heading.3` | first dot-segment, like the renderable's fallback. */
  getStyle(name: string): StyleDef | undefined {
    return this.styles[name] ?? this.styles[name.split(".")[0] ?? ""];
  }
  getStyleId(name: string): number | null {
    return this.ids.get(name) ?? null;
  }
  registerStyle(name: string, style: StyleDef): number {
    this.styles[name] = style;
    const id = this.ids.size + 1;
    this.ids.set(name, id);
    return id;
  }
  destroy(): void {}
}

export class RGBA {
  constructor(public r: number, public g: number, public b: number, public a: number) {}
  static fromValues(r: number, g: number, b: number, a = 1): RGBA {
    return new RGBA(r, g, b, a);
  }
  static fromInts(r: number, g: number, b: number, a = 255): RGBA {
    return new RGBA(r / 255, g / 255, b / 255, a / 255);
  }
  static fromHex(hex: string): RGBA {
    const h = hex.replace("#", "");
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return new RGBA(n(0), n(2), n(4), h.length >= 8 ? n(6) : 1);
  }
  toString(): string {
    return `rgba(${Math.round(this.r * 255)},${Math.round(this.g * 255)},${Math.round(this.b * 255)},${this.a})`;
  }
}

export function parseColor(value: string | RGBA): RGBA {
  return typeof value === "string" ? RGBA.fromHex(value) : value;
}

/* ---- StyledText: the `t\`...\`` template and its fg()/bg()/italic() chunk helpers ---- */

export interface TextChunk {
  __isChunk: true;
  text: string;
  fg?: string | undefined;
  bg?: string | undefined;
  attributes?: number | undefined;
}

export class StyledText {
  constructor(public chunks: TextChunk[]) {}
  toString(): string {
    return this.chunks.map((c) => c.text).join("");
  }
}

type ChunkInput = string | number | TextChunk;
const toChunk = (v: ChunkInput): TextChunk => (typeof v === "object" ? v : { __isChunk: true, text: String(v) });
const colorOf = (c: string | RGBA) => (typeof c === "string" ? c : c.toString());

export const fg = (color: string | RGBA) => (input: ChunkInput): TextChunk => ({ ...toChunk(input), fg: colorOf(color) });
export const bg = (color: string | RGBA) => (input: ChunkInput): TextChunk => ({ ...toChunk(input), bg: colorOf(color) });
const attr = (bit: number) => (input: ChunkInput): TextChunk => {
  const c = toChunk(input);
  return { ...c, attributes: (c.attributes ?? 0) | bit };
};
export const bold = attr(TextAttributes.BOLD);
export const dim = attr(TextAttributes.DIM);
export const italic = attr(TextAttributes.ITALIC);
export const underline = attr(TextAttributes.UNDERLINE);
export const strikethrough = attr(TextAttributes.STRIKETHROUGH);

export function t(strings: TemplateStringsArray, ...values: (ChunkInput | StyledText)[]): StyledText {
  const chunks: TextChunk[] = [];
  strings.forEach((s, i) => {
    if (s) chunks.push(toChunk(s));
    if (i < values.length) {
      const v = values[i]!;
      if (v instanceof StyledText) chunks.push(...v.chunks);
      else chunks.push(toChunk(v));
    }
  });
  return new StyledText(chunks);
}

/* ---- small utilities ---- */

// eslint-disable-next-line no-control-regex
const ANSI_RX = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
export function stripAnsiSequences(value: string): string {
  return value.replace(ANSI_RX, "");
}

export function decodePasteBytes(bytes: Uint8Array | string): string {
  return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
}
