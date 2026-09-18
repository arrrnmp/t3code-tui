import { useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";

import { ModalShell } from "./modalshell.js";
import { markModalDismissed } from "./model/modalDismiss.js";
import { marqueeWindow } from "./model/skills.js";
import { COLOR, SURFACE, truncate } from "./theme.js";

/** Marquee tick for the highlighted row's meta text, ms per column — same cadence as the skill popup. */
const PICKER_MARQUEE_INTERVAL_MS = 350;

export interface PickerRow {
  key: string;
  label: string;
  meta?: string;
  /** Current choice: dot prefix plus highlight. */
  selected?: boolean;
  /**
   * Visible but not actionable (server support missing): dimmed, and both
   * enter and click are no-ops — the `meta` should say why (e.g. "not yet
   * supported"). Kept in the list (and in filter results) so the affordance
   * is discoverable instead of silently missing.
   */
  disabled?: boolean;
  onPick: () => void;
}

export interface PickerSection {
  header?: string;
  headerColor?: string;
  rows: PickerRow[];
}

export type PickerBody =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "list"; sections: PickerSection[] };

/** Selected-row colors, mirroring the reference Select-model modal. Shared with the answer panel. */
export const PICK_BG = "#df9f5f";
export const PICK_FG = "#221503";

/**
 * Centered modal picker in the style of T3's own Select-model menu: title
 * with esc on the right, an inline filter row, sections of rows with a
 * right-aligned meta column, and a highlighted current row. It owns its keys
 * (type to filter, arrows to move, enter to pick, escape to close); the app
 * swallows every other global binding while it is open, and the composer is
 * unfocused so keystrokes never leak into the draft.
 */
