import { Terminal, Box, SubagentBar } from "@moxen/tui";

const noop = () => {};

/** A running subagent's transcript is open: title, state, read-only, and the way back. */
export function Running() {
  return (
    <Terminal width={100} height={5}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <SubagentBar title="Explore · Count TODO comments in src/core" state="running 42s" width={98} onBack={noop} />
      </Box>
    </Terminal>
  );
}

/** A finished subagent in a narrower pane: "read-only" gives way first, then the title truncates. */
export function Narrow() {
  return (
    <Terminal width={60} height={5}>
      <Box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <SubagentBar title="Plan · Plan the fixes for the failing envelope goldens" state="finished in 13s" width={58} onBack={noop} />
      </Box>
    </Terminal>
  );
}
