/**
 * opentui's syntax highlighting, in the browser: the same tree-sitter
 * grammars and queries (`../.generated/treesitter.ts`, built by
 * `../treesitter-assets.ts`), run through web-tree-sitter — the version
 * opentui pins — and turned into styled chunks by a port of opentui's own
 * `highlightOnce` (parser.worker.js) and `treeSitterToTextChunks`
 * (lib/tree-sitter-styled-text.ts). Grammars load on demand from
 * `_vendor/tree-sitter/<filetype>.js`, next to `_ds_bundle.js`.
 */
import { useEffect, useState } from "react";
import { Language, Parser, Query } from "web-tree-sitter";
import { BASENAME_TO_FILETYPE, EXTENSION_TO_FILETYPE, GRAMMARS, RUNTIME_WASM_BASE64 } from "../.generated/treesitter.js";
import { TextAttributes, type SyntaxStyle, type TextChunk } from "./opentui-core.js";

/* ------------------------------------------------ filetype resolution -- */
// Ports of opentui's extToFiletype / pathToFiletype / infoStringToFiletype.

const normalizeToken = (value: string) => value.trim().replace(/^\./, "").toLowerCase() || undefined;

export function extToFiletype(extension: string): string | undefined {
  const ext = normalizeToken(extension);
  return ext ? EXTENSION_TO_FILETYPE.get(ext) : undefined;
}

export function pathToFiletype(path: string): string | undefined {
  const base = path.trim().replaceAll("\\", "/").split("/").pop()?.toLowerCase();
  if (!base) return undefined;
  const byName = BASENAME_TO_FILETYPE.get(base);
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  if (dot === -1 || dot === base.length - 1) return undefined;
  return extToFiletype(base.slice(dot + 1));
}

export function infoStringToFiletype(info: string): string | undefined {
  const token = info.trim().split(/\s+/, 1)[0] ?? "";
  const direct = BASENAME_TO_FILETYPE.get(token.toLowerCase());
  if (direct) return direct;
  const normalized = normalizeToken(token);
  if (!normalized) return undefined;
  return BASENAME_TO_FILETYPE.get(normalized) ?? pathToFiletype(normalized) ?? extToFiletype(normalized) ?? normalized;
}

/** filetype or alias → the grammar that serves it (worker's alias table). */
const GRAMMAR_FOR = new Map<string, (typeof GRAMMARS)[number]>();
for (const g of GRAMMARS) {
  GRAMMAR_FOR.set(g.filetype, g);
  for (const alias of g.aliases) if (!GRAMMAR_FOR.has(alias)) GRAMMAR_FOR.set(alias, g);
}

/* ------------------------------------------------------ asset loading -- */

/** Directory `_ds_bundle.js` was served from, captured while the bundle evaluates. */
const BASE_URL = (() => {
  if (typeof document === "undefined") return "";
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find((s) => /_ds_bundle\.js(\?|$)/.test(s.src)) ??
    null;
  try {
    return script?.src ? new URL(".", script.src).href : new URL(".", document.baseURI).href;
  } catch {
    return "";
  }
})();

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

let runtime: Promise<void> | null = null;
function ensureRuntime(): Promise<void> {
  runtime ??= Parser.init({ wasmBinary: decode(RUNTIME_WASM_BASE64) } as never);
  return runtime;
}

interface LoadedGrammar {
  filetype: string;
  parser: Parser;
  highlights: Query;
  injections: Query | null;
  injectionMapping?: (typeof GRAMMARS)[number]["injectionMapping"];
}

type Payload = { wasm: string; highlights: string; injections: string | null };
declare global {
  interface Window {
    __mxTreeSitter?: Record<string, Payload>;
  }
}

function loadScript(filetype: string): Promise<Payload> {
  const have = window.__mxTreeSitter?.[filetype];
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = `${BASE_URL}_vendor/tree-sitter/${filetype}.js`;
    el.async = true;
    el.onload = () => {
      const payload = window.__mxTreeSitter?.[filetype];
      if (payload) resolve(payload);
      else reject(new Error(`tree-sitter grammar ${filetype} did not register`));
    };
    el.onerror = () => reject(new Error(`tree-sitter grammar ${filetype} failed to load from ${el.src}`));
    document.head.appendChild(el);
  });
}

const loaded = new Map<string, Promise<LoadedGrammar | null>>();
function loadGrammar(filetype: string): Promise<LoadedGrammar | null> {
  const entry = GRAMMAR_FOR.get(filetype);
  if (!entry) return Promise.resolve(null);
  let promise = loaded.get(entry.filetype);
  if (!promise) {
    promise = (async () => {
      try {
        await ensureRuntime();
        const payload = await loadScript(entry.filetype);
        const language = await Language.load(decode(payload.wasm));
        const parser = new Parser();
        parser.setLanguage(language);
        return {
          filetype: entry.filetype,
          parser,
          highlights: new Query(language, payload.highlights),
          injections: payload.injections ? new Query(language, payload.injections) : null,
          ...(entry.injectionMapping ? { injectionMapping: entry.injectionMapping } : {}),
        };
      } catch (error) {
        console.warn(`[moxen-tui] ${String(error)}`);
        return null;
      }
    })();
    loaded.set(entry.filetype, promise);
  }
  return promise;
}

