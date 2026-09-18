import { App, type TuiClient } from "../app/app.js";

export { App };

const HOUR = 3_600_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms).toISOString();

function thread(
  id: string,
  projectId: string,
  title: string,
  ageMs: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    projectId,
    title,
    archivedAt: null,
    branch: "main",
    updatedAt: ago(ageMs),
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    session: { status: "idle", lastError: null },
    ...extra,
  };
}

const blockedSession = {
  status: "stopped",
  lastError: "Claude usage limit reached. Send the message again once the limit resets.",
};

const shellFrames = [
  {
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 10,
      projects: [
        { id: "p-cli", title: "t3code-cli", workspaceRoot: "C:\\repo" },
        { id: "p-xash", title: "Xash3D RT Streamline", workspaceRoot: "C:\\xash" },
        { id: "p-vibe", title: "vibecheck", workspaceRoot: "C:\\vibe" },
      ],
      threads: [
        thread("t-now", "p-cli", "Message delay and scheduling", 14 * 60_000),
        thread("t-xash", "p-xash", "Neural Radiance Cache viability", 4 * HOUR, { hasPendingUserInput: true }),
        thread("t-blocked", "p-vibe", "Build VibeCheck backend", 8 * HOUR, { session: blockedSession }),
        thread("t-s1", "p-cli", "Update skills for platforms and clarity", 60_000, { settledOverride: "settled" }),
        thread("t-s2", "p-cli", "Ping pong test", 5 * 60_000, { settledOverride: "settled" }),
        thread("t-s3", "p-vibe", "Build VibeCheck analytics app", 8 * HOUR, { settledOverride: "settled" }),
        thread("t-s4", "p-vibe", "VibeCheck Docker packaging and deploy", 8 * HOUR, { settledOverride: "settled" }),
        thread("t-s5", "p-xash", "Glass PSR compositing fix", 9 * HOUR, { settledOverride: "settled" }),
        thread("t-s6", "p-cli", "Threads: delegate, snooze, views, steer", 10 * HOUR, { settledOverride: "settled" }),
        thread("t-s7", "p-cli", "Multi-agent audit coordinator", 19 * HOUR, { settledOverride: "settled" }),
        thread("t-s8", "p-cli", "Audit health.ts auth checks", 20 * HOUR, { settledOverride: "settled" }),
        thread("t-s9", "p-cli", "Audit admin.ts for missing auth", 21 * HOUR, { settledOverride: "settled" }),
        thread("t-s10", "p-cli", "users.ts missing auth checks", 22 * HOUR, { settledOverride: "settled" }),
        thread("t-s11", "p-cli", "Review project git history", 30 * HOUR, { settledOverride: "settled" }),
        thread("t-s12", "p-cli", "Rebrand and module split", 40 * HOUR, { settledOverride: "settled" }),
      ],
    },
  },
  { kind: "synchronized" },
];

