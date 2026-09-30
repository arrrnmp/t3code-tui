import { Terminal, Box, SideTabBar, SidePanelFrame, Heading } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };

/** Seated in the frame's top line with every badge (the app's layout, focused). */
export function InFrame() {
  const W = 62;
  return (
    <Terminal width={W} height={5}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="context" badges={{ diff: "3", context: "42%", agents: "2", background: "1" }} onTab={noop} onClose={noop} focused left={2} width={W - 4} />
          <SidePanelFrame width={W} height={5} focused scrollRef={scrollRef} onFocus={noop}>
            <Heading text="Context usage" meta="live" />
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}

/** A narrow panel: labels shorten (Ctx, Bkgd) before badges are shed, so × stays on screen. */
export function Narrow() {
  const W = 48;
  return (
    <Terminal width={W} height={5}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="agents" badges={{ diff: "3", context: "42%", agents: "2" }} onTab={noop} onClose={noop} focused={false} left={2} width={W - 4} />
          <SidePanelFrame width={W} height={5} focused={false} scrollRef={scrollRef} onFocus={noop}>
            <Heading text="Delegated threads" meta="2" />
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}

/** Very narrow: short labels and no badges. */
export function Compact() {
  const W = 40;
  return (
    <Terminal width={W} height={5}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="background" badges={{ diff: "3", context: "42%", agents: "2", background: "1" }} onTab={noop} onClose={noop} focused left={2} width={W - 4} />
          <SidePanelFrame width={W} height={5} focused scrollRef={scrollRef} onFocus={noop}>
            <Heading text="Running in the background" meta="1" />
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}