/* --------------------------------------------- highlightOnce (worker) -- */

export type Highlight = [start: number, end: number, group: string, meta?: Record<string, unknown>];

interface Match {
  name: string;
  patternIndex: number;
  node: { startIndex: number; endIndex: number };
  setProperties?: Record<string, unknown>;
  _injectedQuery?: Query;
}

async function processInjections(grammar: LoadedGrammar, rootNode: any, content: string) {
  const captures: Match[] = [];
  const ranges = new Map<string, { start: number; end: number }[]>();
  if (!grammar.injections) return { captures, ranges };
  const groups = new Map<string, any[]>();
  for (const capture of grammar.injections.captures(rootNode)) {
    if (!(capture.name === "injection.content" || capture.name.includes("injection"))) continue;
    const nodeType = capture.node.type;
    let target: string | undefined;
    if (grammar.injectionMapping?.nodeTypes?.[nodeType]) {
      target = grammar.injectionMapping.nodeTypes[nodeType];
    } else if (nodeType === "code_fence_content") {
      const info = capture.node.parent?.children.find((c: any) => c.type === "info_string");
      const lang = info?.children.find((c: any) => c.type === "language");
      if (lang) {
        const name = content.substring(lang.startIndex, lang.endIndex);
        target = grammar.injectionMapping?.infoStringMap?.[name] ?? name;
      }
    }
    if (!target) continue;
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target)!.push(capture.node);
  }
  for (const [language, nodes] of groups) {
    const injected = await loadGrammar(language);
    if (!injected) continue;
    if (!ranges.has(language)) ranges.set(language, []);
    for (const injectionNode of nodes) {
      ranges.get(language)!.push({ start: injectionNode.startIndex, end: injectionNode.endIndex });
      const tree = injected.parser.parse(content.substring(injectionNode.startIndex, injectionNode.endIndex));
      if (!tree) continue;
      for (const m of injected.highlights.captures(tree.rootNode) as any[]) {
        captures.push({
          name: m.name,
          patternIndex: m.patternIndex,
          _injectedQuery: injected.highlights,
          node: { startIndex: m.node.startIndex + injectionNode.startIndex, endIndex: m.node.endIndex + injectionNode.startIndex },
        });
      }
      tree.delete();
    }
  }
  return { captures, ranges };
}

