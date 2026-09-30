import { Terminal, Box, TasksPanel, Pager } from "@moxen/tui";

const noop = () => {};
const at = "2026-09-26T10:00:00.000Z";

const steps = [
  "Read src/tui/features/gitpanel/gitpanel.tsx",
  "Align the commit columns in the history list",
  "Cap history at 200 commits with a load-more row",
  "Add a render-check scenario for the Git tab",
  "Run bun run check",
];

/** A live checklist mid-turn: done, in progress, open, with the progress gauge. */
export function InProgress() {
  const items = steps.map((content, index) => ({ content, status: index < 2 ? "completed" : index === 2 ? "inProgress" : "pending" }));
  return (
    <Terminal width={80} height={7}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <TasksPanel plan={{ items, at }} width={78} />
      </Box>
    </Terminal>
  );
}

/** Everything done: the gauge drops out; the ‹ 1/2 › pager shares the slot with Queued. */
export function AllDoneWithPager() {
  const items = steps.slice(0, 3).map((content) => ({ content, status: "completed" }));
  return (
    <Terminal width={80} height={5}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <TasksPanel plan={{ items, at }} width={78} pager={<Pager position={0} count={2} onPage={noop} />} />
      </Box>
    </Terminal>
  );
}

/** A long plan scrolls inside the panel (8 rows) with a scrollbar. */
export function LongPlan() {
  const long = [
    "Map every ClientApi query the CLI calls",
    "Add a protocol decoder for thread.subagents",
    "Serve it over the unix socket transport",
    "Route the TUI's Agents tab through the query",
    "Pin the new --json envelope golden",
    "Update ARCHITECTURE.md's server section",
    "Extend the layering test",
    "Add model tests for subagent rows",
    "Add a render-check scenario for the Agents tab",
    "Run bun run check",
    "Run moxen --json doctor against a live daemon",
  ];
  const items = long.map((content, index) => ({ content, status: index < 3 ? "completed" : index === 3 ? "inProgress" : "pending" }));
  return (
    <Terminal width={80} height={10}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <TasksPanel plan={{ items, at }} width={78} />
      </Box>
    </Terminal>
  );
}
