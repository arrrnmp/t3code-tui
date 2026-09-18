import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";

import { useHover } from "./hooks/useHover.js";
import { useAnimTick } from "./hooks/useAnimTick.js";
import { PICK_BG, PICK_FG } from "./pickermodal.js";
import { COLOR, pulseColor, SURFACE, truncate } from "./theme.js";
import { detectSkillTrigger, filterSkills, insertSkillMention, marqueeWindow, type SkillTrigger } from "./model/skills.js";
import type { SkillSummary } from "../catalog/catalog.js";
import type { ContextUsageDisplay } from "./model/turns.js";

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

/** OpenCode caps its prompt at ~10 rows before the box scrolls internally. */
const MAX_COMPOSER_LINES = 10;
/** Resting height so the composer reads as an input card, not a status line. */
const MIN_COMPOSER_LINES = 3;

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
  flushTop,
  onModelClick,
  onEffortClick,
  onStopClick,
  onCopyClick,
  onExternalEditClick,
  editingExternally,
  submitVerb,
  running,
  width,
  hideHint,
  skills,
  contextUsage,
  onContextUsageClick,
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
  /** Pending attachments sit directly above: drop the top margin to sit flush. */
  flushTop?: boolean;
  /** Footer segments open the model/effort picker modals on click. */
  onModelClick?: () => void;
  onEffortClick?: () => void;
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
  /** Null/undefined hides the segment — the driver never reported usage for this thread. */
  contextUsage?: ContextUsageDisplay | null;
  onContextUsageClick?: () => void;
}) {
  const areaRef = useRef<TextareaRenderable | null>(null);
  const localRef = useRef(draft);
  const external = editingExternally === true;
  // No height estimate here: the textarea shrink-wraps its content, so the
  // box always fits the text exactly. A parallel width calc drifted from the
  // real wrap width and left phantom empty rows behind.
  const fullHint =
    submitVerb === "creates"
      ? "enter creates · esc cancels"
      : running
        ? "enter sends · ctrl+j newline · esc unfocus"
        : "enter sends · shift+enter newline · esc unfocus";
  const midHint =
    submitVerb === "creates"
      ? fullHint
      : running
        ? "enter sends · ctrl+j newline"
        : "enter sends · shift+enter newline";
  const shortHint = submitVerb === "creates" ? "enter creates" : "enter sends";
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
    // `draft` is read at the moment `resetKey` changes, not tracked as its
    // own dependency — see the `resetKey` doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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
    const result = insertSkillMention(text, skillTrigger, skill.name);
    const node = areaRef.current;
    if (node !== null) {
      node.setText(result.text);
      node.cursorOffset = result.cursorOffset;
    }
    localRef.current = result.text;
    onInput(result.text);
    setSkillTrigger(null);
  };

  const handleContentChange = () => {
    if (external) return;
    const text = areaRef.current?.plainText ?? "";
    localRef.current = text;
    onInput(text);
    if (skills === undefined) return;
    const cursor = areaRef.current?.cursorOffset ?? text.length;
    setSkillTrigger(detectSkillTrigger(text, cursor));
    skillNavSourceRef.current = "keyboard";
    setSkillIndex(0);
  };

  const footerSegments: Array<{ key: string; node: ReactNode }> = [];
  if (contextUsage !== undefined && contextUsage !== null) {
    footerSegments.push({
      key: "context",
      node: (
        <HoverText
          text={
            contextUsage.percent === null
              ? contextUsage.usedLabel
              : `${contextUsage.percent}% · ${contextUsage.usedLabel}${contextUsage.maxLabel === null ? "" : `/${contextUsage.maxLabel}`}`
          }
          color={COLOR.dim}
          hoverColor={COLOR.bright}
          onClick={onContextUsageClick ?? (() => undefined)}
        />
      ),
    });
  }
  if (onCopyClick !== undefined) {
    footerSegments.push({
      key: "copy",
      node: <HoverText text="⧉ copy" color={COLOR.dim} hoverColor={COLOR.bright} onClick={onCopyClick} />,
    });
  }
  if (onExternalEditClick !== undefined) {
    footerSegments.push({
      key: "external",
      node: <HoverText text="✎ external" color={COLOR.dim} hoverColor={COLOR.bright} onClick={onExternalEditClick} />,
    });
  }
  if (running && onStopClick !== undefined) {
    footerSegments.push({
      key: "stop",
      node: <HoverText text="■ stop" color={COLOR.danger} hoverColor={COLOR.bright} onClick={onStopClick} />,
    });
  }

  // Focused border breathes sky→deeper-sky while a turn runs — subtle glow,
  // static otherwise. Gated internally so idle composers never re-render.
  const borderTick = useAnimTick(running && focused, 400);
  const frameBorderColor =
    running && focused ? pulseColor(borderTick, SURFACE.borderFocus, "#0ea5e9", 2400) : focused ? SURFACE.borderFocus : SURFACE.border;

  return (
    <box style={{ width, flexDirection: "column", flexShrink: 0, marginTop: flushTop === true ? 0 : 1 }}>
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
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
        }}
        onMouseDown={onFocus}
        selectable={false}
      >
        <textarea
          ref={areaRef}
          focused={focused && !external}
          placeholder={placeholder}
          textColor={COLOR.text}
          backgroundColor={SURFACE.raised}
          focusedBackgroundColor={SURFACE.raised}
          focusedTextColor={COLOR.bright}
          placeholderColor={COLOR.faint}
          wrapMode="word"
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
              onEscape();
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
      {hideHint === true ? null : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "flex-end" }}>
          <text fg={COLOR.faint}>{truncate(hint, Math.max(0, width))}</text>
        </box>
      )}
    </box>
  );
}
