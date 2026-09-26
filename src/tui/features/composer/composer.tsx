import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { SyntaxStyle, TextAttributes, bg, fg, italic, t } from "@opentui/core";

import { useHover } from "../../hooks/useHover.js";
import { useAnimTick } from "../../hooks/useAnimTick.js";
import { PICK_BG, PICK_FG } from "../pickers/pickermodal.js";
import { COLOR, pulseColor, SURFACE, truncate } from "../../theme.js";
import { thumbGeometry } from "../../model/scrollbar.js";
import { detectSkillTrigger, filterSkills, insertSkillMention, marqueeWindow, type SkillTrigger } from "../../model/skills.js";
import type { SkillSummary } from "../../../core/catalog/summary.js";
import type { ContextUsageDisplay } from "../../model/turns.js";
import type { PlanUsageGauge } from "../../model/sidepanel.js";
import { nextImageLabel, pairImageTokens } from "../../model/imagetokens.js";

/** Rows visible at once before the list scrolls (wheel, not the arrow keys alone). */
const SKILL_POPUP_ROWS = 6;
/** Marquee tick for the highlighted row's description, ms per column. */
const SKILL_MARQUEE_INTERVAL_MS = 350;

/** A footer label (model, effort, stop) that brightens on hover — clicking
    chrome, so never part of a text selection. */
function HoverText({
  text,
  color,
  hoverColor,
  onClick,
}: {
  text: string;
  color: string;
  hoverColor: string;
  onClick: () => void;
}) {
  const { hovered, handlers } = useHover();
  return (
    <text fg={hovered ? hoverColor : color} bg={SURFACE.raised} selectable={false} onMouseDown={onClick} {...handlers}>
      {text}
    </text>
  );
}

/**
 * The provider's guess at the next prompt, as the empty draft's placeholder:
 * the text itself in italics, then a key chip saying how to take it — one
 * line, cut short rather than wrapped under the chip.
 */
function suggestionPlaceholder(suggestion: string, width: number) {
  const room = Math.max(12, width - 22);
  const text = truncate(suggestion.replace(/\s+/gu, " ").trim(), room);
  return t`${fg(COLOR.dim)(italic(text))}   ${bg(SURFACE.border)(fg(COLOR.bright)(" tab "))}${fg(COLOR.faint)(" to use it")}`;
}

/** The account's plan usage in the footer: one short gauge per window, coloured as it fills. */
function usageColor(percent: number): string {
  return percent >= 90 ? COLOR.danger : percent >= 70 ? COLOR.warn : COLOR.dim;
}

function PlanUsageSegment({ gauges, onClick }: { gauges: readonly PlanUsageGauge[]; onClick: () => void }) {
  const { hovered, handlers } = useHover();
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised} onMouseDown={onClick} selectable={false} {...handlers}>
      {gauges.map((gauge, index) => (
        <box key={gauge.short} style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
          <text fg={hovered ? COLOR.text : COLOR.faint} bg={SURFACE.raised} selectable={false}>{`${index === 0 ? "" : " "}${gauge.short} `}</text>
          <text fg={hovered ? COLOR.bright : usageColor(gauge.percent)} bg={SURFACE.raised} selectable={false}>{`${Math.round(gauge.percent)}%`}</text>
        </box>
      ))}
    </box>
  );
}

/** How an `[Image N]` token reads in the draft: a filled chip, one unit to the cursor and to backspace. */
let tokenStyle: SyntaxStyle | null = null;
function imageTokenStyle(): SyntaxStyle {
  tokenStyle ??= SyntaxStyle.fromStyles({ "extmark.image": { fg: PICK_FG, bg: PICK_BG, bold: true } });
  return tokenStyle;
}

/** The "⋯ more" control's width, its separator included. */
const MORE_WIDTH = 11;

/** OpenCode caps its prompt at ~10 rows before the box scrolls internally. */
const MAX_COMPOSER_LINES = 10;
/** Resting height so the composer reads as an input card, not a status line. */
const MIN_COMPOSER_LINES = 3;

