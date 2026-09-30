import { Terminal, Box, Text, ActionText, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};

/** Inline actions in panel footers and rows: accent by default, danger for destructive ones. */
export function Footers() {
  return (
    <Terminal width={44} height={7}>
      <Box style={{ flexDirection: "column", paddingLeft: 2, paddingTop: 1 }}>
        <Box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          <ActionText label="Compact now" onClick={noop} />
          <Text fg={COLOR.faint}>{"  frees the window"}</Text>
        </Box>
        <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
          <Text fg={COLOR.dim}>{"2 running  "}</Text>
          <ActionText label="View all" onClick={noop} />
        </Box>
        <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
          <Text fg={COLOR.faint}>{"  bun run check --watch  "}</Text>
          <ActionText label="stop" color={COLOR.danger} onClick={noop} />
        </Box>
      </Box>
    </Terminal>
  );
}
