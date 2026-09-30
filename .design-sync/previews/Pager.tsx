import { Terminal, Box, Text, Pager, COLOR } from "@moxen/tui";

const noop = () => {};

/** `‹ 1/2 ›` beside a panel heading that shares its slot over the composer. */
export function TwoPages() {
  return (
    <Terminal width={48} height={1}>
      <Box style={{ flexDirection: "row", height: 1, paddingLeft: 2 }}>
        <Text fg={COLOR.bright}>Tasks</Text>
        <Text fg={COLOR.dim}>{"  3 of 5 done"}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pager position={0} count={2} onPage={noop} />
      </Box>
    </Terminal>
  );
}

/** Third of three: the queued panel's turn in the slot. */
export function ThirdOfThree() {
  return (
    <Terminal width={48} height={1}>
      <Box style={{ flexDirection: "row", height: 1, paddingLeft: 2 }}>
        <Text fg={COLOR.bright}>Queued</Text>
        <Text fg={COLOR.dim}>{"  2 messages"}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pager position={2} count={3} onPage={noop} />
      </Box>
    </Terminal>
  );
}
