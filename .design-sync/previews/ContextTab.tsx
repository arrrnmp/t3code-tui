import { Terminal, Box, Text, SideTabBar, SidePanelFrame, ContextTab, ActionText, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };
const now = Date.parse("2026-09-25T10:00:00.000Z");
const W = 60;

const breakdown = {
  usedTokens: 84_000,
  maxTokens: 200_000,
  cachedInputTokens: null,
  compactsAutomatically: true,
  autoCompactThreshold: 167_000,
  costUsd: 1.84,
  estimated: false,
  categories: [
    { name: "Messages", tokens: 52_000, kind: "used" },
    { name: "System prompt", tokens: 18_000, kind: "used" },
    { name: "System tools", tokens: 11_000, kind: "used" },
    { name: "MCP tools", tokens: 3_000, kind: "used" },
    { name: "Free space", tokens: 83_000, kind: "free" },
    { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
  ],
  tools: [
    { name: "Bash", tokens: 29_000 },
    { name: "Read", tokens: 12_400 },
    { name: "Edit", tokens: 6_100 },
    { name: "delegate", tokens: 900 },
  ],
};
const claudeLimits = {
  checkedAt: "2026-09-25T09:58:00.000Z",
  windows: [
    { id: "session", kind: "session", label: "Session", usedPercent: 42, resetsAt: new Date(now + 2 * 3_600_000).toISOString() },
    { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 91, resetsAt: new Date(now + 3 * 86_400_000).toISOString() },
  ],
  unavailable: null,
};

function Frame({ height, badge, footer, children }: { height: number; badge: string; footer?: boolean; children: any }) {
  return (
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="context" badges={{ diff: "2", ...(badge ? { context: badge } : {}) }} onTab={noop} onClose={noop} focused left={2} width={W - 4} />
          <SidePanelFrame
            width={W}
            height={height}
            focused
            scrollRef={scrollRef}
            onFocus={noop}
            footer={
              footer ? (
                <Box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
                  <ActionText label="Compact now" onClick={noop} />
                  <Text fg={COLOR.faint} bg={SURFACE.panel}>{"  frees the window"}</Text>
                </Box>
              ) : undefined
            }
          >
            {children}
          </SidePanelFrame>
        </Box>
      </Box>
  );
}

/** Live Claude breakdown: stacked window bar, categories, heaviest tools, plan usage. */
export function Live() {
  return (
    <Terminal width={60} height={30}>
    <Frame height={30} badge="42%" footer>
      <ContextTab breakdown={breakdown as never} fallback={null} live usageLimits={claudeLimits as never} providerName="Claude" width={W} now={now} />
    </Frame>
    </Terminal>
  );
}

/** A provider that reports only a total: one bar plus the last recorded reading. */
export function TotalOnly() {
  return (
    <Terminal width={60} height={16}>
    <Frame height={16} badge="31%">
      <ContextTab
        breakdown={null}
        fallback={{ usedTokens: 118_000, maxTokens: 380_000, totalProcessedTokens: 2_450_000, cachedInputTokens: 96_000, compactsAutomatically: false, autoCompactThreshold: 342_000, costUsd: null } as never}
        live={false}
        usageLimits={{ checkedAt: "2026-09-25T09:58:00.000Z", windows: [], unavailable: { reason: "unsupported", message: "Codex reports plan usage only after a turn that hits a limit." } } as never}
        providerName="Codex"
        width={W}
        now={now}
      />
    </Frame>
    </Terminal>
  );
}

/** Before the first turn: no reading yet. */
export function NoReading() {
  return (
    <Terminal width={60} height={11}>
    <Frame height={11} badge="">
      <ContextTab breakdown={null} fallback={null} live={false} usageLimits={null} providerName="OpenCode" width={W} now={now} />
    </Frame>
    </Terminal>
  );
}
