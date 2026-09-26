import { useEffect, useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { ModalShell } from "../../ui/modalshell.js";
import { markModalDismissed } from "../../model/modalDismiss.js";
import { useHover } from "../../hooks/useHover.js";
import { COLOR, SURFACE, truncate } from "../../theme.js";
import {
  SECTION_LABEL,
  SETTING_SECTIONS,
  type SettingDescriptor,
  type SettingView,
  type SettingValue,
} from "../../../core/configschema.js";
import type { SettingsSnapshot } from "../../../server/api.js";

/**
 * The settings page.
 *
 * Every row is generated from the core schema table rather than written
 * here, which is the whole point: a setting added to `core/configschema.ts`
 * shows up in this page and in `moxen config set` at the same time, with
 * the same label, the same choices and the same validation. There is no
 * list of keys in this file.
 *
 * Editing is in place. Enums and booleans cycle on enter (so the common
 * case is one keystroke, no sub-modal); strings and numbers swap the row
 * for an input, because those need a cursor. Nothing is optimistic — see
 * `useSettings` — so a refused value visibly stays refused.
 */

type Row =
  | { readonly kind: "header"; readonly key: string; readonly label: string }
  | { readonly kind: "setting"; readonly key: string; readonly descriptor: SettingDescriptor; readonly value: SettingValue; readonly explicit: boolean };

function displayValue(descriptor: SettingDescriptor, value: SettingValue): string {
  if (descriptor.kind.type === "boolean") return value === true ? "on" : "off";
  if (value === undefined || value === "") return descriptor.kind.type === "string" ? "—" : "default";
  if (descriptor.kind.type === "enum") {
    return descriptor.kind.choices.find((choice) => choice.value === value)?.label ?? String(value);
  }
  if (descriptor.kind.type === "integer") return `${String(value)}${descriptor.kind.unit ?? ""}`;
  return String(value);
}

/** Enter cycles: the next choice for an enum, the other one for a boolean. */
function nextValue(descriptor: SettingDescriptor, value: SettingValue): string | null {
  if (descriptor.kind.type === "boolean") return value === true ? "false" : "true";
  if (descriptor.kind.type === "enum") {
    const choices = descriptor.kind.choices;
    const at = choices.findIndex((choice) => choice.value === value);
    return choices[(at + 1) % choices.length]?.value ?? null;
  }
  return null;
}

const editable = (descriptor: SettingDescriptor): boolean =>
  descriptor.kind.type === "string" || descriptor.kind.type === "integer" || descriptor.kind.type === "duration";

export function SettingsModal({
  snapshot,
  loading,
  saving,
  error,
  onSet,
  screenWidth,
  screenHeight,
  left,
  top,
  width,
  height,
  onClose,
}: {
  snapshot: SettingsSnapshot | null;
  loading: boolean;
  saving: string | null;
  error: string | null;
  onSet: (key: string, value: string) => void;
  screenWidth: number;
  screenHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo<readonly Row[]>(() => {
    if (!snapshot) return [];
    const out: Row[] = [];
    for (const section of SETTING_SECTIONS) {
      const inSection = snapshot.settings.filter((view: SettingView) => view.descriptor.section === section);
      if (inSection.length === 0) continue;
      out.push({ kind: "header", key: `header:${section}`, label: SECTION_LABEL[section] });
      for (const view of inSection) {
        out.push({
          kind: "setting",
          key: view.descriptor.key,
          descriptor: view.descriptor,
          value: view.value,
          explicit: view.explicit,
        });
      }
    }
    return out;
  }, [snapshot]);

  const settingRows = useMemo(() => rows.filter((row): row is Extract<Row, { kind: "setting" }> => row.kind === "setting"), [rows]);
  const safe = settingRows.length === 0 ? -1 : Math.min(index, settingRows.length - 1);
  const current = safe >= 0 ? settingRows[safe] : undefined;

  // Leaving a row abandons an edit in progress rather than carrying the
  // half-typed text onto the next setting.
  useEffect(() => setEditing(null), [safe]);

  useKeyboard((key) => {
    if (editing !== null) {
      // The input owns its own keys; only escape is taken back, so a
      // half-typed value can be abandoned without closing the page.
      if (key.name === "escape" || key.name === "esc") setEditing(null);
      return;
    }
    if (key.name === "escape" || key.name === "esc") {
      markModalDismissed();
      onClose();
      return;
    }
    if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
      setIndex((at) => Math.min(at + 1, Math.max(0, settingRows.length - 1)));
      return;
    }
    if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
      setIndex((at) => Math.max(at - 1, 0));
      return;
    }
    if (key.name === "return" || key.name === "enter" || key.name === "space") {
      if (!current) return;
      if (editable(current.descriptor)) {
        setEditing(current.descriptor.key);
        return;
      }
      const next = nextValue(current.descriptor, current.value);
      if (next !== null) onSet(current.descriptor.key, next);
    }
  });

  // Keep the selected row in view. A section header costs two lines (its
  // own, plus the blank one above it), so the row's line is counted
  // rather than assumed equal to its index — the page is long enough that
  // being off by a few puts the selection under the fold.
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const lineOf = useMemo(() => {
    const lines = new Map<string, number>();
    let line = 0;
    for (const row of rows) {
      if (row.kind === "header") line += 2;
      else {
        lines.set(row.key, line);
        line += 1;
      }
    }
    return lines;
  }, [rows]);
  const visibleRows = Math.max(1, height - 6);
  useEffect(() => {
    const pane = scrollRef.current;
    const line = current === undefined ? undefined : lineOf.get(current.descriptor.key);
    if (!pane || line === undefined) return;
    if (line < pane.scrollTop) pane.scrollTo(line);
    else if (line >= pane.scrollTop + visibleRows) pane.scrollTo(line - visibleRows + 1);
  }, [current, lineOf, visibleRows]);

  const inner = Math.max(24, width - 4);
  // Label column is fixed so the value column lines up down the page; the
  // description gets whatever is left on the row below.
  const labelWidth = Math.min(30, Math.max(16, Math.floor(inner * 0.42)));

  return (
    <ModalShell screenWidth={screenWidth} screenHeight={screenHeight} left={left} top={top} width={width} height={height} onClose={onClose}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <text fg={COLOR.bright} bg={SURFACE.raised}>{"Settings"}</text>
        <text fg={COLOR.faint} bg={SURFACE.raised}>{"esc"}</text>
      </box>
      {snapshot === null ? (
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          <text fg={COLOR.dim} bg={SURFACE.raised}>{loading ? "Reading settings…" : (error ?? "No settings available.")}</text>
        </box>
      ) : (
        <>
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
            <text fg={COLOR.faint} bg={SURFACE.raised}>
              {truncate(snapshot.exists ? snapshot.path : `${snapshot.path} (not created yet)`, inner)}
            </text>
          </box>
          <scrollbox ref={scrollRef} style={{ flexGrow: 1, marginTop: 1 }} stickyStart="top" backgroundColor={SURFACE.raised}>
            {rows.map((row) =>
              row.kind === "header" ? (
                <box key={row.key} style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
                  <text fg={COLOR.accent} bg={SURFACE.raised}>{row.label}</text>
                </box>
              ) : (
                <SettingRow
                  key={row.key}
                  descriptor={row.descriptor}
                  value={row.value}
                  explicit={row.explicit}
                  active={current?.descriptor.key === row.descriptor.key}
                  editing={editing === row.descriptor.key}
                  pending={saving === row.descriptor.key}
                  labelWidth={labelWidth}
                  width={inner}
                  onActivate={() => {
                    const at = settingRows.findIndex((candidate) => candidate.descriptor.key === row.descriptor.key);
                    if (at >= 0) setIndex(at);
                    if (editable(row.descriptor)) {
                      setEditing(row.descriptor.key);
                      return;
                    }
                    const next = nextValue(row.descriptor, row.value);
                    if (next !== null) onSet(row.descriptor.key, next);
                  }}
                  onSubmit={(text) => {
                    setEditing(null);
                    onSet(row.descriptor.key, text);
                  }}
                />
              ),
            )}
          </scrollbox>
          <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
            {error === null ? null : (
              <box style={{ flexDirection: "row", height: 1 }}>
                <text fg={COLOR.danger} bg={SURFACE.raised}>{truncate(error, inner)}</text>
              </box>
            )}
            {current === undefined ? null : (
              <box style={{ flexDirection: "row", height: 1 }}>
                <text fg={COLOR.dim} bg={SURFACE.raised}>{truncate(current.descriptor.description, inner)}</text>
              </box>
            )}
            <box style={{ flexDirection: "row", height: 1 }}>
              <text fg={COLOR.faint} bg={SURFACE.raised}>
                {truncate(
                  current !== undefined && editable(current.descriptor)
                    ? "enter edits · esc closes"
                    : "enter cycles the value · esc closes",
                  inner,
                )}
              </text>
            </box>
          </box>
        </>
      )}
    </ModalShell>
  );
}

