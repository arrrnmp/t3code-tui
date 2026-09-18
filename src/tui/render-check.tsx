import { testRender } from "@opentui/react/test-utils";

import { App, client } from "./render-check/fixtures.js";
import { runSidebarAndQuit } from "./render-check/scenarios/sidebarAndQuit.js";
import { runPermissions } from "./render-check/scenarios/permissions.js";
import { runDiffPanel } from "./render-check/scenarios/diffPanel.js";
import { runCommandPalette } from "./render-check/scenarios/commandPalette.js";
import { runMessageActions } from "./render-check/scenarios/messageActions.js";
import { runTimelineAndAnswers } from "./render-check/scenarios/timelineAndAnswers.js";
import { runWorkFoldGuards } from "./render-check/scenarios/workFoldGuards.js";
import { runSkillsAndContext } from "./render-check/scenarios/skillsAndContext.js";
import { runActivityRows } from "./render-check/scenarios/activityRows.js";

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
await runPermissions(setup);
await runDiffPanel(setup);
await runCommandPalette(setup);
await runMessageActions(setup);
await runTimelineAndAnswers(setup);
await runWorkFoldGuards(setup);
await runSkillsAndContext(setup);
await runActivityRows(setup);

process.exit(0);
