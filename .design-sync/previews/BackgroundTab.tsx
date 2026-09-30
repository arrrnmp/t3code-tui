import { Terminal, Box, Text, SideTabBar, SidePanelFrame, BackgroundTab, ActionText, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };
const now = Date.parse("2026-09-25T10:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const W = 60;

const tasks = [
  { taskId: "bash-1", taskType: "local_bash", description: "Run the test suite in watch mode", toolName: "Bash", command: "bun run check --watch", startedAt: ago(754_000) },
  { taskId: "mon-1", taskType: null, description: "Watch the dev server log for errors", toolName: "Monitor", command: "tail -f .moxen/server.log", startedAt: ago(95_000) },
  { taskId: "agent-1", taskType: "local_agent", description: "Review the diff panel refactor", toolName: "Agent", command: null, startedAt: ago(31_000) },
];

function Panel({ height, rows }: { height: number; rows: typeof tasks }) {
  return (
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="background" badges={{ diff: "2", context: "42%", ...(rows.length > 0 ? { background: String(rows.length) } : {}) }} onTab={noop} onClose={noop} focused left={2} width={W - 4} />
          <SidePanelFrame
            width={W}
            height={height}
            focused
            scrollRef={scrollRef}
            onFocus={noop}
            footer={
              <Box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
                <Text fg={COLOR.dim} bg={SURFACE.panel}>{`${rows.length} running  `}</Text>
                <ActionText label="View all" onClick={noop} />
              </Box>
            }
          >
            <BackgroundTab tasks={rows} width={W} now={now} onOpen={noop} onStop={noop} />
          </SidePanelFrame>
        </Box>
      </Box>
  );
}

/** A shell command, a Monitor watch and a background subagent, each with its clock and a stop action. */
export function Running() {
  return <Terminal width={60} height={16}><Panel height={16} rows={tasks} /></Terminal>;
}

/** Nothing running in the background. */
export function Idle() {
  return <Terminal width={60} height={10}><Panel height={10} rows={[]} /></Terminal>;
}
