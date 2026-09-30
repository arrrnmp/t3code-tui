import { Terminal, Box, QueuedPanel, Pager } from "@moxen/tui";

const noop = () => {};
const now = Date.parse("2026-09-26T10:00:00.000Z");

const items = [
  { turnId: "t1", messageId: "m1", text: "Also update the CHANGELOG entry for the Git tab", attachments: 0, scheduledFor: null, reason: null },
  { turnId: "t2", messageId: "m2", text: "Run bun run check after, and paste any failures", attachments: 1, scheduledFor: "2026-09-26T12:00:00.000Z", reason: "user" },
  { turnId: "t3", messageId: "m3", text: "Then open the PR against main", attachments: 0, scheduledFor: "2026-09-26T15:01:00.000Z", reason: "usage-hold" },
];

/** Three waiting messages: one behind the turn, one scheduled, one held for a usage reset. */
export function Waiting() {
  return (
    <Terminal width={80} height={6}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <QueuedPanel items={items as never} width={78} now={now} onCancel={noop} />
      </Box>
    </Terminal>
  );
}

/** Sharing the dock slot with Tasks: the ‹ 2/2 › pager sits at the header's end. */
export function WithPager() {
  return (
    <Terminal width={80} height={4}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <QueuedPanel
          items={[
            { turnId: "t4", messageId: "m4", text: "", attachments: 2, scheduledFor: null, reason: null },
            { turnId: "t5", messageId: "m5", text: "Rename useThreadOps to useThreadActions everywhere", attachments: 0, scheduledFor: null, reason: null },
          ] as never}
          width={78}
          now={now}
          onCancel={noop}
          pager={<Pager position={1} count={2} onPage={noop} />}
        />
      </Box>
    </Terminal>
  );
}
