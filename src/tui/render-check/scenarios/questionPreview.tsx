import { act } from "react";
import { testRender } from "@opentui/react/test-utils";

import { AnswerPanel } from "../../features/answerpanel/answerpanel.js";
import type { PendingUserInputQuestion } from "../../model/thread.js";
import { fail } from "../helpers.js";

/**
 * An agent question whose options carry previews (Claude's AskUserQuestion
 * `preview`, written as markdown): the highlighted option's preview renders
 * under the rows, and moving the highlight swaps it. Rendered on its own so
 * the shared walkthrough's fixed click targets stay where they are.
 */
export async function runQuestionPreview(): Promise<void> {
  const question: PendingUserInputQuestion = {
    id: "Which layout?",
    header: "Layout",
    question: "Which layout?",
    multiSelect: false,
    allowCustomAnswer: true,
    options: [
      { label: "Sidebar", description: "tabs on the left", value: null, preview: "## Sidebar\n\n- tabs stacked on the **left**" },
      { label: "Top bar", description: "tabs on top", value: null, preview: "## Top bar\n\n- tabs across the **top**" },
      { label: "No preview", description: "plain option", value: null, preview: null },
    ],
  };
  const setup = await testRender(
    <AnswerPanel
      question={question}
      position={0}
      total={1}
      width={90}
      suspended={false}
      pickedValues={[]}
      onToggleOption={() => {}}
      onPickOption={() => {}}
      onCustom={() => {}}
      onContinue={() => {}}
      onDismiss={() => {}}
    />,
    { width: 100, height: 30, exitOnCtrlC: false },
  );
  await setup.flush();
  const first = setup.captureCharFrame();
  console.log("--- answer panel: option preview ---");
  console.log(first);
  if (!first.includes("preview") || !first.includes("Sidebar") || !first.includes("tabs stacked on the left")) {
    fail("the highlighted option's preview did not render");
  }

  await act(async () => setup.mockInput.pressArrow("down"));
  // The input parser settles an escape sequence on its next tick.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  await setup.flush();
  const second = setup.captureCharFrame();
  if (!second.includes("tabs across the top") || second.includes("tabs stacked on the left")) {
    fail("moving the highlight did not swap the preview");
  }

  await act(async () => setup.mockInput.pressArrow("down"));
  // The input parser settles an escape sequence on its next tick.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  await setup.flush();
  if (setup.captureCharFrame().includes("tabs across the top")) fail("an option without a preview kept the previous one");
  // No destroy(), as in bootGate: tearing down a second renderer breaks the shared one.
}
