import { Terminal, Box, Text, COLOR, SURFACE } from "@moxen/tui";

/** Panes: rounded borders, focus colour on the active one, title in the border. */
export function Panes() {
  return (
    <Terminal width={60} height={10}>
      <Box style={{ flexDirection: "row", flexGrow: 1, columnGap: 1, padding: 1 }}>
        <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" threads " titleColor={COLOR.dim} style={{ width: 22, paddingLeft: 1 }}>
          <Text fg={COLOR.text}>Fix the CI flake</Text>
          <Text fg={COLOR.dim}>Port the settings page</Text>
        </Box>
        <Box border borderStyle="rounded" borderColor={SURFACE.borderFocus} title=" chat " titleColor={COLOR.accent} style={{ flexGrow: 1, paddingLeft: 1 }}>
          <Text fg={COLOR.bright}>focused pane</Text>
          <Text fg={COLOR.dim}>borderFocus marks where keys go</Text>
        </Box>
      </Box>
    </Terminal>
  );
}

/** Surfaces: panes step a few lightness levels on one zinc hue. */
export function Surfaces() {
  const steps: [string, string][] = [["base", SURFACE.base], ["panel", SURFACE.panel], ["raised", SURFACE.raised], ["hover", SURFACE.hover], ["border", SURFACE.border]];
  return (
    <Terminal width={60} height={7}>
      <Box style={{ flexDirection: "row", columnGap: 1, padding: 1 }}>
        {steps.map(([name, color]) => (
          <Box key={name} backgroundColor={color} style={{ width: 10, height: 5, paddingLeft: 1, paddingTop: 1 }}>
            <Text fg={COLOR.text}>{name}</Text>
            <Text fg={COLOR.dim}>{color}</Text>
          </Box>
        ))}
      </Box>
    </Terminal>
  );
}

/** Row layout with a spacer: label left, meta flush right. */
export function Rows() {
  return (
    <Terminal width={44} height={6}>
      <Box backgroundColor={SURFACE.panel} style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        {[["Claude Opus 5", "current"], ["Claude Sonnet 5", "fast"], ["Codex", "gpt-5.5"]].map(([label, meta]) => (
          <Box key={label} style={{ flexDirection: "row", height: 1 }}>
            <Text fg={COLOR.text}>{label}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fg={COLOR.dim}>{meta}</Text>
          </Box>
        ))}
      </Box>
    </Terminal>
  );
}
