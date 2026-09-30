import { Terminal, Box, Text, SideQuestionModal, COLOR, SURFACE } from "@moxen/tui";

const noop = () => {};
const frame = { screenWidth: 80, screenHeight: 20, left: 4, top: 2, width: 72, height: 14, onCopy: noop, onClose: noop };
const base = { id: 1, threadId: "t-auth", question: "Which auth scheme did we settle on?", error: null, withContext: true };

function ChatBehind() {
  return (
    <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Harden the session middleware " titleColor={COLOR.dim} style={{ flexGrow: 1, paddingLeft: 1 }}>
      <Text fg={COLOR.user}>› Rotate refresh tokens on every use and revoke the family on reuse.</Text>
      <Text fg={COLOR.text}>Reading src/auth.ts and src/session/store.ts first.</Text>
    </Box>
  );
}

/** Answered: the question, the answer, and the note that nothing reached the thread. */
export function Answered() {
  return (
    <Terminal width={80} height={20}>
      <ChatBehind />
      <SideQuestionModal
        {...frame}
        entry={{
          ...base,
          status: "answered",
          answer:
            "JWTs, verified in src/auth.ts. Access tokens live 15 minutes and are signed with the rotating key set in config/keys; refresh tokens are opaque, stored hashed in the sessions table, and revoked by family on reuse.",
        }}
      />
    </Terminal>
  );
}

/** Still asking on a copy of the thread: spinner, no copy button yet. */
export function Asking() {
  return (
    <Terminal width={80} height={20}>
      <ChatBehind />
      <SideQuestionModal {...frame} entry={{ ...base, question: "Does the refresh route rate-limit per user or per IP?", status: "asking", answer: null }} />
    </Terminal>
  );
}

/** Failed: the error in danger red. */
export function Failed() {
  return (
    <Terminal width={80} height={20}>
      <ChatBehind />
      <SideQuestionModal {...frame} entry={{ ...base, status: "failed", answer: null, error: "Claude could not start a side session: usage limit reached until 3:00 PM." }} />
    </Terminal>
  );
}

/** No session to copy yet: answered without the thread's context. */
export function NoContext() {
  return (
    <Terminal width={80} height={20}>
      <ChatBehind />
      <SideQuestionModal
        {...frame}
        entry={{ ...base, withContext: false, question: "What does `bun run check` run?", status: "answered", answer: "Without the thread's context I can only guess from the name: usually a typecheck plus the test suite." }}
      />
    </Terminal>
  );
}
