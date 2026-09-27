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

/** Columns the pager takes when shown: margin, two arrows and "n/n". */
function pagerWidth(count: number): number {
  return count < 2 ? 0 : 2 + 3 + `${count}/${count}`.length + 3;
}

/** Columns the actions take on one row: each label padded, two apart. */
function actionsWidth(actions: ReadonlyArray<NoticeAction>): number {
  return actions.reduce((sum, action, index) => sum + action.label.length + 2 + (index === 0 ? 0 : 2), 0);
}

/**
 * The notices waiting over the composer (a usage limit, "resume with less
 * context"), one at a time: they compete with the chat for rows, so a
 * second one pages rather than stacking. Two lines under a rule — three
 * when the pane is too narrow for the actions to share the title's row
 * (a side panel or the sidebar open): they drop below the detail rather
 * than run off the edge.
 */
export function NoticeBanner({
  notices,
  index,
  onPage,
  width,
  flushTop,
  tight: tightProp,
}: {
  notices: readonly Notice[];
  index: number;
  onPage: (next: number) => void;
  /** The pane's width, padding included: decides whether the actions fit beside the title. */
  width: number;
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
  const inner = Math.max(0, width - 4);
  const pager = pagerWidth(notices.length);
  const tags = notice.tags ?? [];
  const headWidth = (count: number) => 2 + notice.title.length + tags.slice(0, count).reduce((sum, tag) => sum + 5 + tag.text.length, 0);
  // Side by side while everything fits with a gap; otherwise the actions
  // take their own row, and the title keeps as many tags as still fit
  // beside the pager.
  const inline = headWidth(tags.length) + 2 + actionsWidth(notice.actions) + pager <= inner;
  let shownTags = tags.length;
  if (!inline) while (shownTags > 0 && headWidth(shownTags) + pager > inner) shownTags -= 1;
  const actions = (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      {notice.actions.map((action, actionIndex) => (
        <box key={action.label} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          {actionIndex === 0 ? null : <text selectable={false}>{"  "}</text>}
          <HoverButton label={` ${action.label} `} fg={action.fg} {...(action.hoverFg === undefined ? {} : { hoverFg: action.hoverFg })} onClick={action.onClick} />
        </box>
      ))}
    </box>
  );
  return (
    <box
      style={{ flexDirection: "column", flexShrink: 0, marginTop: flushTop === true ? 0 : 1, paddingLeft: 2, paddingRight: 2 }}
      {...(tight ? {} : { border: ["top"] as const, borderColor: SURFACE.border })}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 1, overflow: "hidden" }}>
          <text fg={notice.glyphColor} selectable={false}>{`${notice.glyph} `}</text>
          <text fg={COLOR.bright} selectable={false}>{notice.title}</text>
          {tags.slice(0, shownTags).map((tag) => (
            <text key={tag.text} fg={tag.color} selectable={false}>{`  ·  ${tag.text}`}</text>
          ))}
        </box>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          {inline ? actions : null}
          <Pager position={position} count={notices.length} onPage={onPage} />
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, overflow: "hidden" }}>{notice.detail}</box>
      {inline ? null : <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginLeft: 1 }}>{actions}</box>}
    </box>
  );
}
