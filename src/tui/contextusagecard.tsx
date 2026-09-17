import { formatContextUsage } from "./model/turns.js";
import { COLOR, SURFACE } from "./theme.js";

const BAR_WIDTH = 24;

/**
 * Floats over the bottom-right of the screen (absolute, screen-relative —
 * same coordinate frame the toasts already anchor into) when the
 * context-usage footer segment is clicked. Matches T3's own card: title,
 * percent + used/max, a filled bar, total processed, and a compact button.
 */
export function ContextUsageCard({
  usage,
  width,
  onCompact,
  onClose,
}: {
  usage: { usedTokens: number; maxTokens: number | null; totalProcessedTokens: number | null };
  width: number;
  onCompact: () => void;
  onClose: () => void;
}) {
  const display = formatContextUsage(usage);
  const filled = display.percent === null ? 0 : Math.round((Math.min(100, Math.max(0, display.percent)) / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, BAR_WIDTH - filled));

  return (
    <box
      style={{
        position: "absolute",
        bottom: 2,
        right: 2,
        width,
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        zIndex: 24,
      }}
      border={["left"]}
      borderStyle="heavy"
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
          <text fg={COLOR.faint} bg={SURFACE.raised} selectable={false} onMouseDown={onClose}>
            {" ×"}
          </text>
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
        <text fg={COLOR.accent} bg={SURFACE.raised} selectable={false}>{bar}</text>
      </box>
      {display.totalProcessedLabel === null ? null : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1, justifyContent: "space-between" }}>
          <text fg={COLOR.dim} bg={SURFACE.raised} selectable={false}>{"Total processed"}</text>
          <text fg={COLOR.text} bg={SURFACE.raised} selectable={false}>{display.totalProcessedLabel}</text>
        </box>
      )}
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1, justifyContent: "center" }}
        backgroundColor={SURFACE.panel}
        onMouseDown={onCompact}
      >
        <text fg={COLOR.text} bg={SURFACE.panel} selectable={false}>{"⇲ Compact context"}</text>
      </box>
    </box>
  );
}
