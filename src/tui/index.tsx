import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { CliError } from "../errors.js";
import { resolveStoreRoot } from "../threads/store.js";
import type { CliConfig } from "../types.js";
import { App } from "./app/app.js";
import { DirectConnection } from "./client/direct.js";
import { registerSyntaxParsers } from "./syntax/register.js";
import { SURFACE } from "./theme.js";
import { MinSizeGate } from "./ui/terminalgate.js";

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

  // Before the first render so the global tree-sitter client picks them up.
  await registerSyntaxParsers();
  const connection = new DirectConnection({ storeRoot: resolveStoreRoot() });
  const renderer = await createCliRenderer({ exitOnCtrlC: false, backgroundColor: SURFACE.base });
  const root = createRoot(renderer);

  try {
    await new Promise<void>((resolve) => {
      root.render(
        <MinSizeGate onQuit={resolve}>
          <App
            client={connection}
            onQuit={resolve}
            cwd={process.cwd()}
            stateDir={null}
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
}
