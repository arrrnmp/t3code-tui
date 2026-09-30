import { Terminal, LoadingScreen } from "@moxen/tui";

/** Boot gate waiting on the shell snapshot (thread list, projects). */
export function Threads() {
  return (
    <Terminal width={80} height={12}>
      <LoadingScreen stage="threads" />
    </Terminal>
  );
}

/** Shell landed; waiting on the opened thread's transcript. */
export function Transcript() {
  return (
    <Terminal width={80} height={12}>
      <LoadingScreen stage="transcript" />
    </Terminal>
  );
}
