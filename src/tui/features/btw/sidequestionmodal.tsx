import { useKeyboard } from "@opentui/react";

import { ModalShell } from "../../ui/modalshell.js";
import { HoverButton } from "../../ui/hoverbutton.js";
import { markModalDismissed } from "../../model/modalDismiss.js";
import { useAnimTick } from "../../hooks/useAnimTick.js";
import { COLOR, SPINNER_FRAMES, SURFACE, truncate } from "../../theme.js";
import type { SideQuestion } from "./useSideQuestion.js";

/**
 * A `/btw` answer, over the chat. Readable text stays selectable; the
 * chrome does not. It says outright that nothing here reached the thread,
 * because a side answer that reads like part of the conversation invites
 * the user to assume the agent now knows it.
 */
export function SideQuestionModal({
  entry,
  onCopy,
  screenWidth,
  screenHeight,
  left,
  top,
  width,
  height,
  onClose,
}: {
  entry: SideQuestion;
  onCopy: (text: string) => void;
  screenWidth: number;
  screenHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const asking = entry.status === "asking";
  const tick = useAnimTick(asking, 100);
  const frame = SPINNER_FRAMES[Math.floor(tick / 100) % SPINNER_FRAMES.length] ?? "⠋";
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "esc") {
      markModalDismissed();
      onClose();
      return;
    }
    if (key.name === "c" && !key.ctrl && entry.answer !== null) onCopy(entry.answer);
  });
  const inner = Math.max(10, width - 4);
  return (
    <ModalShell screenWidth={screenWidth} screenHeight={screenHeight} left={left} top={top} width={width} height={height} onClose={onClose}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <text fg={COLOR.bright} bg={SURFACE.raised} selectable={false}>{"Side question"}</text>
        <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false}>{"esc"}</text>
      </box>
      <box style={{ flexDirection: "row", flexShrink: 0, marginTop: 1 }}>
        <text fg={COLOR.user} bg={SURFACE.raised} selectable={false}>{"/btw "}</text>
        <text fg={COLOR.text} bg={SURFACE.raised}>{entry.question}</text>
      </box>
      <scrollbox style={{ flexGrow: 1, marginTop: 1 }} stickyStart="top" backgroundColor={SURFACE.raised}>
        {asking ? (
          <text fg={COLOR.dim} bg={SURFACE.raised} selectable={false}>{`${frame} asking on a copy of this thread…`}</text>
        ) : entry.status === "failed" ? (
          <text fg={COLOR.danger} bg={SURFACE.raised}>{entry.error ?? "No answer."}</text>
        ) : (
          <text fg={COLOR.text} bg={SURFACE.raised}>{entry.answer ?? ""}</text>
        )}
      </scrollbox>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
        <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false}>
          {truncate(
            // Short enough to survive beside the copy button: the second
            // half of a longer line was the part that got cut.
            entry.withContext ? "Not added to the thread · no tools run" : "No thread context: nothing to copy yet",
            Math.max(10, inner - 24),
          )}
        </text>
        <box style={{ flexGrow: 1 }} backgroundColor={SURFACE.raised} />
        {entry.answer === null ? null : (
          <HoverButton label=" c copy " fg={COLOR.dim} hoverFg={COLOR.bright} onClick={() => onCopy(entry.answer!)} />
        )}
      </box>
    </ModalShell>
  );
}
