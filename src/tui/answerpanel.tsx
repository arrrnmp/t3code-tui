import { useState } from "react";
import { useKeyboard } from "@opentui/react";

import { PICK_BG, PICK_FG } from "./pickermodal.js";
import { COLOR, SURFACE, truncate } from "./theme.js";
import type { PendingUserInputQuestion } from "./model/thread.js";

export interface AnswerRow {
  key: string;
  label: string;
  meta?: string;
  selected?: boolean;
  onPick: () => void;
}

/**
 * Inline question UI replacing the composer while an agent question is
 * pending (Claude-Code style): the question on top, one row per option with
 * its description, custom-answer and (multi-select) continue rows, and a
 * hint line. Owns its keys exactly like a modal does — the app swallows
 * every other binding while this is mounted, and `suspended` yields to the
 * custom-answer prompt on top of it.
 */
export function AnswerPanel({
  question,
  position,
  total,
  width,
  suspended,
  pickedValues,
  onToggleOption,
  onPickOption,
  onCustom,
  onContinue,
  onDismiss,
}: {
  question: PendingUserInputQuestion;
  /** 0-based position for multi-question requests. */
  position: number;
  total: number;
  /** Outer width, border included — same slot the composer fills. */
  width: number;
  /** A modal prompt is open above: ignore keys but keep rendering. */
  suspended: boolean;
  /** Option values currently toggled (multi-select). */
  pickedValues: readonly string[];
  onToggleOption: (value: string) => void;
  onPickOption: (value: string) => void;
  onCustom: () => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const [highlight, setHighlight] = useState(0);

  const rows: AnswerRow[] = [
    ...question.options.map((option, order) => {
      const value = option.value ?? option.label;
      return {
        key: `option:${order}`,
        label: `${order + 1}. ${option.label}`,
        ...(option.description !== null && option.description.length > 0
          ? { meta: truncate(option.description, 48) }
          : {}),
        selected: pickedValues.includes(value),
        onPick: () => {
          if (question.multiSelect) onToggleOption(value);
          else onPickOption(value);
        },
      };
    }),
    ...(question.allowCustomAnswer === false
      ? []
      : [{ key: "custom", label: "✎ Custom answer…", onPick: onCustom }]),
    ...(question.multiSelect
      ? [{ key: "continue", label: "Continue ✓", meta: `${pickedValues.length} picked`, onPick: onContinue }]
      : []),
  ];
  const safe = rows.length === 0 ? -1 : Math.min(highlight, rows.length - 1);

  useKeyboard((key) => {
    if (suspended || rows.length === 0) return;
    if (key.name === "escape" || key.name === "esc") {
      onDismiss();
      return;
    }
    if (key.name === "up") {
      setHighlight((current) => (current - 1 + rows.length) % rows.length);
      return;
    }
    if (key.name === "down") {
      setHighlight((current) => (current + 1) % rows.length);
      return;
    }
    if (key.name === "return" || key.name === "kpenter") {
      const row = rows[safe];
      row?.onPick();
      return;
    }
    if (key.ctrl === true || key.meta === true) return;
    const digit = /^([1-9])$/.exec(key.name);
    if (digit?.[1] !== undefined) {
      const option = question.options[Number.parseInt(digit[1], 10) - 1];
      if (option !== undefined) {
        const value = option.value ?? option.label;
        if (question.multiSelect) onToggleOption(value);
        else onPickOption(value);
      }
    }
  });

  const inner = Math.max(10, width - 4);

  return (
    <box style={{ width, flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
      <box
        border={["left"]}
        borderStyle="heavy"
        borderColor={COLOR.warn}
        style={{
          flexDirection: "column",
          backgroundColor: SURFACE.raised,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
        }}
        selectable={false}
      >
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }} backgroundColor={SURFACE.raised}>
          <text fg={COLOR.warn} bg={SURFACE.raised} selectable={false}>
            {truncate(`◈ ${question.header}${total > 1 ? ` ${position + 1}/${total}` : ""}`, inner)}
          </text>
          <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false}>
            {"esc dismisses"}
          </text>
        </box>
        <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }} backgroundColor={SURFACE.raised}>
          <text fg={COLOR.bright} bg={SURFACE.raised}>
            {question.question}
          </text>
        </box>
        <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }} backgroundColor={SURFACE.raised}>
          {rows.map((row, order) => {
            const active = order === safe;
            return (
              <box
                key={row.key}
                style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}
                backgroundColor={active ? PICK_BG : SURFACE.raised}
                onMouseDown={row.onPick}
                onMouseOver={() => setHighlight(order)}
              >
                <text fg={active ? PICK_FG : row.selected === true ? COLOR.accent : COLOR.text} bg={active ? PICK_BG : SURFACE.raised} selectable={false}>
                  {`${row.selected === true ? "● " : "  "}${truncate(row.label, Math.max(0, inner - (row.meta === undefined ? 4 : row.meta.length + 5)))}`}
                </text>
                {row.meta === undefined ? null : (
                  <text fg={active ? PICK_FG : COLOR.faint} bg={active ? PICK_BG : SURFACE.raised} selectable={false}>
                    {` ${row.meta}`}
                  </text>
                )}
              </box>
            );
          })}
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "flex-end" }}>
        <text fg={COLOR.faint}>{truncate("↑↓ move · 1-9 pick · enter selects · esc dismisses", Math.max(0, width))}</text>
      </box>
    </box>
  );
}
