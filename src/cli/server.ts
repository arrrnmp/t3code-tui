/**
 * `moxen server start|status|stop`: run and manage the shared server
 * (`server/main.ts`). Clients find it on their own (`MOXEN_SERVER=auto`,
 * the default), so starting one is all it takes to move every TUI and CLI
 * invocation onto it.
 */
import { CliError } from "../core/errors.js";
import type { CliConfig } from "../core/types.js";
import { closeOnSignals, runServer } from "../server/main.js";
import { defaultEndpoint, probe } from "../server/transport/endpoint.js";
import { RemoteConnection } from "../server/transport/remote.js";

export async function serverStart(
  context: { config: CliConfig; configPath: string },
  onListening: (result: { endpoint: string; pid: number }) => void,
): Promise<void> {
  const handle = await runServer();
  onListening({ endpoint: handle.endpoint, pid: process.pid });
  closeOnSignals(handle);
  await handle.closed;
}

export async function serverStatus() {
  const endpoint = defaultEndpoint();
  if (!(await probe(endpoint))) return { endpoint, running: false as const, pid: null, protocol: null };
  const connection = await RemoteConnection.connect(endpoint, { reconnect: false });
  try {
    const hello = connection.helloResult;
    return { endpoint, running: true as const, pid: hello?.pid ?? null, protocol: hello?.protocol ?? null };
  } finally {
    await connection.close();
  }
}

export async function serverStop() {
  const endpoint = defaultEndpoint();
  if (!(await probe(endpoint))) return { endpoint, stopped: false as const };
  const connection = await RemoteConnection.connect(endpoint, { reconnect: false });
  try {
    await connection.shutdownServer();
  } finally {
    await connection.close();
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await probe(endpoint))) return { endpoint, stopped: true as const };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new CliError("SERVER_STOP_FAILED", `The moxen server at ${endpoint} acknowledged stop but is still listening.`, {
    details: { endpoint },
  });
}
