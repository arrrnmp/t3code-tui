import { Terminal, Box, Text, SideTabBar, SidePanelFrame, DiffEmptyTab, COLOR } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };
const W = 60;
const H = 10;

/** Turns have changed files: pick one to open its diff. */
export function WithChanges() {
  return (
    <Terminal width={W} height={H}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="diff" badges={{ diff: "3", context: "42%" }} onTab={noop} onClose={noop} focused left={2} width={W - 4} />
          <SidePanelFrame width={W} height={H} focused scrollRef={scrollRef} onFocus={noop} footer={<Text fg={COLOR.dim}>3 turns with changes</Text>}>
            <DiffEmptyTab turns={3} onPick={noop} />
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}

/** A fresh thread: no turn has touched a file yet. */
export function NoChanges() {
  return (
    <Terminal width={W} height={H}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box style={{ width: W, flexDirection: "column", flexShrink: 0 }}>
          <SideTabBar tab="diff" badges={{ context: "6%" }} onTab={noop} onClose={noop} focused={false} left={2} width={W - 4} />
          <SidePanelFrame width={W} height={H} focused={false} scrollRef={scrollRef} onFocus={noop}>
            <DiffEmptyTab turns={0} onPick={noop} />
          </SidePanelFrame>
        </Box>
      </Box>
    </Terminal>
  );
}