function SettingRow({
  descriptor,
  value,
  explicit,
  active,
  editing,
  pending,
  labelWidth,
  width,
  onActivate,
  onSubmit,
}: {
  descriptor: SettingDescriptor;
  value: SettingValue;
  explicit: boolean;
  active: boolean;
  editing: boolean;
  pending: boolean;
  labelWidth: number;
  width: number;
  onActivate: () => void;
  onSubmit: (text: string) => void;
}) {
  const { hovered, handlers } = useHover();
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const bg = active ? SURFACE.hover : hovered ? SURFACE.border : SURFACE.raised;
  const label = truncate(descriptor.label, labelWidth - 1).padEnd(labelWidth, " ");
  const valueWidth = Math.max(8, width - labelWidth - 2);

  if (editing) {
    return (
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={bg}>
        <text fg={COLOR.bright} bg={bg} selectable={false}>{label}</text>
        <box style={{ flexGrow: 1, height: 1 }}>
          <input
            focused
            value={value === undefined ? "" : String(value)}
            placeholder={descriptor.kind.type === "string" ? (descriptor.kind.placeholder ?? "") : ""}
            textColor={COLOR.text}
            backgroundColor={bg}
            focusedBackgroundColor={bg}
            focusedTextColor={COLOR.bright}
            placeholderColor={COLOR.faint}
            onInput={setText}
            onSubmit={(submitted: string | object) => onSubmit(typeof submitted === "string" ? submitted : text)}
          />
        </box>
      </box>
    );
  }

  return (
    <box
      style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
      backgroundColor={bg}
      onMouseDown={onActivate}
      selectable={false}
      {...handlers}
    >
      <text fg={active ? COLOR.bright : COLOR.text} bg={bg} selectable={false}>{label}</text>
      <text fg={pending ? COLOR.faint : explicit ? COLOR.accent : COLOR.dim} bg={bg} selectable={false}>
        {truncate(`${pending ? "· " : ""}${displayValue(descriptor, value)}`, valueWidth)}
      </text>
      {descriptor.restartRequired === true ? (
        <text fg={COLOR.faint} bg={bg} selectable={false}>{"  (next start)"}</text>
      ) : null}
    </box>
  );
}