export function PickerModal({
  title,
  body,
  filter,
  onFilterChange,
  filterable,
  emptyLabel,
  screenWidth,
  screenHeight,
  left,
  top,
  width,
  height,
  onClose,
}: {
  title: string;
  body: PickerBody;
  filter: string;
  onFilterChange: (value: string) => void;
  filterable: boolean;
  emptyLabel: string;
  screenWidth: number;
  screenHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [marqueeTick, setMarqueeTick] = useState(0);

  // The highlighted row's meta text auto-scrolls instead of sitting
  // truncated or overflowing — ticks only while the modal is mounted.
  useEffect(() => {
    const timer = setInterval(() => setMarqueeTick((tick) => tick + 1), PICKER_MARQUEE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    if (body.kind !== "list") return [];
    const query = filter.trim().toLowerCase();
    const rows: PickerRow[] = [];
    for (const section of body.sections) {
      for (const row of section.rows) {
        if (query.length === 0) {
          rows.push(row);
          continue;
        }
        const haystack = `${row.label} ${row.meta ?? ""}`.toLowerCase();
        if (haystack.includes(query)) rows.push(row);
      }
    }
    return rows;
  }, [body, filter]);

  const visibleSections = useMemo(() => {
    if (body.kind !== "list") return [];
    const keys = new Set(visible.map((row) => row.key));
    return body.sections
      .map((section) => ({ ...section, rows: section.rows.filter((row) => keys.has(row.key)) }))
      .filter((section) => section.rows.length > 0);
  }, [body, visible]);

  const safe = visible.length === 0 ? -1 : Math.min(index, visible.length - 1);

  useKeyboard((key) => {
    // "esc" alias included: some inputs report the raw alias instead of the
    // canonical "escape".
    if (key.name === "escape" || key.name === "esc") {
      markModalDismissed();
      onClose();
      return;
    }
    if (visible.length === 0) {
      if (filterable && key.name === "backspace") onFilterChange(filter.slice(0, -1));
      return;
    }
    if (key.name === "return" || key.name === "kpenter") {
      const row = visible[safe];
      if (row !== undefined && row.disabled !== true) row.onPick();
      return;
    }
    if (key.name === "up") {
      setIndex((current) => (current - 1 + visible.length) % visible.length);
      return;
    }
    if (key.name === "down") {
      setIndex((current) => (current + 1) % visible.length);
      return;
    }
    if (!filterable) return;
    if (key.name === "backspace") {
      onFilterChange(filter.slice(0, -1));
      setIndex(0);
      return;
    }
    if (key.ctrl === true || key.meta === true) return;
    const sequence = key.sequence;
    if (typeof sequence === "string" && sequence.length === 1 && sequence >= " ") {
      onFilterChange(`${filter}${sequence}`);
      setIndex(0);
    }
  });

  const inner = Math.max(10, width - 4);
  const hint = filterable ? "↑↓ move · enter selects · esc closes · type to filter" : "↑↓ move · enter selects · esc closes";

  return (
    <ModalShell screenWidth={screenWidth} screenHeight={screenHeight} left={left} top={top} width={width} height={height} onClose={onClose}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <text fg={COLOR.bright} bg={SURFACE.raised}>{title}</text>
        <text fg={COLOR.faint} bg={SURFACE.raised}>{"esc"}</text>
      </box>
      {filterable ? (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
          <text fg={filter.length === 0 ? COLOR.faint : COLOR.text} bg={SURFACE.raised}>
            {filter.length === 0 ? "Search" : `${filter}▍`}
          </text>
        </box>
      ) : null}
      <scrollbox style={{ flexGrow: 1, marginTop: 1 }} stickyStart="top" contentOptions={{ paddingRight: 1 }}>
        {body.kind === "loading" ? (
          <text fg={COLOR.dim} bg={SURFACE.raised}>{" loading…"}</text>
        ) : body.kind === "error" ? (
          <text fg={COLOR.danger} bg={SURFACE.raised}>{` ${body.message}`}</text>
        ) : visibleSections.length === 0 ? (
          <text fg={COLOR.faint} bg={SURFACE.raised}>{` ${emptyLabel}`}</text>
        ) : (
          visibleSections.map((section, sectionIndex) => (
            <box key={sectionIndex} style={{ flexDirection: "column", flexShrink: 0 }}>
              {section.header === undefined ? null : (
                <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: sectionIndex === 0 ? 0 : 1 }}>
                  <text fg={section.headerColor ?? COLOR.dim} bg={SURFACE.raised}>
                    {section.header}
                  </text>
                </box>
              )}
              {section.rows.map((row) => {
                const active = visible[safe]?.key === row.key;
                const disabled = row.disabled === true;
                const rowBg = active && !disabled ? PICK_BG : SURFACE.raised;
                const labelFg = disabled ? COLOR.faint : active ? PICK_FG : row.selected === true ? COLOR.accent : COLOR.text;
                // The label is the actionable part — it never gets crowded
                // out by a long meta description. Whatever width survives
                // goes to the meta; the highlighted row's meta auto-scrolls
                // through the rest instead of sitting truncated or
                // overflowing the row.
                const labelText = truncate(`${row.selected === true ? "● " : "  "}${row.label}`, inner);
                const metaBudget = inner - labelText.length - 1;
                const metaText =
                  row.meta === undefined || row.meta.length === 0 || metaBudget < 6
                    ? null
                    : active
                      ? marqueeWindow(row.meta, metaBudget, marqueeTick)
                      : truncate(row.meta, metaBudget);
                return (
                  <box
                    key={row.key}
                    style={{ width: inner, flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}
                    backgroundColor={rowBg}
                    {...(disabled ? {} : { onMouseDown: row.onPick })}
                    onMouseOver={() => setIndex(visible.findIndex((entry) => entry.key === row.key))}
                  >
                    <text fg={labelFg} bg={rowBg} selectable={false}>
                      {labelText}
                    </text>
                    {metaText === null ? null : (
                      <text fg={active && !disabled ? PICK_FG : COLOR.faint} bg={rowBg} selectable={false}>{` ${metaText}`}</text>
                    )}
                  </box>
                );
              })}
            </box>
          ))
        )}
      </scrollbox>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
        <text fg={COLOR.faint} bg={SURFACE.raised}>{truncate(hint, inner)}</text>
      </box>
    </ModalShell>
  );
}
