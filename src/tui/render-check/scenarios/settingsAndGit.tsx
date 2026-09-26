import { act, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";

import { GitTab } from "../../features/gitpanel/gitpanel.js";
import { SettingsModal } from "../../features/settings/settingsmodal.js";
import { SidePanelFrame, SideTabBar } from "../../features/sidepanel/sidepanel.js";
import { describeSettings, DEFAULTS_FOR_RENDER_CHECK } from "./settingsFixture.js";
import type { ForgeDetection, ForgeRequest, GitOverview, MergeStrategy } from "../../../server/api.js";
import type { SideTab } from "../../model/sidepanel.js";
import { fail } from "../helpers.js";

/**
 * The settings page and the Git tab.
 *
 * The settings assertions deliberately name labels that come from the
 * core schema table rather than from this file: if a descriptor loses its
 * label, or a section stops being rendered, the scenario fails here
 * rather than silently drawing a blank page.
 */
export async function runSettingsAndGit(): Promise<void> {
  await runSettings();
  await runGit();
}

async function runSettings(): Promise<void> {
  const written: Array<{ key: string; value: string }> = [];
  const snapshot = {
    path: "/home/dev/.config/moxen/config.json",
    exists: true,
    settings: describeSettings(DEFAULTS_FOR_RENDER_CHECK),
  };
  function Harness() {
    return (
      <SettingsModal
        snapshot={snapshot}
        loading={false}
        saving={null}
        error={null}
        onSet={(key, value) => written.push({ key, value })}
        screenWidth={80}
        screenHeight={34}
        left={2}
        top={1}
        width={76}
        height={32}
        onClose={() => {}}
      />
    );
  }
  const setup = await testRender(<Harness />, { width: 80, height: 34, exitOnCtrlC: false });
  await setup.flush();
  // ModalShell fades in over ~150ms; capture after it, or the frame is
  // the backdrop at zero opacity and every assertion below misses.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
  await setup.flush();
  const frame = setup.captureCharFrame();
  console.log("--- settings page ---");
  console.log(frame);
  for (const expected of ["Settings", "config.json", "General", "Turns", "Tool permissions", "Unknown folders"]) {
    if (!frame.includes(expected)) fail(`settings page is missing "${expected}"`);
  }

  // The page is longer than the modal, so the later sections are only
  // reachable by moving down — which has to scroll the view along with
  // the selection rather than leaving it stranded under the fold.
  for (let step = 0; step < 24; step += 1) {
    await act(async () => setup.mockInput.pressKey("ARROW_DOWN"));
  }
  await setup.flush();
  const scrolled = setup.captureCharFrame();
  console.log("--- settings page, scrolled to the provider section ---");
  console.log(scrolled);
  for (const expected of ["Git and forges", "Forge integration", "Claude Code", "Claude executable"]) {
    if (!scrolled.includes(expected)) fail(`settings page never reveals "${expected}"`);
  }
  // A restart-only setting has to say so, or a user will change the
  // Claude binary and wonder why the running session ignored it.
  if (!scrolled.includes("next start")) fail("settings page does not mark restart-only settings");

  // Clicking a boolean cycles it in place, with no sub-modal.
  const rows = scrolled.split("\n");
  const forgeRow = rows.findIndex((row) => row.includes("Forge integration"));
  if (forgeRow < 0) fail("settings page has no forge row to click");
  await act(async () => setup.mockMouse.click(rows[forgeRow]!.indexOf("Forge") + 1, forgeRow));
  await setup.flush();
  if (written.length !== 1 || written[0]?.key !== "forge.enabled" || written[0]?.value !== "false") {
    fail(`clicking a boolean setting wrote ${JSON.stringify(written)}`);
  }
}

const OVERVIEW: GitOverview = {
  isRepository: true,
  root: "/work/moxen",
  branch: "feature/git-panel",
  status: { branch: "feature/git-panel", detached: false, staged: 1, unstaged: 3, untracked: 2, conflicted: 0 },
  branches: [
    {
      name: "feature/git-panel",
      current: true,
      remote: false,
      upstream: "origin/feature/git-panel",
      ahead: 2,
      behind: 0,
      lastCommitDate: "2026-09-25T09:00:00.000Z",
      lastCommitSubject: "Add the Git tab",
    },
    {
      name: "main",
      current: false,
      remote: false,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      lastCommitDate: "2026-09-24T09:00:00.000Z",
      lastCommitSubject: "Re-layer into core",
    },
  ],
  commits: [
    {
      sha: "a".repeat(40),
      shortSha: "a1b2c3d",
      author: "Aaron",
      authorEmail: "dev@example.com",
      date: "2026-09-25T09:00:00.000Z",
      subject: "Add the Git tab",
      refs: ["feature/git-panel"],
    },
    {
      sha: "b".repeat(40),
      shortSha: "e4f5a6b",
      author: "Aaron",
      authorEmail: "dev@example.com",
      date: "2026-09-24T09:00:00.000Z",
      subject: "Read branches and history",
      refs: [],
    },
  ],
};

const FORGE: ForgeDetection = {
  kind: "github",
  remoteUrl: "https://github.com/arrrnmp/moxen.git",
  host: "github.com",
  slug: "arrrnmp/moxen",
  cli: "gh",
  installed: true,
  authenticated: true,
  reason: null,
};

const REQUESTS: readonly ForgeRequest[] = [
  {
    number: 41,
    title: "Add the Git side panel",
    state: "open",
    author: "arrrnmp",
    sourceBranch: "feature/git-panel",
    targetBranch: "main",
    url: "https://github.com/arrrnmp/moxen/pull/41",
    createdAt: "2026-09-25T08:00:00.000Z",
    updatedAt: "2026-09-25T09:30:00.000Z",
    reviewDecision: "APPROVED",
    checks: { passed: 7, failed: 0, pending: 0 },
  },
];

async function runGit(): Promise<void> {
  const now = Date.parse("2026-09-25T10:00:00.000Z");
  // Typed as a mutable list so the length checks below are not narrowed
  // away by TypeScript inferring an always-empty tuple.
  const merged: { number: number; strategy: MergeStrategy }[] = [];
  function Harness() {
    const [tab, setTab] = useState<SideTab>("git");
    const scrollRef = useRef<ScrollBoxRenderable | null>(null);
    return (
      <box style={{ width: 60, height: 34, flexDirection: "column" }}>
        <SideTabBar tab={tab} badges={{}} onTab={setTab} onClose={() => {}} />
        <SidePanelFrame width={60} focused scrollRef={scrollRef} onFocus={() => {}}>
          <GitTab
            overview={OVERVIEW}
            forge={FORGE}
            requests={REQUESTS}
            loadingGit={false}
            loadingForge={false}
            error={null}
            busy={null}
            selectedBranch={null}
            width={60}
            now={now}
            onSelectBranch={() => {}}
            onRefresh={() => {}}
            onCreate={() => {}}
            onComment={() => {}}
            onMerge={(request, strategy) => merged.push({ number: request.number, strategy })}
          />
        </SidePanelFrame>
      </box>
    );
  }
  const setup = await testRender(<Harness />, { width: 62, height: 36, exitOnCtrlC: false });
  await setup.flush();
  const frame = setup.captureCharFrame();
  console.log("--- side panel: git tab ---");
  console.log(frame);
  for (const expected of [
    "Git",
    "feature/git-panel",
    "3 changed",
    "2 untracked",
    "Branches",
    "↑2",
    "in sync",
    "Commits",
    "a1b2c3d",
    "Add the Git tab",
    "Pull requests",
    "#41",
    "7 passed",
    "merge",
    "Open a pull request",
  ]) {
    if (!frame.includes(expected)) fail(`git tab is missing "${expected}"`);
  }

  // Merge arms before it fires: one click offers the strategies, and only
  // the second actually merges. A single misclick must never merge.
  const rows = frame.split("\n");
  const actionRow = rows.findIndex((row) => row.includes("merge…"));
  if (actionRow < 0) fail("git tab has no merge control");
  await act(async () => setup.mockMouse.click(rows[actionRow]!.indexOf("merge…") + 1, actionRow));
  await setup.flush();
  if ((merged as ReadonlyArray<unknown>).length !== 0) fail("the first merge click merged instead of arming");
  const armed = setup.captureCharFrame();
  console.log("--- side panel: git tab, merge armed ---");
  console.log(armed);
  for (const expected of ["squash", "merge commit", "cancel"]) {
    if (!armed.includes(expected)) fail(`armed merge is missing "${expected}"`);
  }
  const armedRows = armed.split("\n");
  const squashRow = armedRows.findIndex((row) => row.includes("squash"));
  await act(async () => setup.mockMouse.click(armedRows[squashRow]!.indexOf("squash") + 1, squashRow));
  await setup.flush();
  if (merged.length !== 1 || merged[0]?.number !== 41 || merged[0]?.strategy !== "squash") {
    fail(`confirming the merge sent ${JSON.stringify(merged)}`);
  }

  // A checkout with no forge still shows history, and says why the
  // requests section is empty rather than showing nothing at all.
  function NoForge() {
    const scrollRef = useRef<ScrollBoxRenderable | null>(null);
    return (
      <box style={{ width: 60, height: 30, flexDirection: "column" }}>
        <SidePanelFrame width={60} focused scrollRef={scrollRef} onFocus={() => {}}>
          <GitTab
            overview={OVERVIEW}
            forge={{ ...FORGE, kind: null, installed: false, authenticated: false, reason: "gh is not installed." }}
            requests={[]}
            loadingGit={false}
            loadingForge={false}
            error={null}
            busy={null}
            selectedBranch={null}
            width={60}
            now={now}
            onSelectBranch={() => {}}
            onRefresh={() => {}}
            onCreate={() => {}}
            onComment={() => {}}
            onMerge={() => {}}
          />
        </SidePanelFrame>
      </box>
    );
  }
  const plain = await testRender(<NoForge />, { width: 62, height: 32, exitOnCtrlC: false });
  await plain.flush();
  const plainFrame = plain.captureCharFrame();
  console.log("--- side panel: git tab, no forge ---");
  console.log(plainFrame);
  if (!plainFrame.includes("gh is not installed.")) fail("git tab does not explain a missing forge CLI");
  if (!plainFrame.includes("Add the Git tab")) fail("git tab dropped local history when the forge was unavailable");
}
