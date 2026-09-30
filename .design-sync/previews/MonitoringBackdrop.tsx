import { Terminal, Box, Text, MonitoringBackdrop, COLOR, SURFACE } from "@moxen/tui";

/** The lattice plus the drift dots at frame 0 (`motion="static"`, ui.backdrop = static). */
export function Static() {
  return (
    <Terminal width={72} height={16}>
      <Box backgroundColor={SURFACE.base} style={{ flexGrow: 1 }}>
        <MonitoringBackdrop width={72} height={16} motion="static" />
      </Box>
    </Terminal>
  );
}

/** Behind the empty creating view: texture underneath, the prompt column on top. */
export function CreatingView() {
  return (
    <Terminal width={72} height={16}>
      <Box backgroundColor={SURFACE.base} style={{ flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <MonitoringBackdrop width={72} height={16} offsetX={32} fieldWidth={104} fieldHeight={16} motion="static" />
        <Box style={{ flexDirection: "column", flexShrink: 0, width: 48, zIndex: 1 }}>
          <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "center" }}>
            <Text fg={COLOR.bright} bg={SURFACE.base}>{"What should we build in "}</Text>
            <Text fg={COLOR.bright} bg={SURFACE.base}>moxen</Text>
            <Text fg={COLOR.bright} bg={SURFACE.base}>{"?"}</Text>
          </Box>
          <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "center" }}>
            <Text fg={COLOR.dim} bg={SURFACE.base}>claude · Claude Opus 5 · full access</Text>
          </Box>
        </Box>
      </Box>
    </Terminal>
  );
}

/** The sidebar's dimmer variant (opacity 0.35), inset one cell inside its border. */
export function Sidebar() {
  return (
    <Terminal width={32} height={14}>
      <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" threads " titleColor={COLOR.dim} style={{ flexGrow: 1 }}>
        <MonitoringBackdrop width={30} height={12} opacity={0.35} offsetX={1} offsetY={1} fieldWidth={104} fieldHeight={14} motion="static" />
      </Box>
    </Terminal>
  );
}
