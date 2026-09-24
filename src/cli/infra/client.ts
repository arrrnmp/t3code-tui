/**
 * The CLI's `ClientApi`. Every command talks to the server through this,
 * the same contract the TUI uses: a running moxen server when there is one
 * (`MOXEN_SERVER`, see `server/client.ts`), the in-process connection
 * otherwise.
 *
 * Not closed after a command: closing an in-process connection stops its
 * drivers, which would end the run a `--no-wait` command just started.
 * The process exit ends them. (Over a server, the run lives on there.)
 */
import type { ClientApi } from "../../server/api.js";
import { openClient, type ClientConnection } from "../../server/client.js";
import type { TurnDriverFactories } from "../../server/connection.js";
import type { CliConfig } from "../../core/types.js";

export type { TurnDriverFactories } from "../../server/connection.js";

let factory: ((config: CliConfig) => Promise<ClientConnection>) | null = null;
let forceDirect = false;

/** Tests: route every command through a given client (e.g. over the wire). */
export function setClientFactory(next: ((config: CliConfig) => Promise<ClientConnection>) | null): void {
  factory = next;
}

/**
 * An explicit `--config` file applies to this invocation only; a running
 * server resolves defaults from its own config, so such a command stays
 * in-process rather than silently ignoring the flag.
 */
export function preferDirectClient(value: boolean): void {
  forceDirect = value;
}

export async function cliClient(config: CliConfig, drivers?: TurnDriverFactories): Promise<ClientApi> {
  if (factory) return await factory(config);
  return await openClient({
    config,
    ...(drivers ? { drivers, mode: "direct" as const } : forceDirect ? { mode: "direct" as const } : {}),
  });
}

/**
 * Block until a turn settles. A one-shot CLI is often the only process
 * running the turn, so returning early would strand it `running`; Ctrl-C
 * interrupts the turn (keeping the thread) and exits 130.
 */
export async function awaitTurn(client: ClientApi, threadId: string, turnId: string): Promise<void> {
  const onSigint = (): void => {
    void client
      .dispatch({ type: "thread.turn.interrupt", threadId })
      .catch(() => undefined)
      .finally(() => process.exit(130));
  };
  process.once("SIGINT", onSigint);
  try {
    await client.query({ type: "thread.turn.await", threadId, turnId });
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}
