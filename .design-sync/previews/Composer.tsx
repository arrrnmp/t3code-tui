import { Terminal, Box, Composer, providerColor } from "@moxen/tui";

const noop = () => {};
const base = {
  resetKey: "thread-1",
  onInput: noop,
  onSubmit: noop,
  onEscape: noop,
  onFocus: noop,
  placeholder: "Message the agent",
  model: "Claude Opus 5",
  modelColor: providerColor("claude") ?? undefined,
  effort: "high",
  permission: "Full access",
  submitVerb: "sends" as const,
  onModelClick: noop,
  onEffortClick: noop,
  onPermissionClick: noop,
  onCopyClick: noop,
  onExternalEditClick: noop,
  contextUsage: { percent: 42, usedLabel: "84k", maxLabel: "200k", totalProcessedLabel: null, costLabel: null },
  planUsage: [
    { short: "5h", percent: 42 },
    { short: "wk", percent: 91 },
  ],
};

/** Idle and focused, empty draft: placeholder, model · effort · permission, context and plan-usage gauges. */
export function Idle() {
  return (
    <Terminal width={104} height={10}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <Composer {...base} draft="" focused running={false} width={102} />
      </Box>
    </Terminal>
  );
}

/** A turn is running: a draft to steer with, background work, and the ■ stop control; hints switch to steer/queue. */
export function Running() {
  return (
    <Terminal width={104} height={10}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <Composer
          {...base}
          draft={"Also pin the new envelope golden for `moxen thread show --json`,\nthen run bun run check."}
          focused={false}
          running
          onStopClick={noop}
          onQueue={noop}
          backgroundSummary="2 shell, 1 monitor"
          onBackgroundClick={noop}
          width={102}
        />
      </Box>
    </Terminal>
  );
}

/** The provider's next-prompt suggestion in the empty draft, with its tab chip. */
export function Suggestion() {
  return (
    <Terminal width={104} height={10}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <Composer {...base} draft="" focused={false} running={false} width={102} suggestion="Now add a render-check scenario for the Git tab's commit view" />
      </Box>
    </Terminal>
  );
}

/** Beside an open side panel (Codex model): copy, external and plan usage move behind ⋯ more. */
export function Narrow() {
  return (
    <Terminal width={62} height={10}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <Composer {...base} draft="" focused={false} running={false} width={60} model="gpt-5.5" modelColor={providerColor("codex") ?? undefined} effort="high" />
      </Box>
    </Terminal>
  );
}
