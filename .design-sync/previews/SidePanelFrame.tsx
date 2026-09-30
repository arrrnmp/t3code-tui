import { Terminal, Box, Text, SideTabBar, SidePanelFrame, Heading, ActionText, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };
const W = 56;
const H = 12;

/** Focused frame under the tab strip, with a pinned footer above the bottom border. */
export function Focused() {
  return (
    <Terminal width={W} height={H}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="background" badges={{ diff: "2", background: "2" }} onTab={noop} onClose={noop} focused left={2} width={W - 4} />
          <SidePanelFrame
            width={W}
            height={H}
            focused
            scrollRef={scrollRef}
            onFocus={noop}
            footer={
              <Box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
                <Text fg={COLOR.dim} bg={SURFACE.panel}>{"2 running  "}</Text>
                <ActionText label="View all" onClick={noop} />
              </Box>
            }
          >
            <Heading text="Running in the background" meta="2" />
            <Text fg={COLOR.text}>● Shell · bun run check --watch</Text>
            <Text fg={COLOR.text}>● Monitor · Watch the dev server log</Text>
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}

/** Unfocused frame (quiet border), no footer: the body fills to the bottom border. */
export function Unfocused() {
  return (
    <Terminal width={W} height={H}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="agents" badges={{ agents: "1" }} onTab={noop} onClose={noop} focused={false} left={2} width={W - 4} />
          <SidePanelFrame width={W} height={H} focused={false} scrollRef={scrollRef} onFocus={noop}>
            <Heading text="Delegated threads" meta="1" />
            <Text fg={COLOR.text}>● Audit the routes</Text>
            <Heading text="Subagents in this thread" meta="none yet" />
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}
