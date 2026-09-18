import { useHover } from "../hooks/useHover.js";
import { formatContextUsage } from "../model/turns.js";
import { COLOR, SURFACE } from "../theme.js";

/**
 * Overlay docked to the chat pane's top-right, opened from the context-usage
 * footer segment — deliberately detached from that button (no popover sprout
 * over the composer) and never over the sidebar or diff panel. Title,
 * percent + used/max with a dismiss ×, a full-width two-tone filled bar,
 * total processed, and a full-width compact button with background hover.
 */
export function ContextUsageCard({
  usage,
  width,
  right,
  onCompact,
  onClose,
}: {
  usage: { usedTokens: number; maxTokens: number | null; totalProcessedTokens: number | null };
  width: number;
  /** Screen columns from the right edge to the chat pane's right edge. */
  right: number;
  onCompact: () => void;
  onClose: () => void;
}) {
  const display = formatContextUsage(usage);
  const barWidth = Math.max(8, width - 4);
  const filled =
    display.percent === null ? 0 : Math.round((Math.min(100, Math.max(0, display.percent)) / 100) * barWidth);
  const closeHover = useHover();
  const compactHover = useHover();

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        right,
        width,
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        borderStyle: "rounded",
        zIndex: 24,
      }}
      borderColor={SURFACE.border}
      backgroundColor={SURFACE.raised}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <text fg={COLOR.bright} bg={SURFACE.raised} selectable={false}>{"Context Window"}</text>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
          <text fg={COLOR.dim} bg={SURFACE.raised} selectable={false}>
            {display.percent === null
              ? display.usedLabel
              : `${display.percent}% · ${display.usedLabel}${display.maxLabel === null ? "" : `/${display.maxLabel}`}`}
          </text>
          <text
            fg={closeHover.hovered ? COLOR.text : COLOR.faint}
            bg={SURFACE.raised}
            selectable={false}
            onMouseDown={onClose}
            {...closeHover.handlers}
          >
            {" ×"}
          </text>
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
        <text fg={COLOR.accent} bg={SURFACE.raised} selectable={false}>
          {"█".repeat(filled)}
        </text>
        <text fg={SURFACE.border} bg={SURFACE.raised} selectable={false}>
          {"█".repeat(Math.max(0, barWidth - filled))}
        </text>
      </box>
      {display.totalProcessedLabel === null ? null : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1, justifyContent: "space-between" }}>
          <text fg={COLOR.dim} bg={SURFACE.raised} selectable={false}>{"Total processed"}</text>
          <text fg={COLOR.text} bg={SURFACE.raised} selectable={false}>{display.totalProcessedLabel}</text>
        </box>
      )}
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1, justifyContent: "center" }}
        backgroundColor={compactHover.hovered ? SURFACE.hover : SURFACE.panel}
        onMouseDown={onCompact}
        {...compactHover.handlers}
      >
        <text
          fg={compactHover.hovered ? COLOR.bright : COLOR.text}
          bg={compactHover.hovered ? SURFACE.hover : SURFACE.panel}
          selectable={false}
        >
          {"⇲ Compact context"}
        </text>
      </box>
    </box>
  );
}
