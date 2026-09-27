import { useHover } from "../../hooks/useHover.js";
import { COLOR, SURFACE, truncate } from "../../theme.js";

/**
 * Where the composer sits while a native subagent's conversation is open:
 * nothing can be sent to a subagent, so the slot says what is on screen and
 * how to get back to the thread.
 */
export function SubagentBar({
  title,
  state,
  width,
  onBack,
}: {
  title: string;
  /** "running", "finished in 13s", "no transcript to show", … */
  state: string;
  width: number;
  onBack: () => void;
}) {
  const { hovered, handlers } = useHover();
  const back = "← back to the thread";
  // Inside: the left border and padding (5), the glyph (2), two cells
  // before the link. The title gives way first, then "read-only" goes.
  const inner = width - 5 - 2 - back.length - 2;
  const full = `  ·  ${state}  ·  read-only`;
  const suffix = inner - full.length >= 12 ? full : `  ·  ${state}`;
  const room = Math.max(4, inner - suffix.length);
  return (
    <box
      border={["left"]}
      borderStyle="heavy"
      borderColor={COLOR.diff}
      // marginBottom: the row the composer's key hints sit on, so the bar
      // ends where the composer's card does instead of on the screen edge.
      style={{ width, flexDirection: "row", flexShrink: 0, marginTop: 1, marginBottom: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, justifyContent: "space-between" }}
      backgroundColor={SURFACE.raised}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
        <text fg={COLOR.diff} bg={SURFACE.raised} selectable={false}>{"◇ "}</text>
        <text fg={COLOR.text} bg={SURFACE.raised} selectable={false}>{truncate(title, room)}</text>
        <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false}>{suffix}</text>
      </box>
      <text
        fg={hovered ? COLOR.bright : COLOR.accent}
        bg={SURFACE.raised}
        style={{ flexShrink: 0 }}
        selectable={false}
        onMouseDown={onBack}
        {...handlers}
      >
        {back}
      </text>
    </box>
  );
}
