import { act, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";

import { Composer } from "../../features/composer/composer.js";
import { DiffPanel } from "../../features/diffpanel/diffpanel.js";
import { AgentsTab, ContextTab, SidePanelFrame, SideTabBar } from "../../features/sidepanel/sidepanel.js";
import type { SideTab } from "../../model/sidepanel.js";
import { fail } from "../helpers.js";

/**
 * The side panel's Agents and Context tabs, and the composer's plan-usage
 * gauges, on their own render (the shared walkthrough covers opening the
 * panel from the app and the Background tab). Agents lists delegated
 * threads with their state and a nudge control, then the provider's own
 * subagents; Context shows the window as a stacked bar with its categories,
 * then the plan's usage windows with reset times.
 */
export async function runSidePanelTabs(): Promise<void> {
  const now = Date.parse("2026-09-25T10:00:00.000Z");
  let showTab: ((tab: SideTab) => void) | null = null;
  const nudged: string[] = [];
  function Harness() {
    const [tab, setTab] = useState<SideTab>("agents");
    showTab = setTab;
    const scrollRef = useRef<ScrollBoxRenderable | null>(null);
    return (
      <box style={{ width: 60, height: 30, flexDirection: "column" }}>
        <SideTabBar tab={tab} badges={{ agents: "1", context: "42%" }} onTab={setTab} onClose={() => {}} />
        <SidePanelFrame width={60} focused scrollRef={scrollRef} onFocus={() => {}}>
          {tab === "agents" ? (
            <AgentsTab
              threads={[
                {
                  threadId: "child-1",
                  title: "Audit the routes",
                  status: "running",
                  model: "codex/gpt-5.5",
                  startedAt: new Date(now - 125_000).toISOString(),
                  outcome: null,
                },
                { threadId: "child-2", title: "Scout the tests", status: "active", model: "claudeAgent/claude-sonnet-5", startedAt: null, outcome: "completed" },
              ]}
              subagents={[{ agentId: "a1", agentType: "Explore", running: false, lastMessage: "Found 3 call sites", at: "2026-09-25T09:59:00.000Z" }]}
              width={60}
              now={now}
              onOpen={() => {}}
              onNudge={(threadId) => nudged.push(threadId)}
            />
          ) : (
            <ContextTab
              breakdown={{
                usedTokens: 84_000,
                maxTokens: 200_000,
                cachedInputTokens: null,
                compactsAutomatically: true,
                autoCompactThreshold: 167_000,
                estimated: false,
                categories: [
                  { name: "Messages", tokens: 60_000, kind: "used" },
                  { name: "System prompt", tokens: 24_000, kind: "used" },
                  { name: "Free space", tokens: 83_000, kind: "free" },
                  { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
                ],
              }}
              fallback={null}
              live
              usageLimits={{
                checkedAt: "2026-09-25T09:58:00.000Z",
                windows: [
                  { id: "session", kind: "session", label: "Session", usedPercent: 42, resetsAt: new Date(now + 2 * 3_600_000).toISOString() },
                  { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 91, resetsAt: new Date(now + 3 * 86_400_000).toISOString() },
                ],
                unavailable: null,
              }}
              providerName="Claude"
              width={60}
              now={now}
            />
          )}
        </SidePanelFrame>
      </box>
    );
  }
  const setup = await testRender(<Harness />, { width: 62, height: 32, exitOnCtrlC: false });
  await setup.flush();
  const agents = setup.captureCharFrame();
  console.log("--- side panel: agents tab ---");
  console.log(agents);
  for (const expected of ["Agents 1", "Context 42%", "Delegated threads", "Audit the routes", "2m 5s", "codex/gpt-5.5", "nudge", "Scout the tests", "Explore", "Found 3 call sites"]) {
    if (!agents.includes(expected)) fail(`agents tab is missing "${expected}"`);
  }
  const rows = agents.split("\n");
  const nudgeRow = rows.findIndex((row) => row.includes("codex/gpt-5.5"));
  await act(async () => setup.mockMouse.click(rows[nudgeRow]!.indexOf("nudge") + 1, nudgeRow));
  await setup.flush();
  if (nudged[0] !== "child-1") fail("nudge on a delegated thread did not target that thread");

  await act(async () => showTab?.("context"));
  await setup.flush();
  const context = setup.captureCharFrame();
  console.log("--- side panel: context tab ---");
  console.log(context);
  for (const expected of ["Context usage", "84k / 200k", "42%", "Messages", "System prompt", "Free space", "Auto-compact window", "Plan usage", "Session", "Weekly", "91%", "↻ 2h"]) {
    if (!context.includes(expected)) fail(`context tab is missing "${expected}"`);
  }

  // The composer footer: gauges per window, shed before the model label
  // when the composer narrows (as it does beside an open panel).
  function Footer({ width }: { width: number }) {
    return (
      <Composer
        draft=""
        resetKey="k"
        onInput={() => {}}
        onSubmit={() => {}}
        onEscape={() => {}}
        onFocus={() => {}}
        focused={false}
        placeholder="Message the agent"
        model="Claude Opus 5"
        permission="Full access"
        submitVerb="sends"
        running={false}
        width={width}
        contextUsage={{ percent: 42, usedLabel: "84k", maxLabel: "200k", totalProcessedLabel: null, costLabel: null }}
        planUsage={[
          { short: "5h", percent: 42 },
          { short: "wk", percent: 91 },
        ]}
        onCopyClick={() => {}}
        onExternalEditClick={() => {}}
      />
    );
  }
  const wide = await testRender(<Footer width={110} />, { width: 112, height: 8, exitOnCtrlC: false });
  await wide.flush();
  const wideFrame = wide.captureCharFrame();
  console.log("--- composer footer: plan usage ---");
  console.log(wideFrame);
  if (!wideFrame.includes("5h 42%") || !wideFrame.includes("wk 91%")) fail("composer footer does not show the plan usage gauges");
  const narrow = await testRender(<Footer width={60} />, { width: 62, height: 8, exitOnCtrlC: false });
  await narrow.flush();
  const narrowFrame = narrow.captureCharFrame();
  console.log("--- composer footer: narrow ---");
  console.log(narrowFrame);
  const footerLine = narrowFrame.split("\n").find((row) => row.includes("Claude Opus 5")) ?? "";
  if (!footerLine.includes("Full access")) fail("narrow composer footer lost the model group");
  if (footerLine.includes("external")) fail("narrow composer footer kept its lowest-priority segments");
  if (!/Full access\s{2,}/.test(footerLine)) fail("narrow composer footer runs its segments into the model group");
  // What does not fit sits behind "⋯ more", whose menu lists every control.
  if (!footerLine.includes("⋯ more")) fail("narrow composer footer offers no way to reach its hidden segments");
  const narrowRows = narrowFrame.split("\n");
  const moreRow = narrowRows.findIndex((row) => row.includes("⋯ more"));
  await act(async () => narrow.mockMouse.click(narrowRows[moreRow]!.indexOf("⋯ more") + 2, moreRow));
  await narrow.flush();
  const menu = narrow.captureCharFrame();
  console.log("--- composer footer: more menu ---");
  console.log(menu);
  for (const expected of ["5h 42%", "⧉ copy", "✎ external", "▾ more"]) {
    if (!menu.includes(expected)) fail(`the more menu is missing "${expected}"`);
  }

  // The open diff panel's footer: the counts in their own colours (green/red)
  // instead of one monochrome border title. Wrapped in a bounded row like
  // the app does, so the scrollbox takes the remainder and the footer pins
  // above the bottom border.
  function DiffHarness() {
    const scrollRef = useRef<ScrollBoxRenderable | null>(null);
    return (
      <box style={{ width: 62, height: 24, flexDirection: "row" }}>
        <DiffPanel
          files={[{ path: "src/a.ts", filetype: "typescript", patch: "--- src/a.ts\n+++ src/a.ts\n@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line2\n", additions: 2, deletions: 1, binary: false }]}
          loading={false}
          fileIndex={0}
          collapsed={new Set()}
          width={60}
          turnCount={8}
          turnTotal={4}
          focused={false}
          scrollRef={scrollRef}
          onToggleFile={() => {}}
          onFocus={() => {}}
          onHeaderClick={() => {}}
        />
      </box>
    );
  }
  const diff = await testRender(<DiffHarness />, { width: 62, height: 24, exitOnCtrlC: false });
  await diff.flush();
  const diffFrame = diff.captureCharFrame();
  console.log("--- diff panel: footer ---");
  console.log(diffFrame);
  for (const expected of ["Diff turn 8", "+2", "-1", "click a file to fold"]) {
    if (!diffFrame.includes(expected)) fail(`diff footer is missing "${expected}"`);
  }
  // No destroy(), as in bootGate: tearing down a second renderer breaks the shared one.
}
