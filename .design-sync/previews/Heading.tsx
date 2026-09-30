import { Terminal, Box, Text, Heading, SidePanelFrame, COLOR } from "@moxen/tui";

const noop = () => {};
const scrollRef = { current: null };

/** Section titles in the panel: bold title, dim meta, a rule to the panel's edge. */
export function Sections() {
  return (
    <Terminal width={48} height={12}>
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>
        <SidePanelFrame width={48} focused={false} scrollRef={scrollRef} onFocus={noop}>
          <Heading text="Delegated threads" meta="2" />
          <Text fg={COLOR.text}>● Audit the routes</Text>
          <Heading text="Context usage" meta="last reading" />
          <Text fg={COLOR.text}>84k / 200k · 42%</Text>
          <Heading text="Heaviest tools" />
        </SidePanelFrame>
      </Box>
    </Terminal>
  );
}
