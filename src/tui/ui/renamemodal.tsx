import { useState } from "react";
import { useKeyboard } from "@opentui/react";

import { ModalShell } from "./modalshell.js";
import { markModalDismissed } from "../model/modalDismiss.js";
import { COLOR, SURFACE, truncate } from "../theme.js";

/** Thread titles cap at 80 chars, matching the CLI handover title. */
const MAX_TITLE_LENGTH = 80;

/**
 * Single-line prompt on the shared modal chrome: prefilled value, enter
 * submits, esc/backdrop cancels. The input owns focus while mounted, so
 * keystrokes never reach the composer behind the modal. Defaults spell the
 * thread rename; the answer flow reuses it for custom answers.
 */
export function RenameModal({
  initialTitle,
  title = "Rename thread",
  placeholder = "Thread title",
  hint = "enter renames · esc cancels",
  maxLength = MAX_TITLE_LENGTH,
  screenWidth,
  screenHeight,
  left,
  top,
  width,
  height,
  onSubmit,
  onClose,
}: {
  initialTitle: string;
  title?: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  screenWidth: number;
  screenHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  // Mirrors the input buffer: the JSX `input` onSubmit type merges the
  // textarea's empty SubmitEvent with the input's string value, so the
  // handler accepts both and falls back to this mirror for non-strings.
  // `value` below stays pinned to the initial title (uncontrolled input,
  // same pattern as Composer's textarea) — this state never flows back in.
  const [text, setText] = useState(initialTitle);
  useKeyboard((key) => {
    // "esc" alias included: some inputs report the raw alias instead of the
    // canonical "escape" — same handling as PickerModal.
    if (key.name === "escape" || key.name === "esc") {
      markModalDismissed();
      onClose();
    }
  });

  const inner = Math.max(10, width - 4);

  return (
    <ModalShell screenWidth={screenWidth} screenHeight={screenHeight} left={left} top={top} width={width} height={height} onClose={onClose}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <text fg={COLOR.bright} bg={SURFACE.raised}>{title}</text>
        <text fg={COLOR.faint} bg={SURFACE.raised}>{"esc"}</text>
      </box>
      <box style={{ flexDirection: "column", height: 1, flexShrink: 0, marginTop: 1 }}>
        <input
          focused
          value={initialTitle}
          maxLength={maxLength}
          placeholder={placeholder}
          textColor={COLOR.text}
          backgroundColor={SURFACE.raised}
          focusedBackgroundColor={SURFACE.raised}
          focusedTextColor={COLOR.bright}
          placeholderColor={COLOR.faint}
          onInput={setText}
          onSubmit={(value: string | object) => onSubmit(typeof value === "string" ? value : text)}
        />
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
        <text fg={COLOR.faint} bg={SURFACE.raised}>{truncate(hint, inner)}</text>
      </box>
    </ModalShell>
  );
}
