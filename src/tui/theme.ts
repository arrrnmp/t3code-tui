/**
 * One quiet zinc scale, OpenCode-style: panes separate by a few lightness
 * steps on the same hue, so chrome never bands into stripes. Keep every
 * surface within ~10 lightness of base; colour carries meaning, not chrome.
 */
export const SURFACE = {
  base: "#09090b",
  panel: "#0f0f12",
  raised: "#17171b",
  /** Button hover fill — one step above `raised`, for text buttons that
      signal hover with a background instead of a tone/underline change. */
  hover: "#202027",
  user: "#14141a",
  agent: "#0f0f12",
  border: "#27272a",
  borderFocus: "#7dd3fc",
} as const;

/** One palette for every pane so chrome stays quiet and colour carries meaning. */
export const COLOR = {
  // Claude Code's body text, deliberately below pure white so long sessions
  // stay easy on the eyes.
  text: "#dcdfe4",
  bright: "#eceef2",
  dim: "#8b8f98",
  faint: "#3f3f46",
  rule: "#27272a",
  accent: "#7dd3fc",
  user: "#86efac",
  agent: "#93c5fd",
  tool: "#a1a1aa",
  command: "#c3e88d",
  warn: "#fbbf24",
  danger: "#f87171",
  diff: "#c4b5fd",
  added: "#4ade80",
  removed: "#f87171",
  selectionBg: "#1f2937",
} as const;

/**
 * Tree-sitter highlight-group palette shared by every `<code>`/`<diff>`/
 * `<markdown>` renderable's `syntaxStyle`. `SyntaxStyle.create()` registers
 * no token styles, which paints every token the same default colour — this
 * is the explicit table both `diffpanel.tsx` (code diffs) and
 * `timeline.tsx` (fenced code blocks inside chat markdown) merge in so a
 * `js`/`ts`/etc. fence gets the same real syntax highlighting a diff does,
 * not just plain text.
 */
export const CODE_SYNTAX_TOKENS = {
  default: { fg: "#e5e7eb" },
  keyword: { fg: "#c792ea", italic: true },
  "keyword.import": { fg: "#c792ea" },
  "keyword.return": { fg: "#c792ea", italic: true },
  "keyword.function": { fg: "#82aaff" },
  "keyword.operator": { fg: "#89ddff" },
  "keyword.type": { fg: "#ffcb6b", bold: true },
  string: { fg: "#c3e88d" },
  "string.special": { fg: "#c3e88d" },
  comment: { fg: "#5f7e97", italic: true },
  number: { fg: "#f78c6c" },
  boolean: { fg: "#f78c6c" },
  constant: { fg: "#f78c6c" },
  function: { fg: "#82aaff" },
  "function.call": { fg: "#82aaff" },
  "function.method": { fg: "#82aaff" },
  constructor: { fg: "#82aaff" },
  type: { fg: "#ffcb6b" },
  class: { fg: "#ffcb6b" },
  module: { fg: "#ffcb6b" },
  variable: { fg: "#e5e7eb" },
  "variable.parameter": { fg: "#f78c6c" },
  "variable.member": { fg: "#82aaff" },
  property: { fg: "#80cbc4" },
  operator: { fg: "#89ddff" },
  punctuation: { fg: "#89ddff" },
  "punctuation.bracket": { fg: "#89ddff" },
  "punctuation.delimiter": { fg: "#89ddff" },
  bracket: { fg: "#89ddff" },
  tag: { fg: "#f07178" },
  "tag.attribute": { fg: "#ffcb6b" },
  label: { fg: "#c792ea" },
} as const;

/** Row-background palette for `<diff>` renderables — shared by the full-file
    `diffpanel.tsx` view and the inline per-edit diff in `timeline.tsx` so a
    change reads the same color whether it's in the side panel or the chat. */
export const DIFF_BG = {
  added: "#0f2a1a",
  removed: "#2e1516",
  addedLineNumber: "#16341f",
  removedLineNumber: "#3a1a1b",
} as const;

export const STATUS_COLOR: Record<string, string> = {
  running: COLOR.accent,
  blocked: COLOR.danger,
  active: COLOR.warn,
  snoozed: "#a78bfa",
  settled: COLOR.dim,
};

/**
 * Best-effort brand-color approximations — the provider catalog carries no
 * color of its own (`ProviderSummary.driver` is a free-form string), so this
 * is a client-side guess keyed by substring match, same idea as the sidebar's
 * hashed project badge colors. Cosmetic; retune the hexes freely.
 */
const PROVIDER_COLOR_BY_KEYWORD: readonly [keyword: string, color: string][] = [
  ["claude", "#DE7356"],
  ["codex", "#74AA9C"],
  ["openai", "#74AA9C"],
  ["opencode", "#8B5CF6"],
];

/** Matches on `driver`/`instanceId`/model slug — whatever names the provider. */
export function providerColor(...candidates: readonly (string | null | undefined)[]): string | null {
  const haystack = candidates.filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  for (const [keyword, color] of PROVIDER_COLOR_BY_KEYWORD) {
    if (haystack.includes(keyword)) return color;
  }
  return null;
}

/** Filled bar marking the focused pane or the open thread. */
export const MARKER = "▌";

/** Shared "thinking" spinner frames — one per second, so the terminal title
    and the chat pane's live indicator stay in visual sync. */
export const SPINNER = ["◐", "◓", "◑", "◒"];

/**
 * Lively braille spinner for in-pane live indicators (10 frames at ~100ms).
 * The terminal title keeps `SPINNER` — titles update on the 1s `now` tick,
 * so braille there would just alias.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function rule(width: number): string {
  return "─".repeat(Math.max(0, width));
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

/** Left text padded so `right` sits flush against the far edge of `width`. */
export function spread(left: string, right: string, width: number): string {
  const trimmed = truncate(left, Math.max(0, width - right.length - 1));
  const gap = Math.max(1, width - trimmed.length - right.length);
  return `${trimmed}${" ".repeat(gap)}${right}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function toHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
}

/** Linear-interpolates between two hex colors at `t` (0..1). */
export function lerpColor(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const [fr, fg, fb] = hexToRgb(from);
  const [tr, tg, tb] = hexToRgb(to);
  return `#${toHex(fr + (tr - fr) * clamped)}${toHex(fg + (tg - fg) * clamped)}${toHex(fb + (tb - fb) * clamped)}`;
}

/**
 * A slow gray-to-vivid-to-gray pulse so a "working" indicator reads as
 * actively alive rather than a static label. `now`/`startedAt` drive the
 * phase so the color advances on the same tick that already redraws the
 * elapsed clock — no extra timer.
 */
export function pulseColor(elapsedMs: number, from: string, to: string, periodMs = 4000): string {
  const phase = (elapsedMs % periodMs) / periodMs;
  const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return lerpColor(from, to, triangle);
}