/**
 * The textarea scrolls internally past `MAX_COMPOSER_LINES` with no native
 * bar (a `<scrollbox>` cannot wrap a textarea), so the composer draws its
 * own 1-column strip at the card's right edge: faint track, accent thumb,
 * blank while the draft fits.
 *
 * The textarea wraps and scrolls while it renders — after React has already
 * drawn this strip — so reading its rows during React's render always lags
 * one frame (and a wheel scroll or a programmatic `setText` fires no React
 * event at all). A post-frame check re-renders the strip whenever the rows or
 * offset it last drew no longer match the textarea's.
 */
function ComposerScrollbar({ areaRef }: { areaRef: RefObject<TextareaRenderable | null> }) {
  const renderer = useRenderer();
  const [, bump] = useState(0);
  const drawn = useRef("");
  useEffect(() => {
    const check = (): void => {
      const node = areaRef.current;
      const seen = node === null ? "" : `${node.lineInfo.lineStartCols.length}:${node.scrollY}`;
      if (seen !== drawn.current) bump((tick) => tick + 1);
    };
    renderer.addPostProcessFn(check);
    return () => renderer.removePostProcessFn(check);
  }, [renderer, areaRef]);
  const area = areaRef.current;
  // The column is always reserved (blank while the draft fits): the draft's
  // wrap width must not change as the thumb comes and goes, or a draft right
  // at the cap would re-wrap under/over it and flip the strip every frame.
  const blank = <box style={{ width: 1, flexShrink: 0 }} selectable={false} />;
  if (area === null) {
    drawn.current = "";
    return blank;
  }
  drawn.current = `${area.lineInfo.lineStartCols.length}:${area.scrollY}`;
  // Total VISUAL rows come from lineInfo, not virtualLineCount (which caps
  // at the viewport height) or lineCount (which ignores word wrap).
  const total = area.lineInfo.lineStartCols.length;
  const viewRows = Math.min(MAX_COMPOSER_LINES, Math.max(MIN_COMPOSER_LINES, total));
  // Breathing box + footer box below the textarea inside the card.
  const trackLen = viewRows + 2;
  const thumb = thumbGeometry(total, viewRows, area.scrollY, trackLen);
  if (thumb === null) return blank;
  return (
    <box style={{ width: 1, flexShrink: 0 }} selectable={false}>
      {Array.from({ length: trackLen }, (_, row) => {
        const onThumb = row >= thumb.start && row < thumb.start + thumb.size;
        return (
          <text key={row} fg={onThumb ? COLOR.accent : COLOR.faint} bg={COLOR.faint} selectable={false}>
            {onThumb ? "█" : " "}
          </text>
        );
      })}
    </box>
  );
}

/**
 * Enter sends; several chords insert a newline because terminals disagree on
 * what Shift+Enter emits. Legacy terminals send it as bare `linefeed` (the
 * same byte as Ctrl+J), Kitty-streamed ones report `return` with modifiers,
 * so both families — plus Ctrl/Meta+Enter fallbacks — must mean newline.
 * Bare `return` (the `\r` most terminals send for Enter) stays as submit.
 */
const COMPOSER_KEY_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "kpenter", shift: true, action: "newline" },
  { name: "kpenter", ctrl: true, action: "newline" },
  { name: "linefeed", action: "newline" },
  { name: "linefeed", shift: true, action: "newline" },
  { name: "linefeed", ctrl: true, action: "newline" },
] as never[];

