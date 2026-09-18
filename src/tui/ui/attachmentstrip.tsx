import { COLOR, SURFACE, truncate } from "../theme.js";
import { formatBytes } from "../model/message.js";
import type { ImageAttachmentUpload } from "../../cli/threads/threadApi.js";

/** Chip labels cap here so one long filename can't overflow the row. */
const MAX_CHIP_NAME = 40;

/**
 * Pending attachments as wrapping chips, newest last. They flow onto
 * further rows instead of scrolling sideways, so there is no scrollbar at
 * all; clicking a chip drops it. Sits flush against the composer below;
 * `spacedTop` keeps one blank row to the tasks panel above when visible.
 */
export function AttachmentStrip({
  attachments,
  onRemove,
  spacedTop,
}: {
  attachments: readonly ImageAttachmentUpload[];
  onRemove: (index: number) => void;
  spacedTop?: boolean;
}) {
  if (attachments.length === 0) return null;
  return (
    <box
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        flexShrink: 0,
        marginTop: spacedTop === true ? 1 : 0,
        columnGap: 1,
        rowGap: 0,
        backgroundColor: SURFACE.base,
      }}
      selectable={false}
    >
      {attachments.map((attachment, index) => (
        <box
          key={`${attachment.name}-${index}`}
          style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
          backgroundColor={SURFACE.raised}
          onMouseDown={() => onRemove(index)}
          selectable={false}
        >
          <text fg={COLOR.diff} bg={SURFACE.raised} selectable={false}>{` ▣ ${truncate(attachment.name, MAX_CHIP_NAME)} (${formatBytes(attachment.sizeBytes)}) ×`}</text>
        </box>
      ))}
    </box>
  );
}