const threadFrames = [
  {
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 12,
      thread: {
        id: "t-now",
        title: "Message delay and scheduling",
        session: { threadId: "t-now", status: "running", lastError: null },
        messages: [
          {
            id: "m1",
            role: "user",
            text: "Render **markdown**, plus diffs and commands ![image.png](t3-context://v1/image/image_abc)",
            context: {
              version: 1,
              records: [
                {
                  contextId: "image_abc",
                  label: "image.png",
                  kind: "image",
                  attachmentId: "thread-attachment",
                  name: "image.png",
                  mimeType: "image/png",
                  sizeBytes: 301757,
                },
              ],
            },
            // Inline TUI upload: persisted attachment, no context record.
            attachments: [
              {
                type: "image",
                id: "thread-clipboard",
                name: "clipboard-1.png",
                mimeType: "image/png",
                sizeBytes: 10244,
              },
            ],
            turnId: "turn-1",
            streaming: false,
            createdAt: ago(9 * 60_000),
            updatedAt: ago(9 * 60_000),
          },
          {
            id: "m2",
            role: "assistant",
            text: [
              "## Plan",
              "",
              "- collapse tool rows",
              "- render `unified` diffs",
              "",
              "> markdown now renders inline.",
            ].join("\n"),
            turnId: "turn-1",
            streaming: false,
            createdAt: ago(8 * 60_000),
            updatedAt: ago(8 * 60_000),
          },
          // A second, newer turn with its own checkpoint, so the harness
          // exercises the multi-turn picker and the different-turn jump.
          {
            id: "m3",
            role: "user",
            text: "Also fold the second file by default",
            turnId: "turn-2",
            streaming: false,
            createdAt: ago(1 * 60_000),
            updatedAt: ago(1 * 60_000),
          },
        ],
        checkpoints: [
          {
            turnId: "turn-1",
            checkpointTurnCount: 5,
            status: "ready",
            files: [
              { path: "src/tui/app.tsx", kind: "modified", additions: 35, deletions: 39 },
              { path: "src/tui/timeline.tsx", kind: "modified", additions: 12, deletions: 3 },
            ],
          },
          {
            turnId: "turn-2",
            checkpointTurnCount: 7,
            status: "ready",
            files: [{ path: "src/tui/diffpanel.tsx", kind: "modified", additions: 20, deletions: 4 }],
          },
        ],
        proposedPlans: [
          {
            id: "plan:t-now:turn:turn-1",
            turnId: "turn-1",
            planMarkdown: "## Plan\n\n- collapse tool rows\n- render `unified` diffs",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: ago(5 * 60_000),
            updatedAt: ago(5 * 60_000),
          },
        ],
        activities: [
          {
            id: "a0",
            tone: "tool",
            kind: "tool.completed",
            summary: "bun install",
            turnId: "turn-1",
            createdAt: ago(8 * 60_000),
            payload: {
              itemType: "command_execution",
              toolCallId: "call-0",
              status: "completed",
              title: "bun install",
              detail: "installed\n",
              data: {
                tool: "bash",
                state: {
                  status: "completed",
                  input: { command: "bun install", workdir: "C:\\repo" },
                  output: "installed\n",
                  metadata: { exit: 0 },
                  time: { start: 1000, end: 42_000 },
                },
              },
            },
          },
          {
            id: "a1",
            tone: "tool",
            kind: "tool.completed",
            summary: "bun run check",
            turnId: "turn-1",
            createdAt: ago(7 * 60_000),
            payload: {
              itemType: "command_execution",
              toolCallId: "call-1",
              status: "completed",
              title: "bun run check",
              detail: "69 passed\n",
              data: {
                tool: "bash",
                state: {
                  status: "completed",
                  input: { command: "bun run check", workdir: "C:\\repo" },
                  output: "69 passed\n",
                  metadata: { exit: 0 },
                  time: { start: 1000, end: 18_500 },
                },
              },
            },
          },
          {
            id: "a1b",
            tone: "tool",
            kind: "tool.completed",
            summary: "bun run build",
            turnId: "turn-1",
            createdAt: ago(6 * 60_000 + 30_000),
            payload: {
              itemType: "command_execution",
              toolCallId: "call-1b",
              status: "completed",
              title: "bun run build",
              detail: "bundled\n",
              data: {
                tool: "bash",
                state: {
                  status: "completed",
                  input: { command: "bun run build", workdir: "C:\\repo" },
                  output: "bundled\n",
                  metadata: { exit: 0 },
                  time: { start: 1000, end: 9_000 },
                },
              },
            },
          },
          {
            id: "a2",
            tone: "tool",
            kind: "tool.completed",
            summary: "src/tui/timeline.tsx",
            turnId: "turn-1",
            createdAt: ago(6 * 60_000),
            payload: {
              itemType: "file_change",
              toolCallId: "call-2",
              status: "completed",
              title: "src/tui/timeline.tsx",
              detail: "Edit applied successfully.",
              data: {
                tool: "edit",
                state: {
                  status: "completed",
                  input: {
                    filePath: "C:/repo/src/tui/timeline.tsx",
                    oldString: ["const MAX_DIFF_LINES = 8;", "const wrap = false;"].join("\n"),
                    newString: ["const MAX_DIFF_LINES = 14;", "const wrap = true;"].join("\n"),
                  },
                },
              },
            },
          },
          {
            id: "a3",
            tone: "tool",
            kind: "tool.completed",
            summary: "BorderStyle",
            turnId: "turn-1",
            createdAt: ago(5 * 60_000),
            payload: {
              itemType: "dynamic_tool_call",
              toolCallId: "call-3",
              status: "completed",
              title: "BorderStyle",
              detail: "Found 3 matches",
              data: {
                tool: "grep",
                state: {
                  status: "completed",
                  input: { pattern: "BorderStyle", path: "C:/repo/src", include: "*.tsx" },
                },
              },
            },
          },
          {
            id: "a4",
            tone: "tool",
            kind: "tool.completed",
            summary: "2 todos",
            turnId: "turn-1",
            createdAt: ago(4 * 60_000),
            payload: {
              itemType: "dynamic_tool_call",
              toolCallId: "call-4",
              status: "completed",
              title: "2 todos",
              detail: "",
              data: {
                tool: "todowrite",
                state: {
                  status: "completed",
                  input: {
                    todos: [
                      { content: "Collapse tool rows", status: "completed" },
                      { content: "Render unified diffs", status: "inProgress" },
                    ],
                  },
                },
              },
            },
          },
          {
            id: "a5",
            tone: "tool",
            kind: "turn.plan.updated",
            summary: "Plan updated",
            turnId: "turn-1",
            createdAt: ago(3 * 60_000),
            payload: {
              plan: [
                { step: "Collapse tool rows", status: "completed" },
                { step: "Render unified diffs", status: "inProgress" },
                { step: "Verify with render check", status: "pending" },
              ],
            },
          },
          {
            id: "a6",
            tone: "tool",
            kind: "tool.completed",
            summary: "Tool call",
            turnId: "turn-1",
            createdAt: ago(2 * 60_000),
            payload: {
              itemType: "dynamic_tool_call",
              toolCallId: "toolu_1",
              status: "completed",
              title: "Tool call",
              detail: "WebFetch: {\"url\": \"https://example.com/spec\"}",
              data: { toolName: "WebFetch", input: { url: "https://example.com/spec", prompt: "summarize" } },
            },
          },
          // Claude's real Read shape (snake_case `file_path`, generic
          // "Tool call" title) on turn-2, so the tail capture proves the
          // row renders `Read(path)` in its header. It sits below every
          // coordinate-sensitive state above, so no scripted click moves.
          {
            id: "a-read-2",
            tone: "tool",
            kind: "tool.completed",
            summary: "Tool call",
            turnId: "turn-2",
            createdAt: ago(50_000),
            payload: {
              itemType: "dynamic_tool_call",
              toolCallId: "toolu_read2",
              status: "completed",
              title: "Tool call",
              detail: 'Read: {"file_path":"C:/repo/src/tui/theme.ts"}',
              data: { toolName: "Read", input: { file_path: "C:/repo/src/tui/theme.ts" } },
            },
          },
          // Wire shape (what the TUI actually receives): the subscription
          // strips every `input`, leaving only `data.toolName` plus the
          // `Read: {json}` echo in `detail`. Must still resolve `Read(path)`,
          // never `Read(Tool call)`.
          {
            id: "a-read-wire",
            tone: "tool",
            kind: "tool.completed",
            summary: "Tool call",
            turnId: "turn-2",
            createdAt: ago(45_000),
            payload: {
              itemType: "dynamic_tool_call",
              toolCallId: "toolu_readwire",
              status: "completed",
              title: "Tool call",
              detail: 'Read: {"file_path":"C:/repo/src/tui/sidebar.ts","offset":1,"limit":5}',
              data: { toolName: "Read" },
            },
          },
          // OpenCode's nameless directory listing: empty `data`, XML result
          // dump in `detail`. Renders `List(path)`, not a raw entries dump.
          {
            id: "a-list-oc",
            tone: "tool",
            kind: "tool.completed",
            summary: "Tool call",
            turnId: "turn-2",
            createdAt: ago(40_000),
            payload: {
              itemType: "dynamic_tool_call",
              toolCallId: "oc-list-2",
              status: "completed",
              title: "src/tui",
              detail:
                "<path>/Users/aaron/Documents/t3code-cli/src/tui</path>\n<type>directory</type>\n<entries>\napp.tsx",
              data: {},
            },
          },
          // Stripped Claude Edit on turn-2 (wire shape: no input, path via
          // `data.files`) whose file matches the mock turnDiff patch, so
          // the tail capture proves stripped rows backfill inline hunks
          // from the turn checkpoint patch. Below every
          // coordinate-sensitive state above, so no scripted click moves.
          {
            id: "a-file-probe",
            tone: "tool",
            kind: "tool.completed",
            summary: "File change",
            turnId: "turn-2",
            createdAt: ago(35_000),
            payload: {
              itemType: "file_change",
              toolCallId: "toolu_probe1",
              status: "completed",
              title: "File change",
              data: { toolName: "Edit", files: [{ path: "C:/repo/src/tui/app.tsx" }] },
            },
          },
          // Second edit to the SAME file in the same turn: the turn patch is
          // net-per-file, so only the first row carries the hunks — this
          // pins that the identical hunks never repeat wallpapering the
          // transcript.
          {
            id: "a-file-probe-2",
            tone: "tool",
            kind: "tool.completed",
            summary: "File change",
            turnId: "turn-2",
            createdAt: ago(30_000),
            payload: {
              itemType: "file_change",
              toolCallId: "toolu_probe2",
              status: "completed",
              title: "File change",
              data: { toolName: "Edit", files: [{ path: "C:/repo/src/tui/app.tsx" }] },
            },
          },
          // Multi-line bash command: clamps to three lines with an expander
          // so the tail capture proves click-to-expand. Last in turn-2,
          // below every coordinate-sensitive state above.
          {
            id: "a-cmd-expand",
            tone: "tool",
            kind: "tool.completed",
            summary: "multiline probe",
            turnId: "turn-2",
            createdAt: ago(15_000),
            payload: {
              itemType: "command_execution",
              toolCallId: "call-expand-1",
              status: "completed",
              title: "multiline probe",
              detail: "",
              data: {
                tool: "bash",
                state: {
                  status: "completed",
                  input: {
                    command: "for i in 1 2 3\ndo\n  echo probe-$i\ndone\n# probe-tail-marker",
                    workdir: "/repo",
                  },
                  output: "",
                  metadata: { exit: 0 },
                  time: { start: 1000, end: 2500 },
                },
              },
            },
          },
        ],
      },
    },
  },
];

