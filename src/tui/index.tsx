import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { withT3Session } from "../cli/infra/api.js";
import { discoverRuntime, resolveT3Home } from "../cli/infra/runtime.js";
import { CliError } from "../errors.js";
import type { CliConfig } from "../types.js";
import { App } from "./app/app.js";
import { T3Connection } from "./client/connection.js";
import { registerSyntaxParsers } from "./syntax/register.js";
import { SURFACE } from "./theme.js";
import { MinSizeGate } from "./ui/terminalgate.js";

/**
 * The session outlives every command in this CLI, so it is issued with a long
 * TTL and revoked by `withT3Session` when the user quits.
 */
const TUI_SESSION_TTL = "12h";

export async function runTui(config: CliConfig): Promise<void> {
  // Fail fast when there is no pty at all (piped output, `ssh` without
  // `-t`): the renderer cannot size or restore the screen, so a plain
  // error beats a garbled one. Real resizes — local, tmux, or over SSH —
  // are handled live inside the app by `MinSizeGate` via SIGWINCH.
  if (process.stdout.isTTY !== true) {
    throw new CliError("TERMINAL_REQUIRED", "t3code tui needs an interactive terminal (over SSH, connect with ssh -t).", {
      exitCode: 2,
    });
  }
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });

  await withT3Session(runtime, { ...config, sessionTtl: TUI_SESSION_TTL }, async (token) => {
    // Before the first render so the global tree-sitter client picks them up.
    await registerSyntaxParsers();
    const connection = await T3Connection.open(runtime, token);    const renderer = await createCliRenderer({ exitOnCtrlC: false, backgroundColor: SURFACE.base });
    const root = createRoot(renderer);

    try {
      await new Promise<void>((resolve) => {
        root.render(
          <MinSizeGate>
            <App
              client={connection}
              onQuit={resolve}
              t3Home={resolveT3Home(config)}
              cwd={process.cwd()}
              stateDir={runtime.stateDir ?? null}
              setTerminalTitle={(title) => renderer.setTerminalTitle(title)}
            />
          </MinSizeGate>,
        );
      });
    } finally {
      root.unmount();
      renderer.destroy();
      await connection.close();
    }
  });
}
