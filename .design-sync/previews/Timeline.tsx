import { Terminal, Box, Timeline, groupTurns } from "@moxen/tui";

const now = Date.parse("2026-09-26T10:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const noop = () => {};
const root = "/home/dev/code/moxen";

// TimelineEntry rows, shaped the way `model/thread.ts#timeline()` builds them.
const base = { streaming: false, tone: null, activityKind: null, message: null, activity: null, checkpoint: null, editStats: null, proposedPlan: null };
const user = (id: string, turnId: string, atMs: number, text: string) => ({
  ...base, id, turnId, at: ago(atMs), kind: "user", text,
  message: { id, role: "user", text, turnId, streaming: false, createdAt: ago(atMs), updatedAt: ago(atMs) },
});
const reply = (id: string, turnId: string, atMs: number, text: string, streaming = false) => ({
  ...base, id, turnId, at: ago(atMs), kind: "assistant", text, streaming,
  message: { id, role: "assistant", text, turnId, streaming, createdAt: ago(atMs), updatedAt: ago(atMs) },
});
const tool = (id: string, turnId: string, atMs: number, summary: string, payload: Record<string, unknown>, kind = "tool.completed") => ({
  ...base, id, turnId, at: ago(atMs), kind: "activity", text: summary, tone: "tool", activityKind: kind,
  activity: { id, tone: "tool", kind, summary, turnId, createdAt: ago(atMs), payload },
});
const bash = (id: string, turnId: string, atMs: number, command: string, output: string, seconds: number, status = "completed") =>
  tool(id, turnId, atMs, command, {
    itemType: "command_execution", toolCallId: `call-${id}`, status, title: command, detail: output,
    data: { tool: "bash", state: status === "completed"
      ? { status, input: { command, workdir: root }, output, metadata: { exit: 0 }, time: { start: 1000, end: 1000 + seconds * 1000 } }
      : { status, input: { command, workdir: root } } },
  }, status === "completed" ? "tool.completed" : "tool.updated");
const edit = (id: string, turnId: string, atMs: number, rel: string, oldString: string, newString: string) =>
  tool(id, turnId, atMs, rel, {
    itemType: "file_change", toolCallId: `call-${id}`, status: "completed", title: rel, detail: "Edit applied successfully.",
    data: { tool: "edit", state: { status: "completed", input: { filePath: `${root}/${rel}`, oldString, newString } } },
  });
const read = (id: string, turnId: string, atMs: number, rel: string) =>
  tool(id, turnId, atMs, "Tool call", {
    itemType: "dynamic_tool_call", toolCallId: `toolu_${id}`, status: "completed", title: "Tool call",
    detail: `Read: {"file_path":"${root}/${rel}"}`, data: { toolName: "Read", input: { file_path: `${root}/${rel}` } },
  });
const diff = (turnId: string, atMs: number, count: number, files: { path: string; additions: number; deletions: number }[]) => ({
  ...base, id: `diff:${turnId}`, turnId, at: ago(atMs), kind: "turn-diff", text: "",
  checkpoint: { turnId, checkpointTurnCount: count, status: "ready", files: files.map((file) => ({ ...file, kind: "modified" })) },
});

const turn1 = [
  user("m1", "turn-1", 900_000, "The Git tab's commit columns drift when a subject has an emoji. Can you align them?"),
  read("r1", "turn-1", 880_000, "src/tui/features/gitpanel/gitpanel.tsx"),
  edit("e1", "turn-1", 860_000, "src/tui/features/gitpanel/gitpanel.tsx",
    "const subject = truncate(commit.subject, room);",
    "const subject = truncate(commit.subject, room - cellWidth(commit.subject) + commit.subject.length);"),
  bash("b1", "turn-1", 830_000, "bun run check", "tsc: 0 errors\n412 pass, 0 fail\n", 21),
  reply("m2", "turn-1", 820_000, "Fixed. The subject column now budgets by **cell width**, not string length, so wide glyphs no longer push the author and date columns right.\n\n- `gitpanel.tsx`: truncate against `cellWidth()`\n- `bun run check` passes (412 tests)"),
  diff("turn-1", 820_000, 3, [{ path: "src/tui/features/gitpanel/gitpanel.tsx", additions: 4, deletions: 1 }]),
];

const modelForTurn = () => ({ name: "Claude Opus 5", color: "#DE7356" });
const modelLabel = (model: string) => ({ name: model, color: null });
const common = {
  modelForTurn, modelLabel, homeDir: "/home/dev", expandedTurn: null, scrollRef: { current: null } as never,
  onFocus: noop, onOpenDiff: noop, onToggleWork: noop, onOpenMessageActions: noop, onOpenUrl: noop,
  now, turnFileDiffs: new Map(), gitFiles: [],
};

/** A settled thread: the prompt, the collapsed "Worked for" fold, the markdown reply and the turn's diff row. */
export function Settled() {
  const groups = groupTurns(turn1 as never);
  return (
    <Terminal width={100} height={24}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
          <Timeline {...common} groups={groups} title="Align the Git tab's commit columns" subtitle="idle" expandedWork={new Map()} focused={false} width={98} sessionStatus="idle" turnStartedAt={null as never} />
        </Box>
      </Box>
    </Terminal>
  );
}

/** Work expanded: each run of tools folds under a one-line summary, split by the agent's interim notes. */
export function WorkExpanded() {
  const entries = [
    ...turn1.slice(0, 2),
    reply("n1", "turn-1", 870_000, "The subject is cut by `.length`, but an emoji is drawn **2 cells** wide, so every row with one runs a cell long. I'll budget by cell width."),
    ...turn1.slice(2),
  ];
  const groups = groupTurns(entries as never);
  return (
    <Terminal width={100} height={36}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
          <Timeline {...common} groups={groups} title="Align the Git tab's commit columns" subtitle="idle" expandedWork={new Map([["turn-1", true]])} focused width={98} sessionStatus="idle" turnStartedAt={null as never} />
        </Box>
      </Box>
    </Terminal>
  );
}

/** A turn in flight: tools render flat as they land, the command still running, the live badge in the frame. */
export function Running() {
  const entries = [
    user("m1", "turn-2", 95_000, "Run the envelope goldens and fix whatever drifted after the thread show change."),
    bash("b1", "turn-2", 80_000, "bun test src/cli/tests/envelopes", "38 pass, 2 fail\n  thread-show.json: key order differs\n  thread-list.json: key order differs\n", 6),
    read("r1", "turn-2", 60_000, "src/cli/threads/show.ts"),
    reply("m2", "turn-2", 40_000, "Both failures are the same key-order drift: `show.ts` spreads `latestTurn` before `id`. Restoring the original order now.", true),
    bash("b2", "turn-2", 10_000, "bun test src/cli/tests/envelopes", "", 0, "inProgress"),
  ];
  const groups = groupTurns(entries as never);
  return (
    <Terminal width={100} height={26}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
          <Timeline {...common} groups={groups} title="Fix envelope golden drift" subtitle="running" expandedWork={new Map()} focused width={98} sessionStatus="running" turnStartedAt={ago(95_000)} />
        </Box>
      </Box>
    </Terminal>
  );
}
