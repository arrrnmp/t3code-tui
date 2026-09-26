import type { ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useRef } from "react";

import { useHover } from "../../hooks/useHover.js";
import { clockTime } from "../../model/turns.js";
import type { QueuedMessage } from "../../model/thread.js";
import { COLOR, SURFACE, truncate } from "../../theme.js";

/** Rows shown at once; a longer queue scrolls inside the panel, like Tasks. */
const MAX_QUEUED_ROWS = 6;

/**
 * When a waiting message goes out. Plain queued ones go when the running
 * turn settles; the rest name their time.
 */
export function whenLabel(item: QueuedMessage, now: number): string {
  if (item.scheduledFor === null) return "after this turn";
  const at = clockTime(item.scheduledFor, now);
  // ◷, not the ⏲ emoji: terminals draw the emoji two cells wide over the space after it.
  if (item.reason === "usage-hold") return `◷ ${at}, after the reset`;
  return `◷ ${at}`;
}

function CancelButton({ onClick }: { onClick: () => void }) {
  const { hovered, handlers } = useHover();
  return (
    <text
      fg={hovered ? COLOR.danger : COLOR.faint}
      bg={hovered ? SURFACE.hover : SURFACE.panel}
      selectable={false}
      onMouseDown={onClick}
      {...handlers}
    >
      {" × "}
    </text>
  );
}

/**
 * Messages the agent has not been sent yet, pinned above the composer in
 * the Tasks slot. A queued message is not in the transcript until it is
 * sent — that is when the agent sees it — so this is the one place it is
 * visible, and where it can be taken back. It leaves the list the moment
 * it is sent and appears in the chat instead.
 */
export function QueuedPanel({
  items,
  width,
  now,
  onCancel,
  pager,
}: {
  items: readonly QueuedMessage[];
  width: number;
  now: number;
  onCancel: (turnId: string) => void;
  /** The `‹ 1/2 ›` control when Tasks shares the slot. */
  pager?: ReactNode;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const overflows = items.length > MAX_QUEUED_ROWS;
  const rowWidth = Math.max(4, width - 2 - (overflows ? 1 : 0));
  const held = items.filter((item) => item.reason === "usage-hold").length;
  const rows = items.map((item, index) => {
    const when = whenLabel(item, now);
    const extra = item.attachments > 0 ? ` +${item.attachments} image${item.attachments === 1 ? "" : "s"}` : "";
    // Cancel is 3 cells, the when-label and its gap follow the text.
    const textWidth = Math.max(4, rowWidth - 4 - when.length - 2 - extra.length - 3);
    const firstLine = item.text.split("\n")[0]?.trim() ?? "";
    return (
      <box key={item.turnId} style={{ width: rowWidth, flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
        <text fg={COLOR.dim} bg={SURFACE.panel} selectable={false}>{`${index + 1}. `}</text>
        <text fg={COLOR.text} bg={SURFACE.panel}>{truncate(firstLine || "(image only)", textWidth)}</text>
        <text fg={COLOR.faint} bg={SURFACE.panel} selectable={false}>{extra}</text>
        <box style={{ flexGrow: 1 }} backgroundColor={SURFACE.panel} />
        <text fg={item.reason === "usage-hold" ? COLOR.warn : COLOR.faint} bg={SURFACE.panel} selectable={false}>
          {`  ${when}`}
        </text>
        <CancelButton onClick={() => onCancel(item.turnId)} />
      </box>
    );
  });

  return (
    <box
      style={{ flexDirection: "column", flexShrink: 0, marginTop: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: SURFACE.panel }}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
        <text fg={COLOR.accent} bg={SURFACE.panel} selectable={false}>{"Queued"}</text>
        <text fg={COLOR.dim} bg={SURFACE.panel} selectable={false}>
          {` (${items.length} not sent yet${held > 0 ? `, ${held} held for the reset` : ""}) · × takes one back`}
        </text>
        <box style={{ flexGrow: 1 }} backgroundColor={SURFACE.panel} />
        {pager ?? null}
      </box>
      {overflows ? (
        <scrollbox
          ref={scrollRef}
          style={{ height: MAX_QUEUED_ROWS, flexShrink: 0, backgroundColor: SURFACE.panel }}
          verticalScrollbarOptions={{
            showArrows: false,
            trackOptions: { foregroundColor: COLOR.accent, backgroundColor: SURFACE.border },
          }}
        >
          {rows}
        </scrollbox>
      ) : (
        rows
      )}
    </box>
  );
}
