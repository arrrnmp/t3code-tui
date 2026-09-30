import { Terminal, Box, Text, BackgroundTasksModal, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};
// Started more than an hour ago, so the runtime reads in whole minutes ("1h 12m") and holds still.
const started = (minutes: number) => new Date(Date.now() - minutes * 60_000 - 20_000).toISOString();

const TASKS = [
  { taskId: "bg-1", taskType: "local_bash", toolName: "Bash", description: "watch the build log", command: "tail -f build.log", startedAt: started(72) },
  { taskId: "bg-2", taskType: "local_bash", toolName: "Bash", description: "dev server", command: "bun run dev --port 5173", startedAt: started(95) },
  { taskId: "bg-3", taskType: null, toolName: "Monitor", description: "CI on the PR branch", command: "gh run watch --exit-status 18823412", startedAt: started(64) },
  { taskId: "bg-4", taskType: "local_agent", toolName: "Agent", description: "Explore: find every caller of markModalDismissed", command: null, startedAt: started(61) },
];

const client = {
  query: () => Promise.resolve({ available: true, lines: ["[vite] watching build.log", "✓ built in 1.84s"] }),
} as never;
const frame = { client, threadId: "t-ci", screenWidth: 90, screenHeight: 26, left: 7, top: 1, width: 76, height: 24, onClose: noop, onStop: noop };

function ChatBehind() {
  return (
    <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Fix the CI flake " titleColor={COLOR.dim} style={{ flexGrow: 1, paddingLeft: 1 }}>
      <Text fg={COLOR.user}>› Keep the dev server up and watch CI while you fix the watcher test.</Text>
      <Text fg={COLOR.text}>Started both in the background; I'll check the run once it finishes.</Text>
    </Box>
  );
}

/** The list: grouped by kind, each task its name and runtime over the command it runs. */
export function Running() {
  return (
    <Terminal width={90} height={26}>
      <ChatBehind />
      <BackgroundTasksModal {...frame} tasks={TASKS} />
    </Terminal>
  );
}

/** Nothing running: the empty state. */
export function Empty() {
  return (
    <Terminal width={90} height={16}>
      <ChatBehind />
      <BackgroundTasksModal {...frame} screenHeight={16} height={12} top={2} tasks={[]} />
    </Terminal>
  );
}
