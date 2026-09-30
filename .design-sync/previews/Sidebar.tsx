import { Terminal, Box, Sidebar, buildSidebarSections } from "@moxen/tui";

const now = Date.parse("2026-09-25T10:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const thread = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId: "p1",
  title,
  archivedAt: null,
  createdAt: ago(600_000),
  updatedAt: ago(60_000),
  ...extra,
});
const turn = (state: string, completedMs: number | null) => ({
  turnId: `turn-${state}`,
  state,
  requestedAt: ago(400_000),
  startedAt: ago(400_000),
  completedAt: completedMs === null ? null : ago(completedMs),
  assistantMessageId: null,
});

const shell = {
  snapshotSequence: 1,
  projects: [
    { id: "p1", title: "moxen", workspaceRoot: "/repo/moxen", defaultModelSelection: null },
    { id: "p2", title: "website", workspaceRoot: "/repo/website", defaultModelSelection: null },
  ],
  threads: [
    thread("parent", "Test the Agents and Background tabs", {
      latestUserMessageAt: ago(30_000),
      latestTurn: turn("running", null),
      nativeSubagents: [
        { agentId: "a1", agentType: "Explore", description: "Count TODO comments", status: "completed", startedAt: ago(500_000), stoppedAt: ago(480_000) },
        { agentId: "a2", agentType: "Plan", description: "Plan the fixes", status: "running", startedAt: ago(40_000), stoppedAt: null },
      ],
    }),
    thread("t1", "Run bun check", { parentThreadId: "parent", createdAt: ago(400_000), latestTurn: turn("completed", 300_000) }),
    thread("t2", "Summarize render-check scenarios", { parentThreadId: "parent", createdAt: ago(300_000) }),
    thread("t3", "Port the settings page to configschema", { latestTurn: turn("completed", 120_000), updatedAt: ago(120_000) }),
    thread("t4", "Landing page hero copy", { projectId: "p2", latestTurn: turn("completed", 3_600_000), updatedAt: ago(3_600_000) }),
  ],
  synchronized: true,
  unhandled: {},
};

const noop = () => {};
const handlers = {
  onOpenThread: noop,
  onOpenSubagents: noop,
  onToggleSettled: noop,
  onShowMore: noop,
  onSelectMode: noop,
  onToggleProject: noop,
  onCycleProject: noop,
  onNewThread: noop,
  onTogglePanels: noop,
  onOpenSettings: noop,
};

/** Flat view: the open thread's family — delegated threads (⇢) then native subagents (◇). */
export function ThreadTree() {
  const sections = buildSidebarSections(shell as never, { settledExpanded: false, settledLimit: 10, now });
  return (
    // The app lays panes out in a row, which stretches the sidebar to full height.
    <Terminal width={46} height={22}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
      <Sidebar sections={sections} openThreadId="parent" markedThreadIds={new Set()} settledExpanded={false} width={44} height={22} screenWidth={46} now={now} backdrop="static" panelsOpen={false} {...handlers} />
      </Box>
    </Terminal>
  );
}

/** Grouped view: threads under their project headers. */
export function Grouped() {
  const sections = buildSidebarSections(shell as never, { settledExpanded: true, settledLimit: 10, now, mode: "grouped" });
  return (
    <Terminal width={46} height={22}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
      <Sidebar sections={sections} openThreadId="t3" markedThreadIds={new Set(["t4"])} settledExpanded width={44} height={22} screenWidth={46} now={now} backdrop="off" panelsOpen {...handlers} />
      </Box>
    </Terminal>
  );
}
