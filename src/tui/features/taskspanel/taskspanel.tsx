import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

import { COLOR, pulseColor, SURFACE, truncate } from "../../theme.js";
import { useAnimTick } from "../../hooks/useAnimTick.js";
import type { PlanSnapshot } from "../../model/thread.js";
import { taskCounts, taskWindow } from "../../model/tasks.js";

/** Rows shown at once; a longer checklist scrolls inside the panel. */
const MAX_TASK_ROWS = 8;

/**
 * Claude Code-style live checklist pinned above the composer: header first,
 * then one row per step. The transcript keeps its own inline plan cards;
 * this is the glanceable summary that never scrolls away. Past its row cap
 * the list scrolls (wheel, scrollbar), and follows the step being worked on
 * whenever that changes — never fighting a scroll of the user's own between.
 */
export function TasksPanel({
  plan,
  width,
  pager,
}: {
  plan: PlanSnapshot;
  width: number;
  /** The `‹ 1/2 ›` control when the Queued panel shares the slot. */
  pager?: ReactNode;
}) {
  const { done, inProgress, open } = taskCounts(plan.items);
  const remaining = inProgress + open;
  const overflows = plan.items.length > MAX_TASK_ROWS;
  // Throb the in-progress dot only while something is actually running —
  // idle cost zero once everything completes.
  const hasActive = plan.items.some((item) => item.status === "inProgress");
  const activeTick = useAnimTick(hasActive, 600);
  const activeFg = pulseColor(activeTick, COLOR.warn, COLOR.bright, 1400);
  const barWidth = Math.min(16, Math.max(6, width - 30));
  const filled = plan.items.length === 0 ? 0 : Math.round((done / plan.items.length) * barWidth);

  // Where the step being worked on sits in view (one row of context above);
  // scrolled to only when it moves, so a wheel scroll in between stays put.
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const { start: followTop } = taskWindow(plan.items, MAX_TASK_ROWS);
  useEffect(() => {
    if (!overflows) return;
    const pane = scrollRef.current;
    pane?.scrollTo(followTop);
    // On mount the rows are not laid out yet and the scroll clamps to 0:
    // apply it again once the frame has measured them.
    const retry = setTimeout(() => pane?.scrollTo(followTop), 16);
    return () => clearTimeout(retry);
  }, [followTop, overflows]);

  // Scrolled content hugs its own width, so rows are sized outright; one
  // column goes to the scrollbar when there is one.
  const rowWidth = Math.max(4, width - 2 - (overflows ? 1 : 0));
  const rows = plan.items.map((item, index) => {
    const finished = item.status === "completed";
    const active = item.status === "inProgress";
    return (
      <box key={index} style={{ width: rowWidth, flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
        <text fg={finished ? COLOR.added : active ? activeFg : COLOR.dim} bg={SURFACE.panel}>
          {finished ? "✓ " : active ? "● " : "☐ "}
        </text>
        <text fg={finished ? COLOR.dim : COLOR.text} bg={SURFACE.panel}>
          {`#${index + 1} ${truncate(item.content, Math.max(0, rowWidth - 8))}`}
        </text>
      </box>
    );
  });

  return (
    // One blank row above the header separates the block from the timeline
    // frame; below, the last row sits flush onto whatever follows (the
    // notice rule, the composer frame) — the rule/frame there separates
    // well enough on its own.
    <box
      style={{
        flexDirection: "column",
        flexShrink: 0,
        marginTop: 1,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: SURFACE.panel,
      }}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
        <text fg={COLOR.accent} bg={SURFACE.panel}>{"Tasks"}</text>
        <text fg={COLOR.dim} bg={SURFACE.panel}>{` (${done} done, ${inProgress} in progress, ${open} open) · ctrl+t to hide`}</text>
        {/* Meter only while something is left: at 100% a bare accent block
            reads as a selection artifact, not progress. Brackets make the
            partial state read as a gauge. */}
        {remaining === 0 ? null : (
          <>
            <text fg={COLOR.faint} bg={SURFACE.panel}>{" ["}</text>
            <text fg={COLOR.accent} bg={SURFACE.panel}>
              {"█".repeat(filled)}
            </text>
            <text fg={COLOR.faint} bg={SURFACE.panel}>
              {`${"░".repeat(Math.max(0, barWidth - filled))}]`}
            </text>
          </>
        )}
        {pager === undefined ? null : (
          <>
            <box style={{ flexGrow: 1 }} backgroundColor={SURFACE.panel} />
            {pager}
          </>
        )}
      </box>
      {overflows ? (
        <scrollbox
          ref={scrollRef}
          style={{ height: MAX_TASK_ROWS, flexShrink: 0, backgroundColor: SURFACE.panel }}
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