/**
 * Late live frames, fired on demand: the mock subscription stashes its
 * emitter here so scripted steps can inject traffic mid-run (an agent
 * question arriving long after mount) without polluting earlier frames.
 */
export const emitLiveRef: { current: ((item: unknown) => void) | null } = { current: null };

/** A `user-input.requested` activity frame for the answer-flow steps. */
export function userInputRequestedFrame(requestId: string): unknown {
  return {
    kind: "event",
    event: {
      type: "thread.activity-appended",
      payload: {
        activity: {
          id: "aq-live-1",
          kind: "user-input.requested",
          tone: "info",
          summary: "User input requested",
          turnId: "turn-2",
          createdAt: new Date().toISOString(),
          payload: {
            requestId,
            questions: [
              {
                id: "q-live-1",
                header: "Direction",
                question: "Which direction?",
                multiSelect: false,
                options: [
                  { label: "Forward", description: "keep going" },
                  { label: "Sideways", description: "take a detour", value: "side" },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

export const client: TuiClient = {
  subscribeShell(_options, onItem) {
    for (const frame of shellFrames) onItem(frame);
    return () => {};
  },
  subscribeThread(threadId, _options, onItem) {
    // Any thread but the running one reports an idle session, so the
    // harness can prove both the revert-during-run guard (t-now) and the
    // success + resync path (any other thread, same transcript).
    const frames =
      threadId === "t-now"
        ? threadFrames
        : threadFrames.map((frame) => {
            if (frame.kind !== "snapshot") return frame;
            return {
              ...frame,
              snapshot: {
                ...frame.snapshot,
                thread: {
                  ...frame.snapshot.thread,
                  session: { threadId, status: "idle", lastError: null },
                },
              },
            };
          });
    for (const frame of frames) onItem(frame);
    emitLiveRef.current = (item: unknown) => onItem(item);
    return () => {
      emitLiveRef.current = null;
    };
  },
  async dispatch() {
    return null;
  },
  async getConfig() {
    return {
      providers: [
        {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          displayName: "Claude",
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          models: [{ slug: "claude-opus-5", name: "Claude Opus 5", isCustom: false, isDefault: true }],
          skills: [
            // A long description that would crowd out a short name if the
            // row ever budgeted width to the description first.
            {
              name: "do",
              shortDescription:
                "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of a report or memo.",
              enabled: true,
            },
            { name: "pdf", shortDescription: "Read, edit, and create PDF files.", enabled: true },
            { name: "xlsx", shortDescription: "Spreadsheet tools.", enabled: true },
            { name: "agent-only-skill", enabled: true, userInvocable: false },
          ],
        },
      ],
    };
  },
  async turnDiff() {
    return [
      "diff --git a/src/tui/app.tsx b/src/tui/app.tsx",
      "--- a/src/tui/app.tsx",
      "+++ b/src/tui/app.tsx",
      "@@ -1,2 +1,3 @@",
      " import { useState } from \"react\";",
      "+import { DiffPanel } from \"./diffpanel.js\";",
      " const SIDEBAR_WIDTH = 38;",
      "diff --git a/src/tui/timeline.tsx b/src/tui/timeline.tsx",
      "--- a/src/tui/timeline.tsx",
      "+++ b/src/tui/timeline.tsx",
      "@@ -1,2 +1,2 @@",
      " const MAX_DIFF_LINES = 8;",
      "-const wrap = false;",
      "+const wrap = true;",
    ].join("\n");
  },
};
