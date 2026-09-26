/**
 * The moxen server process: one `DirectConnection` — the store, the
 * drivers, every live provider session — served over the local endpoint
 * to any number of clients.
 *
 * Run it in the foreground with `moxen server start`, or let a client
 * start it (`MOXEN_SERVER=daemon`, see `./client.ts`), which runs this
 * file detached.
 */
import type { CliConfig } from "../core/types.js";
import { DirectConnection } from "./connection.js";
import { defaultEndpoint } from "./transport/endpoint.js";
import { serve, type ServerHandle } from "./transport/serve.js";

export interface RunServerOptions {
  readonly endpoint?: string;
  /** Config source; defaults to re-reading the user's config per operation. */
  readonly config?: () => Promise<CliConfig>;
}

export async function runServer(options: RunServerOptions = {}): Promise<ServerHandle> {
  const connection = new DirectConnection(options.config ? { config: options.config } : {});
  try {
    const handle = await serve({
      endpoint: options.endpoint ?? defaultEndpoint(),
      api: connection,
      // Stops every driver: provider processes end with the server.
      onClose: () => connection.close(),
    });
    // The server owns every session, so it runs scheduled turns too — with
    // or without a client attached.
    connection.startScheduling();
    return handle;
  } catch (cause) {
    await connection.close();
    throw cause;
  }
}

/** Stop on the usual signals, releasing the drivers first. */
export function closeOnSignals(handle: ServerHandle): void {
  const stop = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (import.meta.main) {
  // Detached autostart: stdio is ignored, so a failure is reported through
  // the exit code only; the client that started us sees the endpoint stay
  // silent and reports that instead.
  runServer().then(
    (handle) => {
      closeOnSignals(handle);
      void handle.closed.then(() => process.exit(0));
    },
    () => process.exit(1),
  );
}
