import { COLOR, pulseColor, SURFACE, truncate } from "./theme.js";
import { useAnimTick } from "./hooks/useAnimTick.js";
import type { PlanSnapshot } from "./model/thread.js";

/** Rows shown before collapsing into a "+N more" line. */
const MAX_TASK_ROWS = 8;

/**
 * Claude Code-style live checklist pinned above the composer: header first,
 * then one row per step. The transcript keeps its own inline plan cards;
 * this is the glanceable summary that never scrolls away.
 */
export function TasksPanel({ plan, width }: { plan: PlanSnapshot; width: number }) {
  const done = plan.items.filter((item) => item.status === "completed").length;
  const open = plan.items.length - done;
  const visible = plan.items.slice(0, MAX_TASK_ROWS);
  const rest = plan.items.length - visible.length;
  // Throb the in-progress dot only while something is actually running —
  // idle cost zero once everything completes.
  const hasActive = plan.items.some((item) => item.status === "inProgress");
  const activeTick = useAnimTick(hasActive, 600);
  const activeFg = pulseColor(activeTick, COLOR.warn, COLOR.bright, 1400);
  const barWidth = Math.min(16, Math.max(6, width - 30));
  const filled = plan.items.length === 0 ? 0 : Math.round((done / plan.items.length) * barWidth);

  return (
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
        <text fg={COLOR.dim} bg={SURFACE.panel}>{` (${done} done, ${open} open) · ctrl+t to hide`}</text>
        {/* Meter only while something is open: at 100% a bare accent block
            reads as a selection artifact, not progress. Brackets make the
            partial state read as a gauge. */}
        {open === 0 ? null : (
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
      </box>
      {visible.map((item, index) => {
        const finished = item.status === "completed";
        const active = item.status === "inProgress";
        return (
          <box key={index} style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
            <text fg={finished ? COLOR.added : active ? activeFg : COLOR.dim} bg={SURFACE.panel}>
              {finished ? "✓ " : active ? "● " : "☐ "}
            </text>
            <text fg={finished ? COLOR.dim : COLOR.text} bg={SURFACE.panel}>
              {`#${index + 1} ${truncate(item.content, Math.max(0, width - 8))}`}
            </text>
          </box>
        );
      })}
      {rest > 0 ? (
        <text fg={COLOR.faint} bg={SURFACE.panel}>{`… ${rest} more`}</text>
      ) : null}
    </box>
  );
}
