import { act } from "react";
import { testRender } from "@opentui/react/test-utils";

import { App, type TuiClient } from "./app.js";
import { wasModalJustDismissed } from "./model/modalDismiss.js";

/** Loud, fast failure: a bare throw skips the trailing `process.exit(0)`,
    leaving renderer handles open until the harness hangs instead of going
    red, so every scripted assertion below exits through here. */
function fail(message: string): never {
  console.error(`render-check FAILED: ${message}`);
  process.exit(1);
}

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
let emitLive: ((item: unknown) => void) | null = null;

/** A `user-input.requested` activity frame for the answer-flow steps. */
function userInputRequestedFrame(requestId: string): unknown {
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

const client: TuiClient = {
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
    emitLive = (item: unknown) => onItem(item);
    return () => {
      emitLive = null;
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

// `exitOnCtrlC` defaults true on the renderer itself (harmless in the real
// app, which passes `false` in `index.tsx` so its own quit-confirm modal
// gets the keypress) — without it here, the harness's own renderer would
// tear itself down on the ctrl+c scenario below before the app ever saw it.
const setup = await testRender(<App client={client} onQuit={() => {}} launchView="thread" />, {
  width: 140,
  height: 26,
  exitOnCtrlC: false,
});
await setup.flush();
// Markdown parses through tree-sitter off the render pass, so the first frame
// lands before message bodies exist.
await new Promise((resolve) => setTimeout(resolve, 1200));
await setup.flush();
console.log("--- settled collapsed ---");
console.log(setup.captureCharFrame());
{
  const frame = setup.captureSpans();
  const backgrounds = new Map<string, number>();
  for (const line of frame.lines) {
    for (const span of line.spans) {
      const { r, g, b } = span.bg;
      const key = [r, g, b].map((value) => Math.round(value * 255)).join(",");
      backgrounds.set(key, (backgrounds.get(key) ?? 0) + span.text.length);
    }
  }
  console.log("distinct backgrounds:", backgrounds.size);
  for (const [color, count] of [...backgrounds].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${color} -> ${count} cells`);
  }
}

// Ctrl+C opens a compact, content-sized confirm (not full-screen) with a
// dimmed backdrop behind it — left-aligned copy, right-aligned actions.
await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
await setup.flush();
console.log("--- quit confirm (ctrl+c) ---");
console.log(setup.captureCharFrame());
await act(async () => setup.mockInput.pressEscape());
await setup.flush();

// Sidebar geometry: border row, then three 3-line thread cards, then the
// settled header — clicking it is what a user does to expand the section.
await act(async () => setup.mockMouse.click(6, 24));
await setup.flush();
console.log("--- settled expanded (clicked footer header) ---");
console.log(setup.captureCharFrame());

// The timeline's own "diff …" row — the `d` keybinding is gone, so this
// click is the way a user opens it. Still near the top here (above the
// fold, no jump-pill overlap yet).
await act(async () => setup.mockMouse.click(52, 8));
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
console.log("--- turn diff expanded (clicked timeline row) ---");
console.log(setup.captureCharFrame());

// The "Worked for" fold in the chat column (top row once the prompt scrolls off).
await act(async () => setup.mockMouse.click(45, 1));
await setup.flush();
// Scroll up so the expanded cards (not just the tail) are visible.
await act(async () => setup.mockInput.pressKey("HOME"));
await setup.flush();
console.log("--- work expanded (top) ---");
console.log(setup.captureCharFrame());
// Wheel down to review the remaining cards.
for (let wheel = 0; wheel < 18; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(80, 12, "down"));
}
await setup.flush();
console.log("--- work expanded (scrolled) ---");
console.log(setup.captureCharFrame());

// Second file header inside the diff panel (below the new diff-turn header
// row and the first file's content rows).
await act(async () => setup.mockMouse.click(105, 8));
await setup.flush();
console.log("--- second file folded (clicked header) ---");
console.log(setup.captureCharFrame());

// The diff panel's own header row opens the turn picker …
await act(async () => setup.mockMouse.click(110, 1));
await setup.flush();
console.log("--- diff-turn picker (open) ---");
console.log(setup.captureCharFrame());

// … which closes back to the diff on backdrop click (the esc key calls the
// same `onClose`; the mock's `pressEscape` is sync-void while clicks are the
// proven in-harness path — the corner is outside the centered panel).
await act(async () => setup.mockMouse.click(130, 24));
await setup.flush();
console.log("--- diff-turn picker (backdrop closed) ---");
console.log(setup.captureCharFrame());

// … and jumps the timeline to the picked turn when its row is picked (Turn
// 5 here — a different turn than the open Turn 7, so the panel switches too
// and the jump must land on the settled post-open layout, at the top).
await act(async () => setup.mockMouse.click(110, 1));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 6));
await new Promise((resolve) => setTimeout(resolve, 500));
await setup.flush();
console.log("--- diff-turn picked (timeline jumped) ---");
console.log(setup.captureCharFrame());

// The command palette opens on ctrl+p from any pane.
await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
await setup.flush();
console.log("--- command palette (open) ---");
console.log(setup.captureCharFrame());

// A copy row works inline (toast where the clipboard resolves) and leaves
// the palette open for the next action.
await act(async () => setup.mockMouse.click(55, 10));
await setup.flush();
console.log("--- palette copy branch ---");
console.log(setup.captureCharFrame());

// Typing narrows the filter down to the delete action (one round trip per
// letter: a synchronous burst would reuse a stale filter closure and only
// the last letter would survive).
for (const char of ["d", "e", "l", "e", "t", "e"]) {
  await act(async () => setup.mockInput.pressKey(char));
  await setup.flush();
}
console.log("--- palette filtered ---");
console.log(setup.captureCharFrame());

// … enter arms the two-step confirm …
await act(async () => setup.mockInput.pressEnter());
await setup.flush();
console.log("--- delete armed ---");
console.log(setup.captureCharFrame());

// … and enter again dispatches (the mock server accepts), falling back to
// the next thread.
await act(async () => setup.mockInput.pressEnter());
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
console.log("--- thread deleted (fallback selected) ---");
console.log(setup.captureCharFrame());

// Rename opens its own prompt, prefilled with the current title …
await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 17));
await setup.flush();
console.log("--- rename modal (open) ---");
console.log(setup.captureCharFrame());

// … typing appends and enter submits (the mock server accepts).
await act(async () => setup.mockInput.pressKey("!"));
await setup.flush();
await act(async () => setup.mockInput.pressEnter());
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
console.log("--- rename submitted ---");
console.log(setup.captureCharFrame());

// Regenerate fires a toast and closes back to where the palette opened.
await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 16));
await setup.flush();
console.log("--- title regenerate fired ---");
console.log(setup.captureCharFrame());

// Compact dispatches a /compact turn and closes.
await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 19));
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
console.log("--- compact dispatched ---");
console.log(setup.captureCharFrame());

// Settle toasts and closes, keeping the thread selected.
await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 15));
await setup.flush();
console.log("--- thread settled ---");
console.log(setup.captureCharFrame());

// Archive last: success toasts and falls back to the next thread.
await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 18));
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
console.log("--- thread archived (fallback selected) ---");
console.log(setup.captureCharFrame());

// Back to the top of the timeline, then click the user prompt: mouse-up on
// a PromptBlock (not a selection drag) opens message actions.
await act(async () => setup.mockInput.pressKey("HOME"));
await setup.flush();
await act(async () => setup.mockMouse.click(60, 5));
await setup.flush();
console.log("--- message actions (open) ---");
console.log(setup.captureCharFrame());

// Copy closes the modal with a toast …
await act(async () => setup.mockMouse.click(55, 13));
await setup.flush();
console.log("--- message copied ---");
console.log(setup.captureCharFrame());

// … reopen (past the 250ms dismiss-guard window, which swallows the
// mouse-up half of a backdrop-dismiss gesture), arm the revert …
await new Promise((resolve) => setTimeout(resolve, 350));
await act(async () => setup.mockMouse.click(60, 5));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 14));
await setup.flush();
console.log("--- revert armed ---");
console.log(setup.captureCharFrame());

// … and confirm: the turn is still running, so the guard refuses with a
// toast instead of dispatching (the toast paints above the still-open modal).
await act(async () => setup.mockMouse.click(55, 14));
await new Promise((resolve) => setTimeout(resolve, 500));
await setup.flush();
console.log("--- revert blocked while running ---");
console.log(setup.captureCharFrame());

// Same flow on an idle thread: dismiss the modal via the backdrop first
// (it stays open on guard failure, so a bare sidebar click would only land
// on the backdrop), open t-xash from the sidebar, back to the top, and
// click the prompt again.
await act(async () => setup.mockMouse.click(130, 24));
await setup.flush();
await act(async () => setup.mockMouse.click(10, 6));
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
await act(async () => setup.mockInput.pressKey("HOME"));
await setup.flush();
await act(async () => setup.mockMouse.click(60, 5));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 14));
await setup.flush();
await act(async () => setup.mockMouse.click(55, 14));
await new Promise((resolve) => setTimeout(resolve, 500));
await setup.flush();
console.log("--- turn reverted (resynced) ---");
console.log(setup.captureCharFrame());

// The assistant's closing reply opens the same modal: back to the top and
// click the reply card below the prompt.
await act(async () => setup.mockInput.pressKey("HOME"));
await setup.flush();
console.log("--- timeline top (idle) ---");
console.log(setup.captureCharFrame());

// Wheel inside the timeline box (not the tasks/composer rows below it) to
// bring the closing reply into view.
for (let wheel = 0; wheel < 10; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
}
await setup.flush();
console.log("--- reply visible ---");
console.log(setup.captureCharFrame());

// Clicking the assistant's closing reply opens the same modal (Copy plus
// Revert, resolved through its turn).
await act(async () => setup.mockMouse.click(70, 8));
await setup.flush();
console.log("--- assistant message actions (open) ---");
console.log(setup.captureCharFrame());

// An agent question arrives mid-run: dismiss the open modal first (pending
// answers wait for a free UI), then the inline panel replaces the composer.
await act(async () => setup.mockMouse.click(130, 24));
await setup.flush();
await act(async () => {
  emitLive?.(userInputRequestedFrame("que_live1"));
});
await setup.flush();
console.log("--- answer panel (inline) ---");
console.log(setup.captureCharFrame());

// Single-select: picking the first option submits and restores the composer.
await act(async () => setup.mockMouse.click(60, 21));
await setup.flush();
console.log("--- answer submitted ---");
console.log(setup.captureCharFrame());

// Manually dismissing the "Answer submitted" toast marks the same 250ms
// swallow window as a modal dismiss: the click's mouse-up lands on timeline
// content instead of the overlay. The toast stack shifts with timing
// (auto-expiry), so locate the toast's × cell in the live frame instead of
// hardcoding its row.
// Let any earlier dismiss window expire, so the toast assertion below
// proves the × click's own mark rather than a stale one (the 2500ms toast
// easily survives the wait).
await new Promise((resolve) => setTimeout(resolve, 350));
const answerToastRows = setup.captureCharFrame().split("\n");
const answerToastRow = answerToastRows.findIndex((line) => line.includes("Answer submitted"));
if (answerToastRow === -1) fail("expected Answer submitted toast");
const answerToastX = answerToastRows[answerToastRow]?.lastIndexOf("×") ?? -1;
if (answerToastX === -1) fail("Answer submitted toast has no ×");
await act(async () => setup.mockMouse.click(answerToastX, answerToastRow));
await setup.flush();
if (!wasModalJustDismissed()) fail("toast × did not mark the dismiss window");
console.log("--- toast dismissed (manual ×) ---");
const toastDismissedFrame = setup.captureCharFrame();
console.log(toastDismissedFrame);
if (toastDismissedFrame.includes("Answer submitted")) fail("toast × did not dismiss");

// A reply click inside the window is swallowed — no message-actions modal.
// Assert the window is still held first, so a slow harness reads as a
// harness failure instead of a false behavior pass.
if (!wasModalJustDismissed()) fail("harness outran the 250ms dismiss window");
await act(async () => setup.mockMouse.click(70, 8));
await setup.flush();
console.log("--- reply click inside toast-dismiss window (swallowed) ---");
const swallowedFrame = setup.captureCharFrame();
console.log(swallowedFrame);
if (swallowedFrame.includes("Message actions"))
  fail("reply click inside toast-dismiss window opened message actions");

// Past the window the same click opens message actions.
await new Promise((resolve) => setTimeout(resolve, 350));
await act(async () => setup.mockMouse.click(70, 8));
await setup.flush();
console.log("--- reply click past window (actions open) ---");
const reopenedFrame = setup.captureCharFrame();
console.log(reopenedFrame);
if (!reopenedFrame.includes("Message actions"))
  fail("reply click past window did not open message actions");

// Backdrop-dismiss restores the closed state the answer flow below expects.
await act(async () => setup.mockMouse.click(130, 24));
await setup.flush();

// Let the backdrop-dismiss window expire, so the work-toggle assertion below
// proves the toggle's own mark rather than a stale one.
await new Promise((resolve) => setTimeout(resolve, 350));

// Expanding the Worked fold reflows the chat pane on the same click, so it
// marks the same swallow window (like opening the diff panel does). The
// toggle also pins the turn toward the top, so the frame shows the prompt
// rather than the fold itself — assert the collapsed row is gone instead.
await act(async () => setup.mockMouse.click(50, 1));
await setup.flush();
if (!wasModalJustDismissed()) fail("work toggle did not mark the dismiss window");
console.log("--- work expanded (guard marked) ---");
const workExpandedFrame = setup.captureCharFrame();
console.log(workExpandedFrame);
if (workExpandedFrame.includes("▸ Worked for")) fail("work toggle did not expand");

// Scroll down over the timeline to bring the fold and its tool-call stacks
// back into view for the tool-stack toggle below.
for (let wheel = 0; wheel < 6; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
}
await setup.flush();
console.log("--- work expanded (scrolled to tools) ---");
console.log(setup.captureCharFrame());

// Let the work-toggle window expire, so the assertion below proves the
// stack toggle's own mark. Expanding a tool-call stack reflows the chat pane
// on the same click, so it marks the same swallow window too.
await new Promise((resolve) => setTimeout(resolve, 350));
await act(async () => setup.mockMouse.click(50, 7));
await setup.flush();
if (!wasModalJustDismissed()) fail("tool-stack toggle did not mark the dismiss window");
console.log("--- tool stack toggled (guard marked) ---");
console.log(setup.captureCharFrame());

// A second request arrives inline; esc dismisses it without answering.
await act(async () => {
  emitLive?.(userInputRequestedFrame("que_live2"));
});
await setup.flush();
await act(async () => setup.mockInput.pressEscape());
await new Promise((resolve) => setTimeout(resolve, 400));
await setup.flush();
console.log("--- answer dismissed ---");
console.log(setup.captureCharFrame());

// Focus the composer and type a `$` mention: the skill picker floats above
// the composer, live-filtered by the query typed after `$`.
await act(async () => setup.mockMouse.click(60, 19));
await setup.flush();
await act(async () => setup.mockInput.pressKey("$"));
await setup.flush();
console.log("--- skill picker (unfiltered — names must stay full-width even with long descriptions) ---");
console.log(setup.captureCharFrame());
for (const char of ["p", "d"]) {
  await act(async () => setup.mockInput.pressKey(char));
  await setup.flush();
}
console.log("--- skill picker (filtered on $pd) ---");
console.log(setup.captureCharFrame());

// Enter inserts the highlighted skill and closes the picker instead of
// submitting the draft.
await act(async () => setup.mockInput.pressEnter());
await setup.flush();
console.log("--- skill inserted ---");
console.log(setup.captureCharFrame());

// A live provider-thread.updated event (Claude Code only, per the driver)
// carries `contextUsage` and surfaces the context-window footer segment.
await act(async () => {
  emitLive?.({
    kind: "event",
    event: {
      type: "provider-thread.updated",
      payload: {
        id: "pt_1",
        contextUsage: { usedTokens: 359_000, maxTokens: 1_000_000, totalProcessedTokens: 1_400_000 },
      },
    },
  });
});
await setup.flush();
console.log("--- context-usage footer segment ---");
console.log(setup.captureCharFrame());

// Clicking the segment opens the full card (%, bar, total processed, compact).
await act(async () => setup.mockMouse.click(105, 23));
await setup.flush();
console.log("--- context-usage card (open) ---");
console.log(setup.captureCharFrame());
// The card stays open (no backdrop/esc — only its × closes it, and it sits
// over the composer corner, clear of the timeline rows below). Scroll the
// timeline to the bottom: turn-2 carries a Claude-style Read. Break as soon
// as turn-2's prompt is visible instead of scrolling a fixed distance.
let bottomFrame = "";
for (let wheel = 0; wheel < 60; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  await setup.flush();
  bottomFrame = setup.captureCharFrame();
  if (bottomFrame.includes("Also fold the second")) break;
}
if (!bottomFrame.includes("Also fold the second")) fail("never scrolled to turn-2");

// The fold sits a few rows below the prompt, so nudge further down before
// locating it.
for (let wheel = 0; wheel < 6; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
}
await setup.flush();
bottomFrame = setup.captureCharFrame();

// Turn-2's work is folded with the Reads hidden behind the peek (a live
// question sorts newer), so expand its fold first. It is the only Worked
// fold in the bottom frame — turn-1's scrolled far above.
const bottomRows = bottomFrame.split("\n");
const foldRow = bottomRows.findIndex((line) => line.includes("Worked for"));
if (foldRow === -1) fail("turn-2 Worked fold not visible");
const foldGlyph = bottomRows[foldRow]?.indexOf("▸") ?? -1;
await act(async () => setup.mockMouse.click(foldGlyph === -1 ? 50 : foldGlyph, foldRow));
await setup.flush();
// The reads stack together (`read ×N`) with only the header showing, so
// expand that stack the same way before asserting the individual rows.
let stackFrame = "";
for (let wheel = 0; wheel < 40; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  await setup.flush();
  stackFrame = setup.captureCharFrame();
  if (stackFrame.includes("read ×")) break;
}
if (!stackFrame.includes("read ×")) fail("turn-2 read stack not visible");
const stackRows = stackFrame.split("\n");
const stackRow = stackRows.findIndex((line) => line.includes("read ×"));
if (stackRow === -1) fail("turn-2 read stack not visible");
const stackGlyph = stackRows[stackRow]?.indexOf("▸") ?? -1;
await act(async () => setup.mockMouse.click(stackGlyph === -1 ? 50 : stackGlyph, stackRow));
await setup.flush();
// The new rows mount below the header, so nudge down to bring them into view.
for (let wheel = 0; wheel < 4; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
}
await setup.flush();
console.log("--- read row (Read with path in header) ---");
const readRowFrame = setup.captureCharFrame();
console.log(readRowFrame);
if (!readRowFrame.includes("Read(src/tui/theme.ts)")) fail("turn-2 Read row does not render Read(path)");
if (!readRowFrame.includes("Read(src/tui/sidebar.ts)")) fail("wire-shape Read row does not resolve the detail echo");
// The List row sits below the reads — one more nudge to bring it into view.
for (let wheel = 0; wheel < 4; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
}
await setup.flush();
console.log("--- list row (List with path in header) ---");
const listRowFrame = setup.captureCharFrame();
console.log(listRowFrame);
if (!listRowFrame.includes("List(src/tui)")) fail("directory row does not render List(path)");
// The probe edits stack together (`Update ×N`) collapsed, so expand that
// stack before asserting: only its first row carries the backfilled hunks.
let inlineFrame = "";
for (let wheel = 0; wheel < 30; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  await setup.flush();
  inlineFrame = setup.captureCharFrame();
  if (inlineFrame.includes("Update ×")) break;
}
if (!inlineFrame.includes("Update ×")) fail("probe Update stack not visible");
const inlineRows = inlineFrame.split("\n");
const inlineRow = inlineRows.findIndex((line) => line.includes("Update ×"));
if (inlineRow === -1) fail("probe Update stack not visible");
const inlineGlyph = inlineRows[inlineRow]?.indexOf("▸") ?? -1;
await act(async () => setup.mockMouse.click(inlineGlyph === -1 ? 50 : inlineGlyph, inlineRow));
await setup.flush();
// The new rows mount below the header — scroll until the first row's hunks
// come into view.
for (let wheel = 0; wheel < 20; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  await setup.flush();
  inlineFrame = setup.captureCharFrame();
  if (inlineFrame.includes("+ import { DiffPanel }")) break;
}
console.log("--- update row (inline diff backfilled) ---");
console.log(inlineFrame);
if (!inlineFrame.includes("+ import { DiffPanel }")) fail("inline Update row does not render backfilled hunks");
const hunkCopies = inlineFrame.split("+ import { DiffPanel }").length - 1;
if (hunkCopies !== 1) fail(`turn hunks repeat under same-file rows (copies=${hunkCopies})`);
// Long bash commands clamp with an expander: the probe's tail marker stays
// hidden until its header is clicked, and hides again on the next click.
// The header is located fresh for every click — expanding reflows the pane,
// so stale coordinates would miss.
function probeBashHeader(): { x: number; y: number } {
  const rows = setup.captureCharFrame().split("\n");
  const y = rows.findIndex((line) => line.includes("$ bash"));
  if (y === -1) fail("probe command header not visible");
  const x = rows[y]?.indexOf("$ bash") ?? -1;
  return { x: x === -1 ? 50 : x, y };
}
let expandFrame = "";
for (let wheel = 0; wheel < 30; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  await setup.flush();
  expandFrame = setup.captureCharFrame();
  if (expandFrame.includes("$ bash")) break;
}
if (!expandFrame.includes("$ bash")) fail("probe command row not visible");
if (expandFrame.includes("# probe-tail-marker")) fail("probe command renders unclamped");
await act(async () => {
  const header = probeBashHeader();
  await setup.mockMouse.click(header.x, header.y);
});
await setup.flush();
// The new rows mount below the header — scroll until the expanded content
// comes into view.
for (let wheel = 0; wheel < 20; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "down"));
  await setup.flush();
  expandFrame = setup.captureCharFrame();
  if (expandFrame.includes("# probe-tail-marker")) break;
}
console.log("--- command row (expanded) ---");
console.log(expandFrame);
if (!expandFrame.includes("# probe-tail-marker")) fail("command header click did not expand");
await act(async () => {
  const header = probeBashHeader();
  await setup.mockMouse.click(header.x, header.y);
});
await setup.flush();
// Contracting shrinks the rows away — scroll back up until the header and
// one of its body markers are visible, then the clamped body must read
// "more lines" with the tail marker gone.
for (let wheel = 0; wheel < 30; wheel += 1) {
  await act(async () => setup.mockMouse.scroll(70, 5, "up"));
  await setup.flush();
  expandFrame = setup.captureCharFrame();
  if (expandFrame.includes("$ bash") && (expandFrame.includes("more lines") || expandFrame.includes("# probe-tail-marker")))
    break;
}
console.log("--- command row (contracted) ---");
console.log(expandFrame);
if (expandFrame.includes("# probe-tail-marker")) fail("command header click did not contract");
if (!expandFrame.includes("more lines")) fail("contracted command row lost its expander");
process.exit(0);
