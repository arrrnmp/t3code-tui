import { Terminal, Box, Text, SideTabBar, SidePanelFrame, AgentsTab, COLOR } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };
const now = Date.parse("2026-09-25T10:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const W = 60;

const threads = [
  { threadId: "child-1", title: "Audit the routes", status: "running", model: "GPT-5.5", startedAt: ago(125_000), outcome: null },
  { threadId: "child-2", title: "Scout the tests", status: "active", model: "Claude Sonnet 5", startedAt: null, outcome: "completed" },
  { threadId: "child-3", title: "Bump opentui to 0.2", status: "active", model: "grok-4", startedAt: null, outcome: "error" },
];
const subagents = [
  { agentId: "a2", agentType: "Plan", description: "Plan the route audit fixes", running: true, lastMessage: null, at: ago(42_000), stoppedAt: null },
  {
    agentId: "a1",
    agentType: "Explore",
    description: "Count TODO comments in src",
    running: false,
    lastMessage: "Found 3 call sites in src/core/threads and one stale TODO in the diff panel.",
    at: "2026-09-25T09:59:00.000Z",
    stoppedAt: "2026-09-25T09:59:14.000Z",
  },
];

function Panel({ height, rows, subs }: { height: number; rows: readonly unknown[]; subs: readonly unknown[] }) {
  const running = (rows as { status: string }[]).filter((row) => row.status === "running").length;
  const total = rows.length + subs.length;
  return (
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar
            tab="agents"
            badges={{ diff: "2", context: "42%", ...(total > 0 ? { agents: String(running > 0 ? running : total) } : {}) }}
            onTab={noop}
            onClose={noop}
            focused
            left={2}
            width={W - 4}
          />
          <SidePanelFrame
            width={W}
            height={height}
            focused
            scrollRef={scrollRef}
            onFocus={noop}
            footer={<Text fg={COLOR.dim}>{`${rows.length} delegated · ${subs.length} subagents`}</Text>}
          >
            <AgentsTab threads={rows as never} subagents={subs as never} now={now} onOpen={noop} onOpenSubagent={noop} />
          </SidePanelFrame>
        </Box>
      </Box>
  );
}

/** Delegated threads (running clock, done, failed) then the provider's own subagents. */
export function Busy() {
  return <Terminal width={60} height={22}><Panel height={22} rows={threads} subs={subagents} /></Terminal>;
}

/** A thread that has delegated nothing yet: both sections explain themselves. */
export function Empty() {
  return <Terminal width={60} height={12}><Panel height={12} rows={[]} subs={[]} /></Terminal>;
}
