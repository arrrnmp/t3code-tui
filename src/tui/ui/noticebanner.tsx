import type { ReactNode } from "react";

import { useHover } from "../hooks/useHover.js";
import { COLOR, SURFACE } from "../theme.js";
import { HoverButton } from "./hoverbutton.js";

export interface NoticeAction {
  label: string;
  fg: string;
  hoverFg?: string;
  onClick: () => void;
}

/** One notice over the composer: what happened, what it means, and what to do about it. */
export interface Notice {
  key: string;
  glyph: string;
  glyphColor: string;
  title: string;
  /** Short qualifiers after the title ("wrapping up", "Session limit"), each in its own colour. */
  tags?: ReadonlyArray<{ text: string; color: string }>;
  /** The second line. */
  detail: ReactNode;
  actions: ReadonlyArray<NoticeAction>;
}

function PagerArrow({ label, onClick }: { label: string; onClick: () => void }) {
  const { hovered, handlers } = useHover();
  return (
    <text fg={hovered ? COLOR.bright : COLOR.dim} {...(hovered ? { bg: SURFACE.hover } : {})} selectable={false} onMouseDown={onClick} {...handlers}>
      {label}
    </text>
  );
}

/**
 * `‹ 1/2 ›`: pages between things sharing one slot over the composer —
 * the notices here, and the Tasks / Queued panels above them.
 */
export function Pager({ position, count, onPage }: { position: number; count: number; onPage: (next: number) => void }) {
  if (count < 2) return null;
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginLeft: 2 }}>
      <PagerArrow label=" ‹ " onClick={() => onPage((position - 1 + count) % count)} />
      <text fg={COLOR.faint} selectable={false}>{`${position + 1}/${count}`}</text>
      <PagerArrow label=" › " onClick={() => onPage((position + 1) % count)} />
    </box>
  );
}

/**
 * The notices waiting over the composer (a usage limit, "resume with less
 * context"), one at a time: they compete with the chat for rows, so a
 * second one pages rather than stacking. Two lines under a rule.
 */
export function NoticeBanner({
  notices,
  index,
  onPage,
  flushTop,
  tight: tightProp,
}: {
  notices: readonly Notice[];
  index: number;
  onPage: (next: number) => void;
  /**
   * The tasks block sits directly above: its last row meets this top rule
   * with no blank row between (same flush contract as the composer's own
   * `flushTop`). Unset everywhere else, so a bare rule never stacks
   * directly onto the timeline frame's border.
   */
  flushTop?: boolean;
  /**
   * No tasks block above: the timeline frame's own border is the separator,
   * so the rule would just double it — drop the rule, keep the blank row.
   */
  tight?: boolean;
}) {
  const notice = notices[Math.min(Math.max(0, index), notices.length - 1)];
  if (notice === undefined) return null;
  const position = notices.indexOf(notice);
  const tight = tightProp === true;
  return (
    <box
      style={{ flexDirection: "column", flexShrink: 0, marginTop: flushTop === true ? 0 : 1, paddingLeft: 2, paddingRight: 2 }}
      {...(tight ? {} : { border: ["top"] as const, borderColor: SURFACE.border })}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          <text fg={notice.glyphColor} selectable={false}>{`${notice.glyph} `}</text>
          <text fg={COLOR.bright} selectable={false}>{notice.title}</text>
          {(notice.tags ?? []).map((tag) => (
            <text key={tag.text} fg={tag.color} selectable={false}>{`  ·  ${tag.text}`}</text>
          ))}
        </box>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          {notice.actions.map((action, actionIndex) => (
            <box key={action.label} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
              {actionIndex === 0 ? null : <text selectable={false}>{"  "}</text>}
              <HoverButton label={` ${action.label} `} fg={action.fg} {...(action.hoverFg === undefined ? {} : { hoverFg: action.hoverFg })} onClick={action.onClick} />
            </box>
          ))}
          <Pager position={position} count={notices.length} onPage={onPage} />
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>{notice.detail}</box>
    </box>
  );
}
