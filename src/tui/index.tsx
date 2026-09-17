import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { withT3Session } from "../infra/api.js";
import { discoverRuntime, resolveT3Home } from "../infra/runtime.js";
import type { CliConfig } from "../types.js";
import { App } from "./app.js";
import { T3Connection } from "./client/connection.js";
import { SURFACE } from "./theme.js";

/**
 * The session outlives every command in this CLI, so it is issued with a long
 * TTL and revoked by `withT3Session` when the user quits.
 */
const TUI_SESSION_TTL = "12h";

export async function runTui(config: CliConfig): Promise<void> {
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });

  await withT3Session(runtime, { ...config, sessionTtl: TUI_SESSION_TTL }, async (token) => {
    const connection = await T3Connection.open(runtime, token);    const renderer = await createCliRenderer({ exitOnCtrlC: false, backgroundColor: SURFACE.base });
    const root = createRoot(renderer);

    try {
      await new Promise<void>((resolve) => {
        root.render(
          <App
            client={connection}
            onQuit={resolve}
            t3Home={resolveT3Home(config)}
            cwd={process.cwd()}
            stateDir={runtime.stateDir ?? null}
            setTerminalTitle={(title) => renderer.setTerminalTitle(title)}
          />,
        );
      });
    } finally {
      root.unmount();
      renderer.destroy();
      await connection.close();
    }
  });
}
