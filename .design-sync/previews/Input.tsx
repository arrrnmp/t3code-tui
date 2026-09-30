import { Terminal, Box, Text, Input, COLOR, SURFACE } from "@moxen/tui";

/** A labelled one-row field on the raised surface, focused. */
export function Focused() {
  return (
    <Terminal width={52} height={5}>
      <Box backgroundColor={SURFACE.raised} style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <Text fg={COLOR.dim}>Thread title</Text>
        <Input focused value="Fix the CI flake" textColor={COLOR.text} focusedTextColor={COLOR.bright} backgroundColor={SURFACE.raised} focusedBackgroundColor={SURFACE.raised} placeholderColor={COLOR.faint} />
      </Box>
    </Terminal>
  );
}

/** Empty, showing its placeholder. */
export function Placeholder() {
  return (
    <Terminal width={52} height={5}>
      <Box backgroundColor={SURFACE.raised} style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <Text fg={COLOR.dim}>Filter</Text>
        <Input value="" placeholder="type to filter threads" textColor={COLOR.text} backgroundColor={SURFACE.raised} placeholderColor={COLOR.faint} />
      </Box>
    </Terminal>
  );
}
