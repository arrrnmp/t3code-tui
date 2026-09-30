import { Terminal, Box, Text, HoverButton, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};

/** Idle buttons in a row: they blend into the surface until hovered. */
export function Idle() {
  return (
    <Terminal width={60} height={3}>
      <Box backgroundColor={SURFACE.raised} style={{ flexDirection: "row", flexGrow: 1, paddingLeft: 2, paddingTop: 1 }}>
        <HoverButton label=" Continue at reset " fg={COLOR.accent} onClick={noop} />
        <Text>{"  "}</Text>
        <HoverButton label=" In a new thread " fg={COLOR.accent} onClick={noop} />
        <Text>{"  "}</Text>
        <HoverButton label=" Dismiss " fg={COLOR.dim} onClick={noop} />
      </Box>
    </Terminal>
  );
}

/** The hovered look: the SURFACE.hover fill with a brightened label (shown here via bg). */
export function Hovered() {
  return (
    <Terminal width={60} height={3}>
      <Box backgroundColor={SURFACE.raised} style={{ flexDirection: "row", flexGrow: 1, paddingLeft: 2, paddingTop: 1 }}>
        <HoverButton label=" c copy " fg={COLOR.dim} onClick={noop} />
        <Text>{"  "}</Text>
        <HoverButton label=" c copy " fg={COLOR.bright} bg={SURFACE.hover} onClick={noop} />
        <Text>{"  "}</Text>
        <HoverButton label=" ■ stop " fg={COLOR.danger} onClick={noop} />
        <Text>{"  "}</Text>
        <HoverButton label=" ■ stop " fg={COLOR.bright} bg={SURFACE.hover} onClick={noop} />
      </Box>
    </Terminal>
  );
}
