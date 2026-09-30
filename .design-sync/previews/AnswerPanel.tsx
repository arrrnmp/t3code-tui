import { Terminal, Box, AnswerPanel } from "@moxen/tui";

const noop = () => {};
const handlers = { onToggleOption: noop, onPickOption: noop, onCustom: noop, onContinue: noop, onDismiss: noop };

/** A single-choice question in the composer's slot: options with descriptions, custom answer, key hints. */
export function SingleChoice() {
  const question = {
    id: "q1",
    header: "Merge strategy",
    question: "The branch is 3 commits behind main. How should I bring it up to date before opening the PR?",
    multiSelect: false,
    allowCustomAnswer: true,
    options: [
      { label: "Rebase onto main", description: "linear history, rewrites 4 local commits", value: "rebase", preview: null },
      { label: "Merge main in", description: "keeps history, adds a merge commit", value: "merge", preview: null },
      { label: "Leave it", description: "open the PR as-is and let CI tell", value: "leave", preview: null },
    ],
  };
  return (
    <Terminal width={80} height={15}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <AnswerPanel question={question} position={0} total={1} width={78} suspended pickedValues={[]} {...handlers} />
      </Box>
    </Terminal>
  );
}

/** Multi-select, question 2 of 2: toggled options marked ●, a Continue row counting picks. */
export function MultiSelect() {
  const question = {
    id: "q2",
    header: "Checks to run",
    question: "Which checks should run before I push?",
    multiSelect: true,
    allowCustomAnswer: true,
    options: [
      { label: "bun run check", description: "typecheck + tests", value: "check", preview: null },
      { label: "render-check", description: "TUI snapshot harness", value: "render", preview: null },
      { label: "moxen --json doctor", description: "live integration probe", value: "doctor", preview: null },
      { label: "Envelope goldens only", description: null, value: "goldens", preview: null },
    ],
  };
  return (
    <Terminal width={80} height={16}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <AnswerPanel question={question} position={1} total={2} width={78} suspended pickedValues={["check", "render"]} {...handlers} />
      </Box>
    </Terminal>
  );
}

/** The highlighted option carries a markdown preview (Claude's AskUserQuestion mockups). */
export function WithPreview() {
  const question = {
    id: "q3",
    header: "Side panel layout",
    question: "Where should the Diff / Context / Agents tabs live?",
    multiSelect: false,
    allowCustomAnswer: false,
    options: [
      { label: "Tab strip in the frame", description: "tabs cut the panel's top border", value: null, preview: "## Tab strip\n\n- tabs sit in the frame's **top line**\n- the side frame stays level with the chat frame" },
      { label: "Stacked on the left", description: "vertical tabs", value: null, preview: "## Stacked\n\n- tabs stacked on the **left** edge" },
    ],
  };
  return (
    <Terminal width={80} height={20}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <AnswerPanel question={question} position={0} total={1} width={78} suspended pickedValues={[]} {...handlers} />
      </Box>
    </Terminal>
  );
}
