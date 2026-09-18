import type { CliRenderer } from "@opentui/core";
import { createClipboard, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core";

const SSH_ENV_VARS = ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "MOSH_CONNECTION"] as const;

/**
 * True when `t3code tui` itself runs inside an SSH/Mosh session (remote box,
 * local eyes). The host OS clipboard then belongs to the *remote* machine,
 * so copies must travel back over the wire as OSC 52 instead.
 */
export function isSshSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return SSH_ENV_VARS.some((key) => typeof env[key] === "string" && (env[key] as string).length > 0);
}

// Note on "OSC 5522": it is real — Kitty's clipboard extension for arbitrary
// MIME types including images (`ESC ] 5522 ; …`, see
// `model/terminalClipboard.ts`). Plain OSC 52 (`ESC ] 52 ; c ; <base64> BEL`)
// stays text-only. Pasting *from* the clipboard over plain OSC 52 has no
// read-back path — images arrive via 5522 or via the host clipboard.

interface RendererOsc52 {
  copyToClipboardOSC52?: (text: string) => boolean;
}

/**
 * One write path for both the host OS clipboard and OSC 52 (the SSH-safe
 * escape-sequence clipboard, so a copy still lands on the user's machine when
 * `t3code tui` runs on a remote box over SSH).
 *
 * Routing: over SSH (`isSshSession()` or the renderer's own `remote` flag)
 * the host backend is skipped — writing to it would target the remote box —
 * and the copy goes terminal-only (OSC 52). Locally both are attempted
 * (`"all-available"`). A direct `copyToClipboardOSC52` call is the last
 * resort when the service reports nothing attempted.
 */
export function createTuiClipboard(
  renderer: CliRenderer,
  env: NodeJS.ProcessEnv = process.env,
): { copyText: (text: string) => Promise<boolean>; isRemote: () => boolean } {
  const terminal = createRendererClipboardAdapter(renderer);
  const clipboard = createClipboard({
    host: createHostClipboard(),
    terminal,
  });
  const remote = (): boolean => {
    if (isSshSession(env)) return true;
    try {
      return (terminal as { remote?: unknown }).remote === true;
    } catch {
      return false;
    }
  };
  return {
    isRemote: remote,
    async copyText(text: string): Promise<boolean> {
      if (text.length === 0) return false;
      const destination = remote() ? "terminal-only" : "all-available";
      try {
        const result = await clipboard.writeText(text, { destination });
        if (result.terminal.status === "attempted" || result.host.status === "written") return true;
      } catch {
        // Fall through to the direct OSC 52 attempt below.
      }
      try {
        const direct = (renderer as unknown as RendererOsc52).copyToClipboardOSC52;
        if (typeof direct === "function" && direct.call(renderer, text) === true) return true;
      } catch {
        // Host-only remains the last resort on local sessions.
      }
      if (!remote()) {
        try {
          const fallback = await clipboard.writeText(text, { destination: "host-only" });
          return fallback.host.status === "written";
        } catch {
          return false;
        }
      }
      return false;
    },
  };
}
