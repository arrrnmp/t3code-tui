import { Terminal, Box, Text, COLOR, SURFACE, MARKER, truncate } from "@moxen/tui";

/** A styled line: fg carries meaning, chrome stays quiet. */
export function Palette() {
  return (
    <Terminal width={48} height={9}>
      <Box style={{ flexDirection: "column", paddingLeft: 2, paddingTop: 1 }}>
        <Text fg={COLOR.bright}>Refactor the diff panel</Text>
        <Text fg={COLOR.text}>Body text sits just below pure white.</Text>
        <Text fg={COLOR.dim}>2 files changed · 4m ago</Text>
        <Text fg={COLOR.accent}>{`${MARKER} focused pane accent`}</Text>
        <Text fg={COLOR.warn}>⚠ waiting on permission</Text>
        <Text fg={COLOR.danger}>✗ turn failed: rate limited</Text>
        <Text fg={COLOR.added}>+12 added</Text>
      </Box>
    </Terminal>
  );
}

/** Text attributes (bitmask) and a background pill. */
export function Attributes() {
  return (
    <Terminal width={48} height={5}>
      <Box style={{ flexDirection: "column", paddingLeft: 2, paddingTop: 1 }}>
        <Box style={{ flexDirection: "row", columnGap: 2 }}>
          <Text fg={COLOR.bright} attributes={1}>bold</Text>
          <Text fg={COLOR.text} attributes={4}>italic</Text>
          <Text fg={COLOR.accent} attributes={8}>underline</Text>
          <Text fg={COLOR.dim} attributes={128}>struck</Text>
        </Box>
        <Box style={{ flexDirection: "row", columnGap: 1, marginTop: 1 }}>
          <Text fg={COLOR.bright} bg={SURFACE.border}> tab </Text>
          <Text fg="#221503" bg="#df9f5f"> selected </Text>
          <Text fg={COLOR.faint}>to use it</Text>
        </Box>
      </Box>
    </Terminal>
  );
}

/** Word wrap (default) vs a truncated single line. */
export function Wrapping() {
  const long = "The agent read 14 files, ran the test suite twice and proposed a two-step plan for the migration.";
  return (
    <Terminal width={40} height={7}>
      <Box style={{ flexDirection: "column", paddingLeft: 1, paddingRight: 1, paddingTop: 1 }}>
        <Text fg={COLOR.text} wrapMode="word">{long}</Text>
        <Text fg={COLOR.dim} wrapMode="none" style={{ marginTop: 1 }}>{truncate(long, 38)}</Text>
      </Box>
    </Terminal>
  );
}
