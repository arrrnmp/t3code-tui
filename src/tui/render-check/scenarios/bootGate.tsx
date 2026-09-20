import { act } from "react";
import { testRender } from "@opentui/react/test-utils";

import { App, type TuiClient } from "../../app/app.js";
import { client } from "../fixtures.js";
import { fail } from "../helpers.js";

/**
 * Boot gate on an isolated render with a deferred mock client: the loading
 * screen names the stalled leg (threads, then transcript) until each
 * snapshot's completion marker lands, then the transcript renders. The
 * shared harness client replays everything synchronously, so this gate would
 * never be observable there.
 */
export async function runBootGate(): Promise<void> {
  let shellEmit: ((item: unknown) => void) | null = null;
  const threadEmits = new Map<string, (item: unknown) => void>();
  const deferred: TuiClient = {
    ...client,
    subscribeShell(_options, onItem) {
      shellEmit = onItem;
      return () => {
        shellEmit = null;
      };
    },
    subscribeThread(threadId, _options, onItem) {
      threadEmits.set(threadId, onItem);
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

  console.log("--- boot gate (no snapshots yet) ---");
  const waiting = setup.captureCharFrame();
  console.log(waiting);
  if (!waiting.includes("Loading threads")) fail("boot gate did not show the threads loading screen");

  const shellSnapshot = {
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 1,
      projects: [{ id: "p-boot", title: "boot", workspaceRoot: "C:\\boot" }],
      threads: [
        {
          id: "t-boot",
          projectId: "p-boot",
          title: "Boot thread",
          archivedAt: null,
          updatedAt: new Date().toISOString(),
          latestUserMessageAt: new Date().toISOString(),
          modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
          session: { status: "idle", lastError: null },
        },
      ],
    },
  };
  await act(async () => {
    shellEmit?.(shellSnapshot);
    shellEmit?.({ kind: "synchronized" });
  });
  await setup.flush();

  // Launch-selection has picked the thread and subscribed, but its snapshot
  // hasn't arrived — the gate holds on the transcript leg instead of showing
  // an empty sidebar over an empty transcript.
  console.log("--- boot gate (shell landed, thread pending) ---");
  const mid = setup.captureCharFrame();
  console.log(mid);
  if (!mid.includes("Loading transcript")) fail("boot gate did not hold on the transcript leg");
  if (!threadEmits.has("t-boot")) fail("thread subscription did not start after shell sync");

  await act(async () => {
    threadEmits.get("t-boot")?.({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          id: "t-boot",
          title: "Boot thread",
          session: { threadId: "t-boot", status: "idle", lastError: null },
          messages: [],
          activities: [],
          checkpoints: [],
          proposedPlans: [],
        },
      },
    });
    threadEmits.get("t-boot")?.({ kind: "synchronized" });
  });
  await setup.flush();

  console.log("--- boot gate (both snapshots landed) ---");
  const ready = setup.captureCharFrame();
  console.log(ready);
  if (!ready.includes("Boot thread")) fail("app did not render after both snapshots landed");

  // Deliberately no renderer.destroy(): tearing down this second renderer
  // corrupts process-global state the shared harness renderer still needs
  // (a destroy here broke a later reply click in timelineAndAnswers).
  // The harness ends in process.exit(0) like the existing shared setup,
  // which is likewise never destroyed.
}
