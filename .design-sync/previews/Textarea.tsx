import { Terminal, Box, Textarea, COLOR, SURFACE } from "@moxen/tui";

/** A multi-row editor at its resting height, showing its placeholder. */
export function Empty() {
  return (
    <Terminal width={60} height={5}>
      <Box backgroundColor={SURFACE.raised} style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <Textarea placeholder="Ask anything… (enter sends, shift+enter for a newline)" textColor={COLOR.text} backgroundColor={SURFACE.raised} placeholderColor={COLOR.faint} wrapMode="word" style={{ minHeight: 3, maxHeight: 10 }} />
      </Box>
    </Terminal>
  );
}

/** With a drafted multi-line prompt. */
export function Drafted() {
  return (
    <Terminal width={60} height={7}>
      <Box backgroundColor={SURFACE.raised} style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <Textarea initialValue={"Split DiffPanel into FileSection rows.\nKeep the Git tab using the same component.\nThen run bun run check."} textColor={COLOR.text} backgroundColor={SURFACE.raised} placeholderColor={COLOR.faint} wrapMode="word" style={{ minHeight: 3, maxHeight: 10 }} />
      </Box>
    </Terminal>
  );
}