export function Composer({
  draft,
  resetKey,
  onInput,
  onSubmit,
  onEscape,
  onFocus,
  focused,
  placeholder,
  model,
  modelColor,
  effort,
  permission,
  flushTop,
  onModelClick,
  onEffortClick,
  onPermissionClick,
  onStopClick,
  onCopyClick,
  onExternalEditClick,
  editingExternally,
  submitVerb,
  running,
  width,
  hideHint,
  skills,
  skillPrefix,
  contextUsage,
  onContextUsageClick,
  backgroundSummary,
  onBackgroundClick,
  planUsage,
  onPlanUsageClick,
  onQueue,
  attachments,
  onAttachmentRemoved,
  suggestion,
}: {
  draft: string;
  /**
   * Changes only on a genuine external reset (thread switch, post-send
   * clear) — never on ordinary typing. Driving the sync effect off this
   * instead of `draft` itself removes the race entirely: comparing draft
   * text against the textarea's own buffer could false-negative on any
   * normalization difference (trailing newline, CRLF) and stomp mid-typing
   * content with a stale value the moment the parent's state round-tripped.
   */
  resetKey: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
  onFocus: () => void;
  focused: boolean;
  placeholder: string;
  /** Pretty model name — never the raw provider slug. */
  model: string;
  /** Provider-brand color for the model name (Claude/Codex/OpenCode); null/undefined falls back to the default text color. */
  modelColor?: string | null | undefined;
  /** Effort knob value (e.g. `xhigh`); null hides the segment. */
  effort?: string | null;
  /** Pretty permission level (e.g. `Full access`); null hides the segment. */
  permission?: string | null;
  /** Pending attachments sit directly above: drop the top margin to sit flush. */
  flushTop?: boolean;
  /** Footer segments open the model/effort/permission picker modals on click. */
  onModelClick?: () => void;
  onEffortClick?: () => void;
  onPermissionClick?: () => void;
  /** A running turn gets a clickable stop control in the footer instead of
      relying on a key. */
  onStopClick?: () => void;
  /** Copies the current draft text to the clipboard; omitted hides the segment. */
  onCopyClick?: () => void;
  /** Opens the draft in `$EDITOR`; omitted hides the segment. Alt+E also triggers it. */
  onExternalEditClick?: () => void;
  /** The draft is open in the external editor — textarea unfocuses and hints pause. */
  editingExternally?: boolean;
  submitVerb: "creates" | "sends";
  /** A turn is in flight, so escape stops it rather than just unfocusing. */
  running: boolean;
  /** Outer width of the composer, border included. */
  width: number;
  /** The "creating" view renders its own centered hint below the composer;
      suppress this one so it isn't shown twice. */
  hideHint?: boolean;
  /** Undefined hides `$` skill invocation entirely (no catalog loaded yet). */
  skills?: readonly SkillSummary[] | undefined;
  /** How the provider invokes a picked skill: `$name` (Codex) or `/name`. */
  skillPrefix?: "$" | "/" | undefined;
  /** Null/undefined hides the segment — the driver never reported usage for this thread. */
  contextUsage?: ContextUsageDisplay | null;
  onContextUsageClick?: () => void;
  /** e.g. "2 shell, 1 monitor"; null/undefined hides the segment. */
  backgroundSummary?: string | null;
  onBackgroundClick?: () => void;
  /** The provider's plan usage windows; null/undefined/empty hides the segment. */
  planUsage?: readonly PlanUsageGauge[] | null;
  onPlanUsageClick?: () => void;
  /** Tab while a turn runs: queue the draft to run once the turn ends (Enter steers it instead). */
  onQueue?: () => void;
  /**
   * The pending images, by name, in order. Each shows in the draft as an
   * `[Image N]` token where it was pasted; deleting the token detaches it.
   */
  attachments?: readonly string[];
  onAttachmentRemoved?: (name: string) => void;
  /** The provider's guess at the next prompt: shown in an empty draft, Tab takes it. */
  suggestion?: string | null;
}) {
  const areaRef = useRef<TextareaRenderable | null>(null);
  /** Each pending image's token in the draft: its extmark and label, by attachment name. */
  const tokens = useRef(new Map<string, { id: number; label: string }>());
  const tokenType = useRef<number | null>(null);
  const markToken = (node: TextareaRenderable, name: string, label: string, start: number) => {
    tokenType.current ??= node.extmarks.registerType("image-token");
    const styleId = imageTokenStyle().getStyleId("extmark.image");
    const id = node.extmarks.create({
      start,
      end: start + label.length,
      virtual: true,
      typeId: tokenType.current,
      ...(styleId === null ? {} : { styleId }),
    });
    tokens.current.set(name, { id, label });
  };
  const attachmentKey = (attachments ?? []).join("\n");
  /** The "⋯ more" menu of footer controls a narrow composer cannot fit. */
  const [moreOpen, setMoreOpen] = useState(false);
  const localRef = useRef(draft);
  const external = editingExternally === true;
  // No height estimate here: the textarea shrink-wraps its content, so the
  // box always fits the text exactly. A parallel width calc drifted from the
  // real wrap width and left phantom empty rows behind.
  const fullHint =
    submitVerb === "creates"
      ? "enter creates · esc cancels"
      : running
        ? "enter steers · tab queues · ctrl+j newline · esc unfocus"
        : "enter sends · shift+enter newline · esc unfocus";
  const midHint =
    submitVerb === "creates"
      ? fullHint
      : running
        ? "enter steers · tab queues"
        : "enter sends · shift+enter newline";
  const shortHint = submitVerb === "creates" ? "enter creates" : running ? "enter steers" : "enter sends";
  const hint =
    external
      ? "editing in external editor…"
      : width >= fullHint.length + 2
        ? fullHint
        : width >= midHint.length + 2
          ? midHint
          : shortHint;

  // The textarea owns its buffer; only an explicit external reset (thread
  // switch, post-send clear — signaled by `resetKey` changing) pushes a value
  // into it. Keystrokes flow the other way via onContentChange.
  useEffect(() => {
    const node = areaRef.current;
    if (node === null) return;
    localRef.current = draft;
    node.setText(draft);
    // A restored draft reads "[Image 1]" as plain text: give each pending
    // image its token back (the rest are placed at the next attach pass).
    node.extmarks.clear();
    tokens.current.clear();
    for (const span of pairImageTokens(draft, attachments ?? []).paired) markToken(node, span.name, span.label, span.start);
    // `draft` is read at the moment `resetKey` changes, not tracked as its
    // own dependency — see the `resetKey` doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // A newly pending image gets its token at the cursor; one no longer
  // pending (sent, or removed elsewhere) lets go of its token.
  useEffect(() => {
    const node = areaRef.current;
    if (node === null) return;
    const names = attachments ?? [];
    for (const [name, token] of [...tokens.current]) {
      if (names.includes(name)) continue;
      node.extmarks.delete(token.id);
      tokens.current.delete(name);
    }
    for (const name of names) {
      if (tokens.current.has(name)) continue;
      const label = nextImageLabel([...tokens.current.values()].map((token) => token.label));
      const start = node.cursorOffset;
      node.insertText(`${label} `);
      markToken(node, name, label, start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentKey]);

  const [skillTrigger, setSkillTrigger] = useState<SkillTrigger | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const skillScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const [skillMarqueeTick, setSkillMarqueeTick] = useState(0);
  // Only a keyboard-driven selection should auto-scroll the pane. Hover
  // updating the same index must NOT: OpenTUI recomputes hover from the
  // last known cursor position whenever layout shifts (no true mouse-move
  // events), so scrolling on a hover-driven change would move the rows
  // under a stationary cursor, fire hover again for whatever row landed
  // there, and fight the keyboard selection every time it crossed a page.
  const skillNavSourceRef = useRef<"keyboard" | "mouse">("keyboard");

  const skillMatches = useMemo(() => {
    if (skillTrigger === null || skills === undefined) return [];
    return filterSkills(skills, skillTrigger.query);
  }, [skillTrigger, skills]);
  const safeSkillIndex = skillMatches.length === 0 ? -1 : Math.min(Math.max(0, skillIndex), skillMatches.length - 1);
  const skillPopupRows = Math.min(SKILL_POPUP_ROWS, Math.max(1, skillMatches.length));

  useEffect(() => {
    const pane = skillScrollRef.current;
    if (pane === null || safeSkillIndex < 0 || skillNavSourceRef.current !== "keyboard") return;
    if (safeSkillIndex < pane.scrollTop) pane.scrollTo(safeSkillIndex);
    else if (safeSkillIndex >= pane.scrollTop + skillPopupRows) pane.scrollTo(safeSkillIndex - skillPopupRows + 1);
  }, [safeSkillIndex, skillPopupRows]);

  // The highlighted row's description auto-scrolls instead of sitting
  // truncated — ticks only while the picker is actually open.
  useEffect(() => {
    if (skillTrigger === null) return;
    const timer = setInterval(() => setSkillMarqueeTick((tick) => tick + 1), SKILL_MARQUEE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [skillTrigger !== null]);
  useEffect(() => {
    setSkillMarqueeTick(0);
  }, [safeSkillIndex]);

  const insertSkill = (skill: SkillSummary) => {
    if (skillTrigger === null) return;
    const text = areaRef.current?.plainText ?? localRef.current;
    const result = insertSkillMention(text, skillTrigger, skill.name, skillPrefix ?? "$");
    const node = areaRef.current;
    if (node !== null) {
      node.setText(result.text);
      node.cursorOffset = result.cursorOffset;
    }
    localRef.current = result.text;
    onInput(result.text);
    setSkillTrigger(null);
  };

  // Only an empty draft offers the suggestion — the same moment the textarea
  // shows its placeholder, which is where the suggestion appears. Anything
  // typed, even a space, is the user's own.
  const offeredSuggestion = suggestion !== undefined && suggestion !== null && draft.length === 0 && !external ? suggestion : null;

  const handleContentChange = () => {
    if (external) return;
    const text = areaRef.current?.plainText ?? "";
    localRef.current = text;
    onInput(text);
    // A token deleted (backspace takes it whole) detaches its image.
    const node = areaRef.current;
    if (node !== null) {
      for (const [name, token] of [...tokens.current]) {
        if (node.extmarks.get(token.id) !== null) continue;
        tokens.current.delete(name);
        onAttachmentRemoved?.(name);
      }
    }
    if (skills === undefined) return;
    const cursor = areaRef.current?.cursorOffset ?? text.length;
    setSkillTrigger(detectSkillTrigger(text, cursor));
    skillNavSourceRef.current = "keyboard";
    setSkillIndex(0);
  };

  // Each segment carries its width and a drop rank: a narrow composer (a
  // side panel open) sheds the highest ranks first rather than letting the
  // right-hand group run over the model label.
  const candidates: Array<{ key: string; node: ReactNode; width: number; drop: number }> = [];
  if (contextUsage !== undefined && contextUsage !== null) {
    const text =
      contextUsage.percent === null
        ? contextUsage.usedLabel
        : `${contextUsage.percent}% · ${contextUsage.usedLabel}${contextUsage.maxLabel === null ? "" : `/${contextUsage.maxLabel}`}`;
    candidates.push({
      key: "context",
      width: text.length,
      drop: 2,
      node: (
        <HoverText
          text={text}
          color={COLOR.dim}
          hoverColor={COLOR.bright}
          onClick={onContextUsageClick ?? (() => undefined)}
        />
      ),
    });
  }
  if (planUsage !== undefined && planUsage !== null && planUsage.length > 0) {
    candidates.push({
      key: "plan",
      width: planUsage.reduce((total, gauge, index) => total + gauge.short.length + String(Math.round(gauge.percent)).length + 2 + (index === 0 ? 0 : 1), 0),
      drop: 3,
      node: <PlanUsageSegment gauges={planUsage} onClick={onPlanUsageClick ?? (() => undefined)} />,
    });
  }
  if (backgroundSummary !== undefined && backgroundSummary !== null) {
    candidates.push({
      key: "background",
      width: backgroundSummary.length,
      drop: 1,
      node: (
        <HoverText
          text={backgroundSummary}
          color={COLOR.dim}
          hoverColor={COLOR.bright}
          onClick={onBackgroundClick ?? (() => undefined)}
        />
      ),
    });
  }
  if (onCopyClick !== undefined) {
    candidates.push({
      key: "copy",
      width: 6,
      drop: 5,
      node: <HoverText text="⧉ copy" color={COLOR.dim} hoverColor={COLOR.bright} onClick={onCopyClick} />,
    });
  }
  if (onExternalEditClick !== undefined) {
    candidates.push({
      key: "external",
      width: 10,
      drop: 4,
      node: <HoverText text="✎ external" color={COLOR.dim} hoverColor={COLOR.bright} onClick={onExternalEditClick} />,
    });
  }
  if (running && onStopClick !== undefined) {
    candidates.push({
      key: "stop",
      width: 6,
      drop: 0,
      node: <HoverText text="■ stop" color={COLOR.danger} hoverColor={COLOR.bright} onClick={onStopClick} />,
    });
  }
  // Card chrome: border 1, left padding 2, the draft column's right padding
  // 1 and the scrollbar strip 1. The model group keeps two columns of air.
  const footerRoom = width - 5;
  const leftWidth =
    model.length +
    (effort === null || effort === undefined || effort.length === 0 ? 0 : effort.length + 3) +
    (permission === null || permission === undefined || permission.length === 0 ? 0 : permission.length + 3) +
    2;
  const usedBy = (segments: typeof candidates) => segments.reduce((total, segment, index) => total + segment.width + (index === 0 ? 0 : 5), 0);
  const fit = (room: number) => {
    const kept = [...candidates];
    while (kept.length > 0 && leftWidth + usedBy(kept) > room) {
      const victim = kept.reduce((worst, segment) => (segment.drop > worst.drop ? segment : worst));
      if (victim.drop === 0) break;
      kept.splice(kept.indexOf(victim), 1);
    }
    return kept;
  };
  // Whatever does not fit goes behind a "⋯ more" control (which takes room
  // of its own); the menu lists only the hidden segments, never the ones
  // still visible in the footer (showing both is what duplicated `stop`).
  const everything = fit(footerRoom);
  const kept = everything.length === candidates.length ? everything : fit(footerRoom - MORE_WIDTH);
  const keptKeys = new Set(kept.map((segment) => segment.key));
  const overflow = candidates.filter((segment) => !keptKeys.has(segment.key));
  const hidden = overflow.length > 0;
  const menuShown = moreOpen && hidden && skillTrigger === null;
  const footerSegments = hidden
    ? [
        ...kept,
        {
          key: "more",
          width: MORE_WIDTH - 5,
          drop: 0,
          node: <HoverText text={menuShown ? "▾ more" : "⋯ more"} color={COLOR.dim} hoverColor={COLOR.bright} onClick={() => setMoreOpen((open) => !open)} />,
        },
      ]
    : kept;

  // Focused border breathes sky→deeper-sky while a turn runs — subtle glow,
  // static otherwise. Gated internally so idle composers never re-render.
  const borderTick = useAnimTick(running && focused, 400);
  const frameBorderColor =
    running && focused ? pulseColor(borderTick, SURFACE.borderFocus, "#0ea5e9", 2400) : focused ? SURFACE.borderFocus : SURFACE.border;

  return (
    // Stacked above its siblings (tasks panel, banners, attachment strip):
    // the popovers it floats over them (skills list, context card) are its
    // own children, and a child's zIndex only orders it among its siblings.
    <box style={{ width, flexDirection: "column", flexShrink: 0, marginTop: flushTop === true ? 0 : 1, zIndex: 20 }}>
      {!menuShown ? null : (
        // The overflow only, stacked just above the footer row and over the
        // draft, right-aligned under the "more" control that opened it: a
        // real card (full rounded frame) rather than a bare left-border
        // strip, so it reads as a menu instead of stray text. Compact —
        // one row per segment, no header or gaps — so it fits above the
        // footer even in short frames.
        <box
          style={{ position: "absolute", right: 1, bottom: 3, flexDirection: "column", zIndex: 24, paddingLeft: 2, paddingRight: 2 }}
          borderStyle="rounded"
          borderColor={SURFACE.borderFocus}
          backgroundColor={SURFACE.raised}
        >
          {overflow.map((segment) => (
            <box
              key={segment.key}
              style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "flex-start" }}
              backgroundColor={SURFACE.raised}
              onMouseDown={() => setMoreOpen(false)}
            >
              {segment.node}
            </box>
          ))}
        </box>
      )}
      {skillTrigger === null ? null : (
        // Floats just above the composer's own top edge (negative `top`
        // relative to this outer box) — Minecraft/slash-picker style, live
        // over whatever the textarea is doing underneath it.
        <box
          style={{
            position: "absolute",
            left: 0,
            top: -(skillPopupRows + 2),
            width,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1,
            paddingBottom: 1,
            zIndex: 25,
          }}
          border={["left"]}
          borderStyle="heavy"
          borderColor={SURFACE.borderFocus}
          backgroundColor={SURFACE.raised}
        >
          {skillMatches.length === 0 ? (
            <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false}>{"no matching skills"}</text>
          ) : (
            // Fixed-height scrollbox: a wheel over the popup scrolls the
            // skill list itself instead of leaking through to the chat pane
            // underneath it. Every match renders (not just the first
            // `SKILL_POPUP_ROWS`) — the box just clips/scrolls to them.
            // Scrollable content hugs its own intrinsic size instead of
            // stretching to the viewport, so each row needs an explicit
            // width (reserving one column for the scrollbar track) —
            // otherwise a short name shares an unstretched row with its
            // description and both get crushed.
            <scrollbox ref={skillScrollRef} style={{ height: skillPopupRows, flexShrink: 0 }} stickyStart="top">
              {skillMatches.map((skill, index) => {
                const active = index === safeSkillIndex;
                const rowBg = active ? PICK_BG : SURFACE.raised;
                const label = skill.displayName ?? skill.name;
                const meta = skill.shortDescription ?? skill.description ?? "";
                const rowWidth = Math.max(4, width - 3);
                // The name is the actionable part (what `$name` inserts) —
                // it never gets crowded out by a long description. Whatever
                // width survives goes to the description; the highlighted
                // row's description auto-scrolls through the rest instead
                // of sitting truncated, everything else stays static.
                const labelText = truncate(`$${label}`, rowWidth);
                const metaBudget = rowWidth - labelText.length - 1;
                const metaText =
                  meta.length === 0 || metaBudget < 8
                    ? null
                    : active
                      ? marqueeWindow(meta, metaBudget, skillMarqueeTick)
                      : truncate(meta, metaBudget);
                return (
                  <box
                    key={skill.name}
                    style={{ width: rowWidth, flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}
                    backgroundColor={rowBg}
                    onMouseDown={() => insertSkill(skill)}
                    onMouseOver={() => {
                      skillNavSourceRef.current = "mouse";
                      setSkillIndex(index);
                    }}
                  >
                    <text fg={active ? PICK_FG : COLOR.command} bg={rowBg} selectable={false}>
                      {labelText}
                    </text>
                    {metaText === null ? null : (
                      <text fg={active ? PICK_FG : COLOR.faint} bg={rowBg} selectable={false}>{` ${metaText}`}</text>
                    )}
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>
      )}
      <box
        border={["left"]}
        borderStyle="heavy"
        borderColor={frameBorderColor}
        style={{
          flexDirection: "column",
          backgroundColor: SURFACE.raised,
          // No right padding here: the draft's column keeps its own, and the
          // scrollbar strip sits flush against the card's right edge.
          paddingLeft: 2,
          paddingTop: 1,
          paddingBottom: 1,
        }}
        onMouseDown={onFocus}
        selectable={false}
      >
        {external ? (
          // The draft lives in `$EDITOR`: the textarea and every footer
          // toggleable (model, effort, permission, context, copy,
          // external, stop) hide behind one centered italic notice.
          // minHeight matches the resting composer (textarea min +
          // spacer + footer) so the layout doesn't jump when the editor
          // opens or closes.
          <box
            style={{
              minHeight: MIN_COMPOSER_LINES + 2,
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: SURFACE.raised,
            }}
          >
            <text
              fg={COLOR.dim}
              bg={SURFACE.raised}
              attributes={TextAttributes.ITALIC}
              selectable={false}
            >
              {"Editing in external editor…"}
            </text>
          </box>
        ) : (
          // The scrollbar strip spans the whole card at its right edge (like the
          // timeline bar at the pane edge): content keeps its own right inset
          // inside the column, the strip sits flush outside it.
          <box style={{ flexDirection: "row", flexGrow: 1 }} backgroundColor={SURFACE.raised}>
            <box style={{ flexDirection: "column", flexGrow: 1, paddingRight: 1 }}>
        <textarea
          ref={areaRef}
          focused={focused && !external}
          placeholder={offeredSuggestion === null ? placeholder : suggestionPlaceholder(offeredSuggestion, width)}
          textColor={COLOR.text}
          backgroundColor={SURFACE.raised}
          focusedBackgroundColor={SURFACE.raised}
          focusedTextColor={COLOR.bright}
          placeholderColor={COLOR.faint}
          wrapMode="word"
          syntaxStyle={imageTokenStyle()}
          keyBindings={COMPOSER_KEY_BINDINGS}
          style={{ minHeight: MIN_COMPOSER_LINES, maxHeight: MAX_COMPOSER_LINES, backgroundColor: SURFACE.raised }}
          onContentChange={handleContentChange}
          onSubmit={() => {
            if (!external) onSubmit();
          }}
          onKeyDown={(key: KeyEvent) => {
            if (skillTrigger !== null) {
              if (key.name === "escape") {
                key.preventDefault();
                setSkillTrigger(null);
                return;
              }
              if (skillMatches.length > 0 && (key.name === "up" || key.name === "down")) {
                key.preventDefault();
                skillNavSourceRef.current = "keyboard";
                setSkillIndex((current) => {
                  const base = current < 0 ? 0 : current;
                  return key.name === "up"
                    ? (base - 1 + skillMatches.length) % skillMatches.length
                    : (base + 1) % skillMatches.length;
                });
                return;
              }
              if (skillMatches.length > 0 && (key.name === "return" || key.name === "kpenter" || key.name === "tab")) {
                key.preventDefault();
                const picked = skillMatches[safeSkillIndex];
                if (picked !== undefined) insertSkill(picked);
                return;
              }
            }
            if (key.name === "escape") {
              if (moreOpen) {
                setMoreOpen(false);
                return;
              }
              onEscape();
              return;
            }
            // Tab while a turn runs queues the draft behind it.
            if (key.name === "tab" && key.shift !== true && running && onQueue !== undefined && (areaRef.current?.plainText ?? "").trim().length > 0) {
              key.preventDefault();
              onQueue();
              return;
            }
            // Tab takes the suggestion into the (empty) draft, to send or edit.
            if (key.name === "tab" && key.shift !== true && offeredSuggestion !== null) {
              key.preventDefault();
              areaRef.current?.setText(offeredSuggestion);
              if (areaRef.current) areaRef.current.cursorOffset = offeredSuggestion.length;
              localRef.current = offeredSuggestion;
              onInput(offeredSuggestion);
              return;
            }
            // Alt+E opens the draft externally. `meta` is Alt; ctrl+E stays
            // as the textarea's own Emacs line-end binding.
            if ((key.name === "e" || key.name === "E") && key.meta === true && key.ctrl !== true) {
              onExternalEditClick?.();
            }
          }}
        />
        {/* Breathing room between the draft and the model footer. */}
        <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised} />
        <box
          style={{
            flexDirection: "row",
            height: 1,
            flexShrink: 0,
            justifyContent: footerSegments.length > 0 ? "space-between" : "flex-start",
          }}
          backgroundColor={SURFACE.raised}
        >
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
            {onModelClick === undefined ? (
              <text fg={modelColor ?? COLOR.text} bg={SURFACE.raised} selectable={false}>
                {model}
              </text>
            ) : (
              <HoverText text={model} color={modelColor ?? COLOR.text} hoverColor={COLOR.bright} onClick={onModelClick} />
            )}
            {effort === null || effort === undefined || effort.length === 0 ? null : onEffortClick === undefined ? (
              <text fg={COLOR.warn} bg={SURFACE.raised} selectable={false}>
                {` · ${effort}`}
              </text>
            ) : (
              <HoverText text={` · ${effort}`} color={COLOR.warn} hoverColor={COLOR.bright} onClick={onEffortClick} />
            )}
            {permission === null || permission === undefined || permission.length === 0 ? null : onPermissionClick ===
              undefined ? (
              <text fg={COLOR.dim} bg={SURFACE.raised} selectable={false}>
                {` · ${permission}`}
              </text>
            ) : (
              <HoverText
                text={` · ${permission}`}
                color={COLOR.dim}
                hoverColor={COLOR.bright}
                onClick={onPermissionClick}
              />
            )}
          </box>
          {footerSegments.length === 0 ? null : (
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
              {footerSegments.map((segment, index) => (
                <box key={segment.key} style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
                  {index === 0 ? null : (
                    <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false}>
                      {"  │  "}
                    </text>
                  )}
                  {segment.node}
                </box>
              ))}
            </box>
          )}
        </box>
            </box>
            <ComposerScrollbar areaRef={areaRef} />
          </box>
        )}
      </box>
      {hideHint === true || external ? null : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "flex-end" }}>
          <text fg={COLOR.faint}>{truncate(hint, Math.max(0, width))}</text>
        </box>
      )}
    </box>
  );
}
