import { testRender } from "@opentui/react/test-utils";

import { App, client } from "./render-check/fixtures.js";
import { runBootGate } from "./render-check/scenarios/bootGate.js";
import { runSidebarAndQuit } from "./render-check/scenarios/sidebarAndQuit.js";
import { runModelPicker } from "./render-check/scenarios/modelPicker.js";
import { runSidebarStability } from "./render-check/scenarios/sidebarStability.js";
import { runPermissions } from "./render-check/scenarios/permissions.js";
import { runDiffPanel } from "./render-check/scenarios/diffPanel.js";
import { runCommandPalette } from "./render-check/scenarios/commandPalette.js";
import { runMessageActions } from "./render-check/scenarios/messageActions.js";
import { runTimelineAndAnswers } from "./render-check/scenarios/timelineAndAnswers.js";
import { runWorkFoldGuards } from "./render-check/scenarios/workFoldGuards.js";
import { runSkillsAndContext } from "./render-check/scenarios/skillsAndContext.js";
import { runSidePanelButton } from "./render-check/scenarios/sidePanelButton.js";
import { runActivityRows } from "./render-check/scenarios/activityRows.js";
import { runLifecycleRows } from "./render-check/scenarios/lifecycleRows.js";
import { runTurnModels } from "./render-check/scenarios/turnModels.js";
import { runBackgroundWork } from "./render-check/scenarios/backgroundWork.js";
import { runProviderInterruptions } from "./render-check/scenarios/providerInterruptions.js";
import { runQuestionPreview } from "./render-check/scenarios/questionPreview.js";
import { runComposerScrollbar } from "./render-check/scenarios/composerScrollbar.js";
import { runTasksPanel } from "./render-check/scenarios/tasksPanel.js";
import { runSidePanelTabs } from "./render-check/scenarios/sidePanelTabs.js";
import { runNoticeBanner } from "./render-check/scenarios/noticeBanner.js";
import { runImageTokens } from "./render-check/scenarios/imageTokens.js";
import { runSettingsAndGit } from "./render-check/scenarios/settingsAndGit.js";
import { runQueueAndSide } from "./render-check/scenarios/queueAndSide.js";
import { runSidebarTree } from "./render-check/scenarios/sidebarTree.js";
import { registerSyntaxParsers } from "./syntax/register.js";

/**
 * Snapshot harness: drives the app with a mock client, scripts input,
 * captures char frames. No live terminal needed.
 *
 * This is one continuous scripted walkthrough against a single shared
 * `setup` — every step depends on state left behind by the previous one, not
 * an independent test case — so it stays a strict sequence of `await`s in
 * original order, just split into feature-scoped scenario functions instead
 * of one 1300-line script. `bun src/tui/render-check.tsx` runs it.
 */

// Same vendored grammars the app registers in `index.tsx`, and for the same
// reason: before the first render, or command rows render unhighlighted.
await registerSyntaxParsers();

// `exitOnCtrlC` defaults true on the renderer itself (harmless in the real
// app, which passes `false` in `index.tsx` so its own quit-confirm modal
// gets the keypress) — without it here, the harness's own renderer would
// tear itself down on the ctrl+c scenario below before the app ever saw it.
const setup = await testRender(<App client={client} onQuit={() => {}} launchView="thread" />, {
  width: 140,
  height: 26,
  exitOnCtrlC: false,
});

await runSidebarAndQuit(setup);
await runModelPicker(setup);
await runSidebarStability(setup);
await runPermissions(setup);
await runDiffPanel(setup);
await runCommandPalette(setup);
await runMessageActions(setup);
await runTimelineAndAnswers(setup);
await runWorkFoldGuards(setup);
await runSkillsAndContext(setup);
await runSidePanelButton(setup);
await runActivityRows(setup);
await runLifecycleRows(setup);
await runBackgroundWork(setup);
await runProviderInterruptions(setup);
// Independent render with its own deferred client (not part of the shared
// walkthrough above): runs last so its extra renderer cannot perturb the
// timing-sensitive assertions of the shared scenarios.
await runBootGate();
await runTurnModels();
await runQuestionPreview();
await runComposerScrollbar();
await runTasksPanel();
await runSidePanelTabs();
await runSettingsAndGit();
await runQueueAndSide();
await runNoticeBanner();
await runImageTokens();
await runSidebarTree();

process.exit(0);
