import { Terminal, Box, Text, MinSizeGate, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};

function App() {
  return (
    <Box style={{ flexDirection: "row", flexGrow: 1 }}>
      <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" threads " titleColor={COLOR.dim} style={{ width: 32, paddingLeft: 1 }}>
        <Text fg={COLOR.bright}>Fix the CI flake</Text>
        <Text fg={COLOR.dim}>Port the settings page</Text>
      </Box>
      <Box border borderStyle="rounded" borderColor={SURFACE.borderFocus} title=" Fix the CI flake " titleColor={COLOR.accent} style={{ flexGrow: 1, paddingLeft: 1 }}>
        <Text fg={COLOR.user}>› The e2e job times out on the Windows runner.</Text>
      </Box>
    </Box>
  );
}

/** A 100×24 terminal: under the 180×47 minimum, the opaque notice covers the app. */
export function TooSmall() {
  return (
    <Terminal width={100} height={24}>
      <MinSizeGate onQuit={noop}>
        <App />
      </MinSizeGate>
    </Terminal>
  );
}

/** Very narrow (40×14): every line truncates to the terminal's inner width. */
export function Narrow() {
  return (
    <Terminal width={40} height={14}>
      <MinSizeGate onQuit={noop}>
        <App />
      </MinSizeGate>
    </Terminal>
  );
}
