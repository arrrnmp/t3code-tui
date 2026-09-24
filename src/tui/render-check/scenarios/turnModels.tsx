import { testRender } from "@opentui/react/test-utils";

import type { MessageEnvelope, ThreadEnvelope } from "../../../core/types.js";
import type { ClientApi, ShellFrame, ThreadFrame } from "../../../server/api.js";
import { App, client } from "../fixtures.js";
import { fail } from "../helpers.js";

/**
 * Each turn keeps the model that ran it. The thread is on Claude Opus 5 now,
 * but its first turn ran on Claude Old: the timeline used to stamp the
 * thread's current model on every reply, relabelling the whole
 * conversation after a mid-thread switch.
 */
export async function runTurnModels(): Promise<void> {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const current = { instanceId: "claudeAgent", model: "claude-opus-5" };
  const message = (
    id: string,
    role: "user" | "assistant",
    text: string,
    turnId: string,
    minutesAgo: number,
  ): MessageEnvelope => ({
    id,
    role,
    text,
    turnId,
    streaming: false,
    createdAt: at(minutesAgo),
    updatedAt: at(minutesAgo),
  });
  const thread: ThreadEnvelope = {
    id: "t-models",
    projectId: "p-cli",
    title: "Switched models midway",
    archivedAt: null,
    updatedAt: at(1),
    latestUserMessageAt: at(2),
    modelSelection: current,
    session: {
      threadId: "t-models",
      status: "idle",
      providerName: "claudeAgent",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: at(1),
    },
  };
  const shellFrames: ShellFrame[] = [
    {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-cli", title: "moxen", workspaceRoot: "C:\\repo", defaultModelSelection: null }],
        threads: [thread],
      },
    },
    { kind: "synchronized" },
  ];
  const threadFrames: ThreadFrame[] = [
    {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: {
          ...thread,
          messages: [
            message("u1", "user", "First question", "turn-1", 9),
            message("a1", "assistant", "Answered by the old model.", "turn-1", 8),
            message("u2", "user", "Second question", "turn-2", 3),
            message("a2", "assistant", "Answered by the new model.", "turn-2", 2),
          ],
          activities: [],
          checkpoints: [],
          proposedPlans: [],
          turnModelSelections: {
            "turn-1": { instanceId: "claudeAgent", model: "claude-old" },
            "turn-2": current,
          },
        },
      },
    },
    { kind: "synchronized" },
  ];
  const turnsClient: ClientApi = {
    ...client,
    subscribeShell(_options, onItem) {
      for (const frame of shellFrames) onItem(frame);
      return () => {};
    },
    subscribeThread(_threadId, _options, onItem) {
      for (const frame of threadFrames) onItem(frame);
      return () => {};
    },
  };

  const setup = await testRender(<App client={turnsClient} onQuit={() => {}} launchView="thread" />, {
    width: 140,
    height: 40,
    exitOnCtrlC: false,
  });
  try {
    await setup.flush();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await setup.flush();
    const frame = setup.captureCharFrame();
    console.log("--- per-turn model labels ---");
    console.log(frame);
    const lines = frame.split("\n");
    const oldReply = lines.findIndex((line) => /Claude Old\s+·\s+\d\d:\d\d/.test(line));
    const newReply = lines.findIndex((line) => /Claude Opus 5\s+·\s+\d\d:\d\d/.test(line));
    if (oldReply === -1) fail("the first turn's reply is not labelled with the model that ran it (Claude Old)");
    if (newReply === -1) fail("the second turn's reply is not labelled with the current model (Claude Opus 5)");
    if (oldReply > newReply) fail("per-turn model labels are attached to the wrong turns");
  } finally {
    setup.renderer.destroy();
  }
}
