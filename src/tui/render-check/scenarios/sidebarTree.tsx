import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";

import type { ThreadEnvelope } from "../../../core/types.js";
import { Sidebar } from "../../features/sidebar/sidebar.js";
import { buildSidebarSections } from "../../model/sidebar.js";
import { fail } from "../helpers.js";

/**
 * A thread's family in the sidebar: its delegated threads (`⇢`) and then
 * its native subagents (`◇`), joined by `├` connectors and closed by one
 * `└`. A native row opens that subagent's own conversation.
 */
export async function runSidebarTree(): Promise<void> {
  const now = Date.parse("2026-09-25T10:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const thread = (id: string, title: string, extra: Partial<ThreadEnvelope> = {}): ThreadEnvelope => ({
    id,
    projectId: "p1",
    title,
    archivedAt: null,
    createdAt: ago(600_000),
    updatedAt: ago(60_000),
    ...extra,
  });
  const sections = buildSidebarSections(
    {
      snapshotSequence: 1,
      projects: [{ id: "p1", title: "moxen", workspaceRoot: "/repo", defaultModelSelection: null }],
      threads: [
        thread("parent", "Test the Agents and Background tabs", {
          latestUserMessageAt: ago(30_000),
          nativeSubagents: [
            { agentId: "a1", agentType: "Explore", description: "Count TODO comments", status: "completed", startedAt: ago(500_000), stoppedAt: ago(480_000) },
            { agentId: "a2", agentType: "Plan", description: "Plan the fixes", status: "running", startedAt: ago(40_000), stoppedAt: null },
          ],
        }),
        thread("t1", "Run bun check", {
          parentThreadId: "parent",
          createdAt: ago(400_000),
          latestTurn: { turnId: "x", state: "completed", requestedAt: ago(400_000), startedAt: ago(400_000), completedAt: ago(300_000), assistantMessageId: null },
        }),
        thread("t2", "Summarize render-check scenarios", { parentThreadId: "parent", createdAt: ago(300_000) }),
      ],
      synchronized: true,
      unhandled: {},
    },
    { settledExpanded: false, settledLimit: 10, now },
  );
  const opened: string[] = [];
  const setup = await testRender(
    <Sidebar
      sections={sections}
      openThreadId="parent"
      markedThreadIds={new Set()}
      settledExpanded={false}
      width={44}
      now={now}
      height={20}
      screenWidth={44}
      onOpenThread={() => {}}
      onOpenSubagents={(threadId, agentId) => opened.push(`${threadId}/${agentId}`)}
      onToggleSettled={() => {}}
      onShowMore={() => {}}
      onSelectMode={() => {}}
      onToggleProject={() => {}}
      onCycleProject={() => {}}
      onNewThread={() => {}}
    />,
    { width: 46, height: 20, exitOnCtrlC: false },
  );
  await setup.flush();
  const frame = setup.captureCharFrame();
  console.log("--- sidebar: delegated threads and native subagents ---");
  console.log(frame);
  const rows = frame.split("\n");
  const row = (text: string) => rows.find((line) => line.includes(text)) ?? "";
  if (!row("Run bun check").includes("├ ⇢")) fail("a delegated thread with siblings below is not joined with ├ ⇢");
  // Its task finished: ✓ like a finished subagent, not the ○ of a thread waiting on you.
  if (!/Run bun check.*✓/u.test(row("Run bun check"))) fail("a finished delegated thread does not show ✓");
  if (!/Summarize render-check.*○/u.test(row("Summarize render-check"))) fail("a delegated thread with no finished turn lost its ○");
  if (!row("Summarize render-check").includes("├ ⇢")) fail("the last delegated thread closed the family before its subagents");
  if (!row("Explore · Count TODO").includes("├ ◇")) fail("a native subagent is not listed with ├ ◇");
  if (!row("Plan · Plan the fixes").includes("└ ◇")) fail("the family's last row is not closed with └");
  const planRow = rows.findIndex((line) => line.includes("Plan · Plan the fixes"));
  await act(async () => setup.mockMouse.click(rows[planRow]!.indexOf("Plan") + 1, planRow));
  await setup.flush();
  if (opened[0] !== "parent/a2") fail("clicking a native subagent did not open its own conversation");

  // With that subagent open, its row is the open one (the ▌ marker), not
  // its thread's — and the thread row stays a way back to the thread.
  const threads: string[] = [];
  const viewing = await testRender(
    <Sidebar
      sections={sections}
      openThreadId="parent"
      openSubagentId="a2"
      markedThreadIds={new Set()}
      settledExpanded={false}
      width={44}
      now={now}
      height={20}
      screenWidth={44}
      onOpenThread={(threadId) => threads.push(threadId)}
      onOpenSubagents={() => {}}
      onToggleSettled={() => {}}
      onShowMore={() => {}}
      onSelectMode={() => {}}
      onToggleProject={() => {}}
      onCycleProject={() => {}}
      onNewThread={() => {}}
    />,
    { width: 46, height: 20, exitOnCtrlC: false },
  );
  await viewing.flush();
  const viewFrame = viewing.captureCharFrame();
  console.log("--- sidebar: a native subagent open ---");
  console.log(viewFrame);
  const viewRows = viewFrame.split("\n");
  const parentRow = viewRows.findIndex((line) => line.includes("Test the Agents"));
  if (viewRows[parentRow]!.includes("▌")) fail("the parent thread still reads as open while its subagent is");
  if (!(viewRows.find((line) => line.includes("Plan · Plan the fixes")) ?? "").includes("▌")) fail("the open subagent's row is not marked open");
  await act(async () => viewing.mockMouse.click(viewRows[parentRow]!.indexOf("Test") + 1, parentRow));
  await viewing.flush();
  if (threads[0] !== "parent") fail("clicking the parent thread row did not open the thread");

  // A family changes shape in place (children move from depth 1 to depth 0,
  // or their parent becomes a dim header): no cell of the old frame may survive.
  const shell = (threads: ThreadEnvelope[]) => ({
    snapshotSequence: 1,
    projects: [{ id: "p1", title: "moxen", workspaceRoot: "/repo", defaultModelSelection: null }],
    threads,
    synchronized: true,
    unhandled: {},
  });
  const family = [
    thread("parent", "Parent thread", { latestUserMessageAt: ago(30_000) }),
    thread("k1", "Run thread test suite", { parentThreadId: "parent", createdAt: ago(400_000) }),
    thread("k2", "Summarize render-check scenarios", { parentThreadId: "parent", createdAt: ago(300_000) }),
  ];
  const options = { settledExpanded: false, settledLimit: 10, now };
  const settledParent = [{ ...family[0]!, settledAt: ago(1_000) }, ...family.slice(1)];
  const stages = [
    ["family active", buildSidebarSections(shell(family), options)],
    ["parent settled (header rule)", buildSidebarSections(shell(settledParent), options)],
    ["parent gone (children orphaned)", buildSidebarSections(shell(family.slice(1)), options)],
    ["family active again", buildSidebarSections(shell(family), options)],
  ] as const;
  let setStage: (index: number) => void = () => {};
  const Harness = () => {
    const [index, set] = useState(0);
    setStage = set;
    return (
      <Sidebar
        sections={stages[index]![1]}
        backdrop="off"
      openThreadId={null}
        markedThreadIds={new Set()}
        settledExpanded={false}
        width={44}
        now={now}
        height={20}
        screenWidth={44}
        onOpenThread={() => {}}
        onToggleSettled={() => {}}
        onShowMore={() => {}}
        onSelectMode={() => {}}
        onToggleProject={() => {}}
        onCycleProject={() => {}}
        onNewThread={() => {}}
      />
    );
  };
  const morph = await testRender(<Harness />, { width: 46, height: 20, exitOnCtrlC: false });
  await morph.flush();
  for (const [index, [label]] of stages.entries()) {
    await act(async () => setStage(index));
    await morph.flush();
    const fresh = await testRender(
      <Sidebar
        sections={stages[index]![1]}
        backdrop="off"
      openThreadId={null}
        markedThreadIds={new Set()}
        settledExpanded={false}
        width={44}
        now={now}
        height={20}
        screenWidth={44}
        onOpenThread={() => {}}
        onToggleSettled={() => {}}
        onShowMore={() => {}}
        onSelectMode={() => {}}
        onToggleProject={() => {}}
        onCycleProject={() => {}}
        onNewThread={() => {}}
      />,
      { width: 46, height: 20, exitOnCtrlC: false },
    );
    await fresh.flush();
    const got = morph.captureCharFrame();
    console.log(`--- sidebar morph: ${label} ---`);
    console.log(got);
    if (got !== fresh.captureCharFrame()) fail(`sidebar after "${label}" differs from a fresh render (stale cells)`);
  }
}
