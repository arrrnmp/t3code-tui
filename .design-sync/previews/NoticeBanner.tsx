import { Terminal, NoticeBanner, Text, COLOR } from "@moxen/tui";

const noop = () => {};

const usage = {
  key: "usage",
  glyph: "◔",
  glyphColor: COLOR.danger,
  title: "Usage limit reached",
  tags: [{ text: "Session limit", color: COLOR.dim }],
  detail: <Text fg={COLOR.dim}>{"  Claude resets at 3:00 PM — queued messages send then."}</Text>,
  actions: [
    { label: "Continue at reset", fg: COLOR.accent, onClick: noop },
    { label: "In a new thread", fg: COLOR.accent, onClick: noop },
    { label: "Dismiss", fg: COLOR.dim, onClick: noop },
  ],
};

const resume = {
  key: "resume",
  glyph: "◑",
  glyphColor: COLOR.warn,
  title: "Resume with less context",
  tags: [{ text: "184k of 200k tokens", color: COLOR.dim }],
  detail: <Text fg={COLOR.dim}>{"  Compacting keeps the plan and the files touched; the transcript stays readable."}</Text>,
  actions: [{ label: "Compact", fg: COLOR.accent, onClick: noop }],
};

/** One notice, actions beside the title on a wide pane. */
export function Single() {
  return (
    <Terminal width={100} height={4}>
      <NoticeBanner notices={[usage]} index={0} onPage={noop} width={100} />
    </Terminal>
  );
}

/** Two notices share the slot: the first shows with a pager. */
export function Paged() {
  return (
    <Terminal width={100} height={4}>
      <NoticeBanner notices={[resume, usage]} index={0} onPage={noop} width={100} />
    </Terminal>
  );
}

/** A narrow pane: the actions drop to their own row under the detail. */
export function Narrow() {
  return (
    <Terminal width={60} height={5}>
      <NoticeBanner notices={[usage, resume]} index={0} onPage={noop} width={60} />
    </Terminal>
  );
}

/** Tight: no tasks block above, so the rule is dropped and the blank row kept. */
export function Tight() {
  return (
    <Terminal width={100} height={3}>
      <NoticeBanner notices={[resume]} index={0} onPage={noop} width={100} tight />
    </Terminal>
  );
}