function simpleHighlights(matches: Match[], injectionRanges: Map<string, { start: number; end: number }[]>): Highlight[] {
  const flat: { start: number; end: number; lang: string }[] = [];
  for (const [lang, ranges] of injectionRanges) for (const r of ranges) flat.push({ ...r, lang });
  const out: Highlight[] = [];
  for (const match of matches) {
    const node = match.node;
    let isInjection = false;
    let injectionLang: string | undefined;
    let containsInjection = false;
    for (const r of flat) {
      if (node.startIndex >= r.start && node.endIndex <= r.end) {
        isInjection = true;
        injectionLang = r.lang;
        break;
      } else if (node.startIndex <= r.start && node.endIndex >= r.end) {
        containsInjection = true;
        break;
      }
    }
    const props = (match._injectedQuery as any)?.setProperties?.[match.patternIndex] as Record<string, unknown> | undefined;
    const conceal = props?.conceal ?? match.setProperties?.conceal;
    const concealLines = props?.conceal_lines ?? match.setProperties?.conceal_lines;
    const meta: Record<string, unknown> = {};
    if (isInjection && injectionLang) {
      meta.isInjection = true;
      meta.injectionLang = injectionLang;
    }
    if (containsInjection) meta.containsInjection = true;
    if (conceal !== undefined) meta.conceal = conceal;
    if (concealLines !== undefined) meta.concealLines = concealLines;
    out.push(Object.keys(meta).length ? [node.startIndex, node.endIndex, match.name, meta] : [node.startIndex, node.endIndex, match.name]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/** opentui's `TreeSitterClient.highlightOnce`; null when no grammar serves the filetype. */
export async function highlightOnce(content: string, filetype: string): Promise<Highlight[] | null> {
  const grammar = await loadGrammar(filetype);
  if (!grammar) return null;
  const parseContent = filetype === "markdown" && content.endsWith("```") ? `${content}\n` : content;
  const tree = grammar.parser.parse(parseContent);
  if (!tree) return null;
  try {
    const matches = grammar.highlights.captures(tree.rootNode) as unknown as Match[];
    let injectionRanges = new Map<string, { start: number; end: number }[]>();
    if (grammar.injections) {
      const injected = await processInjections(grammar, tree.rootNode, content);
      matches.push(...injected.captures);
      injectionRanges = injected.ranges;
    }
    return simpleHighlights(matches, injectionRanges);
  } finally {
    tree.delete();
  }
}

/* ---------------------------------------- treeSitterToTextChunks port -- */

const attrs = (s: { bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean } | undefined) =>
  s
    ? (s.bold ? TextAttributes.BOLD : 0) | (s.italic ? TextAttributes.ITALIC : 0) | (s.underline ? TextAttributes.UNDERLINE : 0) | (s.dim ? TextAttributes.DIM : 0)
    : 0;

function chunk(text: string, style: { fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean } | undefined): TextChunk {
  return { __isChunk: true, text, fg: style?.fg, bg: style?.bg, attributes: attrs(style) };
}

export function treeSitterToTextChunks(content: string, highlights: Highlight[], syntaxStyle: SyntaxStyle, options: { enabled?: boolean; baseHighlight?: string } = {}): TextChunk[] {
  const chunks: TextChunk[] = [];
  const defaultStyle = syntaxStyle.getStyle("default");
  const concealEnabled = options.enabled ?? true;
  const baseStyle = options.baseHighlight ? syntaxStyle.getStyle(options.baseHighlight) : undefined;
  const containers: { start: number; end: number }[] = [];
  const boundaries: { offset: number; type: "start" | "end"; index: number }[] = [];
  highlights.forEach(([start, end, , meta], i) => {
    if (start === end) return;
    if (meta?.containsInjection) containers.push({ start, end });
    boundaries.push({ offset: start, type: "start", index: i }, { offset: end, type: "end", index: i });
  });
  boundaries.sort((a, b) => (a.offset !== b.offset ? a.offset - b.offset : a.type === b.type ? 0 : a.type === "end" ? -1 : 1));
  const active = new Set<number>();
  let offset = 0;
  for (const boundary of boundaries) {
    if (offset < boundary.offset && active.size > 0) {
      const text = content.slice(offset, boundary.offset);
      const groups = [...active].map((index) => ({ group: highlights[index]![2], meta: highlights[index]![3], index }));
      const conceal = concealEnabled ? groups.find((h) => h.meta?.conceal !== undefined || h.group === "conceal" || h.group.startsWith("conceal.")) : undefined;
      if (conceal) {
        const replacement = conceal.meta?.conceal !== undefined ? String(conceal.meta.conceal) : conceal.group === "conceal.with.space" ? " " : "";
        if (replacement) chunks.push(chunk(replacement, defaultStyle));
      } else {
        const inContainer = containers.some((r) => offset >= r.start && offset < r.end);
        const valid = groups
          .filter((h) => !(inContainer && !h.meta?.isInjection && h.group === "markup.raw.block"))
          .sort((a, b) => a.group.split(".").length - b.group.split(".").length || a.index - b.index);
        const merged: Record<string, unknown> = baseStyle ? { ...baseStyle } : {};
        for (const { group } of valid) {
          const style = syntaxStyle.getStyle(group) ?? (group.includes(".") ? syntaxStyle.getStyle(group.split(".")[0]!) : undefined);
          if (!style) continue;
          for (const key of ["fg", "bg", "bold", "italic", "underline", "dim"] as const) if (style[key] !== undefined) merged[key] = style[key];
        }
        chunks.push(chunk(text, Object.keys(merged).length > 0 ? (merged as never) : defaultStyle));
      }
    } else if (offset < boundary.offset) {
      chunks.push(chunk(content.slice(offset, boundary.offset), baseStyle ?? defaultStyle));
    }
    if (boundary.type === "start") {
      active.add(boundary.index);
    } else {
      active.delete(boundary.index);
      if (concealEnabled) {
        const [, , group, meta] = highlights[boundary.index]!;
        if (meta?.concealLines !== undefined && content[boundary.offset] === "\n") {
          offset = boundary.offset + 1;
          continue;
        }
        if (meta?.conceal !== undefined && content[boundary.offset] === " " && (meta.conceal === " " || (meta.conceal === "" && group === "conceal" && !meta.isInjection))) {
          offset = boundary.offset + 1;
          continue;
        }
      }
    }
    offset = boundary.offset;
  }
  if (offset < content.length) chunks.push(chunk(content.slice(offset), baseStyle ?? defaultStyle));
  return chunks;
}

/* ---------------------------------------------------------------- hook -- */

/**
 * Styled chunks for `content`, or null while loading / when the filetype has
 * no grammar (callers then draw plain text in `fg`, as opentui does).
 */
export function useHighlight(content: string, filetype: string | undefined, syntaxStyle: SyntaxStyle | undefined, conceal: boolean): TextChunk[] | null {
  const [chunks, setChunks] = useState<TextChunk[] | null>(null);
  useEffect(() => {
    let live = true;
    setChunks(null);
    if (!filetype || !syntaxStyle || typeof document === "undefined") return;
    highlightOnce(content, filetype).then((highlights) => {
      if (!live || !highlights) return;
      setChunks(treeSitterToTextChunks(content, highlights, syntaxStyle, { enabled: conceal }));
    });
    return () => {
      live = false;
    };
  }, [content, filetype, syntaxStyle, conceal]);
  return chunks;
}

/** Splits chunks at newlines into one chunk list per line (for the diff gutter). */
export function splitLines(chunks: TextChunk[]): TextChunk[][] {
  const lines: TextChunk[][] = [[]];
  for (const c of chunks) {
    const parts = c.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ ...c, text: part });
    });
  }
  return lines;
}
