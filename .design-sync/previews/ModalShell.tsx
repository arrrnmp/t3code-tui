import { Terminal, Box, Text, ModalShell, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};

function ChatBehind() {
  return (
    <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Port the settings page to configschema " titleColor={COLOR.dim} style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
      <Text fg={COLOR.user}>› Render every row from the schema table, no key lists in the TUI.</Text>
      <Text fg={COLOR.text}>Done. SettingsModal now reads SETTING_SECTIONS and describeSettings;</Text>
      <Text fg={COLOR.text}>a new descriptor shows up in `moxen config` and the page together.</Text>
      <Text fg={COLOR.tool}>  ✓ Edit src/tui/features/settings/settingsmodal.tsx  +84 −212</Text>
      <Text fg={COLOR.tool}>  ✓ Bash bun run check  1,284 pass</Text>
    </Box>
  );
}

/** The quit confirmation: dimmed backdrop over the chat, a borderless raised panel. */
export function QuitConfirm() {
  return (
    <Terminal width={80} height={14}>
      <ChatBehind />
      <ModalShell screenWidth={80} screenHeight={14} left={5} top={2} width={70} height={10} onClose={noop}>
        <Box style={{ flexDirection: "column", flexGrow: 1 }}>
          <Text fg={COLOR.bright}>Quit moxen?</Text>
          <Box style={{ height: 1, flexShrink: 0 }} />
          <Text fg={COLOR.dim}>Open thread: Port the settings page to configschema</Text>
          <Text fg={COLOR.dim}>Ctrl+C cleared the prompt — quitting never sends it.</Text>
          <Box style={{ flexGrow: 1 }} />
          <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "flex-end" }}>
            <Text fg={COLOR.dim} bg={SURFACE.raised}>{" Cancel (esc) "}</Text>
            <Text fg={COLOR.dim} bg={SURFACE.raised}>{"  "}</Text>
            <Text fg={COLOR.danger} bg={SURFACE.raised}>{" Quit (enter / ctrl+c again) "}</Text>
          </Box>
        </Box>
      </ModalShell>
    </Terminal>
  );
}

/** Bare chrome: the padded panel with a title row and a hint. */
export function Panel() {
  return (
    <Terminal width={80} height={10}>
      <ChatBehind />
      <ModalShell screenWidth={80} screenHeight={10} left={18} top={2} width={44} height={6} onClose={noop}>
        <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
          <Text fg={COLOR.bright} bg={SURFACE.raised}>Delete thread</Text>
          <Text fg={COLOR.faint} bg={SURFACE.raised}>esc</Text>
        </Box>
        <Box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
          <Text fg={COLOR.faint} bg={SURFACE.raised}>enter deletes · esc cancels</Text>
        </Box>
      </ModalShell>
    </Terminal>
  );
}
