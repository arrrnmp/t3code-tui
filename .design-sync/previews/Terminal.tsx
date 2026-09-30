import { Terminal, Box, Text, COLOR, SURFACE, MARKER } from "@moxen/tui";

/** The app's frame: panes in a stretching row on the base surface. */
export function Layout() {
  return (
    <Terminal width={72} height={14}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Threads " titleColor={COLOR.dim} backgroundColor={SURFACE.panel} style={{ width: 24, paddingLeft: 1 }}>
          <Text fg={COLOR.accent}>{`${MARKER} Fix the CI flake`}</Text>
          <Text fg={COLOR.text}>  Port settings page</Text>
          <Text fg={COLOR.dim}>  Landing hero copy</Text>
        </Box>
        <Box border borderStyle="rounded" borderColor={SURFACE.borderFocus} title=" Fix the CI flake " titleColor={COLOR.accent} backgroundColor={SURFACE.panel} style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
          <Text fg={COLOR.user}>› why does bun check fail on CI only?</Text>
          <Text fg={COLOR.text} style={{ marginTop: 1 }}>The render-check snapshot pins a terminal width of 120; CI runs at 80.</Text>
        </Box>
      </Box>
    </Terminal>
  );
}

/** A small grid — every length inside is counted in these cells. */
export function Grid() {
  return (
    <Terminal width={40} height={6}>
      <Box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
        <Text fg={COLOR.dim}>{"0123456789".repeat(3) + "01234567"}</Text>
        <Text fg={COLOR.faint}>{"·".repeat(38)}</Text>
        <Text fg={COLOR.text}>40 columns × 6 rows</Text>
      </Box>
    </Terminal>
  );
}
