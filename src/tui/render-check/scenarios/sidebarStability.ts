import { act } from "react";
import type { TestRendererSetup } from "@opentui/core/testing";

import { emitShellRef, originalShellSnapshot } from "../fixtures.js";
import { fail } from "../helpers.js";
import { SIDEBAR_WIDTH } from "../../app/constants.js";

const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function runningThread(id: string, projectId: string, title: string, sentAgoMs: number): Record<string, unknown> {
  return {
    id,
    projectId,
    title,
    archivedAt: null,
    branch: "main",
    // Touched just now by tool-call traffic — must never reorder the list.
    updatedAt: new Date().toISOString(),
    latestUserMessageAt: ago(sentAgoMs),
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    session: {
      threadId: id,
      status: "running",
      providerName: null,
      runtimeMode: "full-access",
      activeTurnId: `turn-${id}`,
      lastError: null,
      updatedAt: new Date().toISOString(),
    },
    latestTurn: {
      turnId: `turn-${id}`,
      state: "running",
      requestedAt: ago(sentAgoMs),
      startedAt: ago(sentAgoMs),
      completedAt: null,
      assistantMessageId: null,
    },
  };
}

/** First sidebar-column row containing the needle (-1 when absent). */
function sidebarRow(setup: TestRendererSetup, needle: string): number {
  const rows = setup.captureCharFrame().split("\n");
  return rows.findIndex((line) => line.slice(0, SIDEBAR_WIDTH).includes(needle));
}

function expectOrder(setup: TestRendererSetup, first: string, second: string, label: string): void {
  const firstRow = sidebarRow(setup, first);
  const secondRow = sidebarRow(setup, second);
  if (firstRow === -1) fail(`${label}: sidebar row "${first}" not visible`);
  if (secondRow === -1) fail(`${label}: sidebar row "${second}" not visible`);
  if (!(firstRow < secondRow)) fail(`${label}: expected "${first}" above "${second}"`);
}

/**
 * Running threads must not fight for the top slot: while their turns are in
 * flight the order stays pinned to when each user turn was sent (tool-call
 * touches to `updatedAt` hold no sway), and a thread moves up when its turn
 * finishes. Restores the fixture snapshot afterwards so later scenarios see
 * the original rows.
 */
export async function runSidebarStability(setup: TestRendererSetup): Promise<void> {
  expectOrder(setup, "Message delay", "Radiance", "initial sidebar");

  // Both start running; t-xash's user turn is newer, so it leads even though
  // t-now was touched more recently.
  await act(async () => {
    emitShellRef.current?.({ thread: runningThread("t-now", "p-cli", "Message delay and scheduling", 10 * MINUTE) });
    emitShellRef.current?.({ thread: runningThread("t-xash", "p-xash", "Neural Radiance Cache viability", 5 * MINUTE) });
  });
  await setup.flush();
  console.log("--- sidebar running (send order, not touch order) ---");
  console.log(setup.captureCharFrame());
  expectOrder(setup, "Radiance", "Message delay", "running threads");

  // Another tool-call touch lands on the lower thread: the order holds.
  await act(async () => {
    emitShellRef.current?.({ thread: runningThread("t-now", "p-cli", "Message delay and scheduling", 10 * MINUTE) });
  });
  await setup.flush();
  expectOrder(setup, "Radiance", "Message delay", "tool-call touch");

  // t-now's turn finishes: completion bumps it back to the top.
  await act(async () => {
    emitShellRef.current?.({
      thread: {
        ...(runningThread("t-now", "p-cli", "Message delay and scheduling", 10 * MINUTE) as Record<string, unknown>),
        session: { threadId: "t-now", status: "idle", lastError: null },
        latestTurn: {
          turnId: "turn-t-now",
          state: "completed",
          requestedAt: ago(10 * MINUTE),
          startedAt: ago(10 * MINUTE),
          completedAt: new Date().toISOString(),
          assistantMessageId: null,
        },
      },
    });
  });
  await setup.flush();
  console.log("--- sidebar after finish (completion bumps up) ---");
  console.log(setup.captureCharFrame());
  expectOrder(setup, "Message delay", "Radiance", "finished thread");

  await act(async () => {
    emitShellRef.current?.(originalShellSnapshot());
  });
  await setup.flush();
  expectOrder(setup, "Message delay", "Radiance", "restored sidebar");
}
