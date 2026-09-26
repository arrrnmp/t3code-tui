import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";

import { App } from "../../app/app.js";
import type { ClientApi, ShellFrame, ThreadFrame } from "../../../server/api.js";
import { CHAT_GUTTER, SIDEBAR_WIDTH } from "../../app/constants.js";
import { client } from "../fixtures.js";
import { fail } from "../helpers.js";

/**
 * Columns holding a full-block thumb cell. Walks spans (char frames are
 * encoding-lossy for block glyphs once piped through Bun on Windows, so
 * the in-memory spans are the only reliable witness).
 */
function thumbColumns(setup: TestRendererSetup): number[] {
  const cols: number[] = [];
  for (const line of setup.captureSpans().lines) {
    let col = 0;
    for (const span of line.spans) {
      for (const ch of span.text) {
        if (ch === "█") cols.push(col);
        col += 1;
      }
    }
  }
  return cols;
}

/**
 * Composer scrollbar on an isolated render: a short draft shows no strip
 * (it unmounts and reserves no column), an 11-line draft overflows the
 * 10-row cap and grows the accent thumb. Isolated like the boot gate —
 * typing here must not pollute the shared walkthrough's drafts — so it
 * runs last alongside it.
 */
export async function runComposerScrollbar(): Promise<void> {
  let shellEmit: ((item: unknown) => void) | null = null;
  const threadEmits = new Map<string, (item: unknown) => void>();
  const deferred: ClientApi = {
    ...client,
    subscribeShell(_options, onItem) {
      shellEmit = (item) => onItem(item as ShellFrame);
      return () => {
        shellEmit = null;
      };
    },
    subscribeThread(threadId, _options, onItem) {
      threadEmits.set(threadId, (item) => onItem(item as ThreadFrame));
      return () => {
        threadEmits.delete(threadId);
      };
    },
  };

  const setup = await testRender(<App client={deferred} onQuit={() => {}} launchView="thread" />, {
    width: 140,
    height: 26,
    exitOnCtrlC: false,
  });
  await setup.flush();
  const now = new Date().toISOString();
  await act(async () => {
    shellEmit?.({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-comp", title: "comp", workspaceRoot: "C:\\comp" }],
        threads: [
          {
            id: "t-comp",
            projectId: "p-comp",
            title: "Composer thread",
            archivedAt: null,
            updatedAt: now,
            latestUserMessageAt: now,
            modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
            session: { status: "idle", lastError: null },
          },
        ],
      },
    });
    shellEmit?.({ kind: "synchronized" });
  });
  await setup.flush();
  await act(async () => {
    threadEmits.get("t-comp")?.({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          id: "t-comp",
          title: "Composer thread",
          session: { threadId: "t-comp", status: "idle", lastError: null },
          messages: [],
          activities: [],
          checkpoints: [],
          proposedPlans: [],
        },
      },
    });
    threadEmits.get("t-comp")?.({ kind: "synchronized" });
  });
  await setup.flush();

  if (thumbColumns(setup).length > 0) fail("composer shows a scrollbar before the draft overflows");

  await act(async () => setup.mockInput.pressKey("i"));
  await setup.flush();
  // Four enters grow the composer without overflowing it: the laid-out
  // height lags the keystroke by a frame, which used to flash the strip
  // on until the next keystroke. It must never appear here.
  await act(async () => {
    for (let line = 0; line < 4; line += 1) {
      setup.mockInput.pressKey("LINEFEED");
    }
  });
  await setup.flush();
  if (thumbColumns(setup).length > 0) fail("composer flashes a scrollbar while growing within its cap");
  await act(async () => {
    for (let line = 0; line < 11; line += 1) {
      setup.mockInput.pressKey("x");
      // LINEFEED is what legacy terminals send for Ctrl+J — the composer
      // treats it as newline (never submit), unlike bare return.
      setup.mockInput.pressKey("LINEFEED");
    }
  });
  await setup.flush();

  console.log("--- composer scrollbar (overflowing draft) ---");
  console.log(setup.captureCharFrame());
  const thumbs = thumbColumns(setup);
  if (thumbs.length === 0) fail("composer shows no scrollbar on an overflowing draft");
  // The strip sits flush at the card's right edge — aligned with the
  // timeline pane border above it — not beside the textarea: no diff panel
  // is open here, so the card edge is gutter + outer pane width off the
  // sidebar. (140 is this render's explicit width.)
  const edge = SIDEBAR_WIDTH + CHAT_GUTTER + (140 - SIDEBAR_WIDTH - CHAT_GUTTER * 2) - 1;
  if (!thumbs.every((col) => col === edge)) {
    fail(`composer scrollbar is not at the card edge (thumb cols ${thumbs.join(",")}, edge ${edge})`);
  }
}
