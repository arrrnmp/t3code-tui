import { Terminal, Box, Text, RenameModal, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};

function ChatBehind() {
  return (
    <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Fix the CI flake " titleColor={COLOR.dim} style={{ flexGrow: 1, paddingLeft: 1 }}>
      <Text fg={COLOR.user}>› The e2e job times out on the Windows runner about one run in five.</Text>
      <Text fg={COLOR.text}>The watcher test waits on a real fs event; I'll swap it for a poll.</Text>
    </Box>
  );
}

/** Renaming a thread: prefilled title, enter renames, esc cancels. */
export function RenameThread() {
  return (
    <Terminal width={80} height={12}>
      <ChatBehind />
      <RenameModal initialTitle="Fix the CI flake" screenWidth={80} screenHeight={12} left={10} top={3} width={60} height={7} onSubmit={noop} onClose={noop} />
    </Terminal>
  );
}

/** The answer flow's reuse: a custom answer with its own title, placeholder and hint. */
export function CustomAnswer() {
  return (
    <Terminal width={80} height={12}>
      <ChatBehind />
      <RenameModal
        initialTitle=""
        title="Your answer"
        placeholder="Type an answer for the agent"
        hint="enter sends · esc goes back to the choices"
        maxLength={2000}
        screenWidth={80}
        screenHeight={12}
        left={10}
        top={3}
        width={60}
        height={7}
        onSubmit={noop}
        onClose={noop}
      />
    </Terminal>
  );
}
