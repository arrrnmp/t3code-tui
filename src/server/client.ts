/**
 * How a frontend gets its `ClientApi`: the one factory both clients call.
 *
 * - `direct`  — in-process `DirectConnection`. The client owns its drivers;
 *               what it starts lives and dies with it.
 * - `auto`    — a running moxen server if there is one, else `direct`.
 *               The default: nothing changes until a server is started.
 * - `daemon`  — a moxen server, started detached if none is running. Turns
 *               outlive the client that started them, and every client
 *               sees (and can act on) every live session.
 *
 * Chosen by `MOXEN_SERVER`; `auto` when unset.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { appEnv } from "../core/config.js";
import { CliError } from "../core/errors.js";
import type { CliConfig } from "../core/types.js";
import type { ClientApi } from "./api.js";
import { DirectConnection, type TurnDriverFactories } from "./connection.js";
import { defaultEndpoint, probe } from "./transport/endpoint.js";
import { RemoteConnection } from "./transport/remote.js";

export type ServerMode = "direct" | "auto" | "daemon";

/** A `ClientApi` its owner can release. */
export type ClientConnection = ClientApi & { close(): Promise<void> };

export function serverMode(env: NodeJS.ProcessEnv = process.env): ServerMode {
  const raw = appEnv("SERVER", env)?.trim().toLowerCase();
  if (raw === undefined || raw === "") return "auto";
  if (raw === "direct" || raw === "auto" || raw === "daemon") return raw;
  throw new CliError("INVALID_CONFIG", `MOXEN_SERVER must be direct, auto, or daemon (got "${raw}").`, {
    exitCode: 2,
  });
}

export interface OpenClientOptions {
  readonly mode?: ServerMode;
  readonly endpoint?: string;
  /** In-process only: the config the connection resolves defaults from. */
  readonly config?: CliConfig;
  /** In-process only: driver factories (tests). */
  readonly drivers?: TurnDriverFactories;
}

const AUTOSTART_TIMEOUT_MS = 10_000;

export async function openClient(options: OpenClientOptions = {}): Promise<ClientConnection> {
  const mode = options.mode ?? serverMode();
  const endpoint = options.endpoint ?? defaultEndpoint();
  const direct = (): ClientConnection =>
    new DirectConnection({
      ...(options.config ? { config: async () => options.config! } : {}),
      ...(options.drivers ? { drivers: options.drivers } : {}),
    });
  if (mode === "direct") return direct();
  if (await probe(endpoint)) return await RemoteConnection.connect(endpoint);
  if (mode === "auto") return direct();
  await startDaemon(endpoint);
  return await RemoteConnection.connect(endpoint);
}

/** Start `./main.ts` detached and wait until it accepts connections. */
async function startDaemon(endpoint: string): Promise<void> {
  const entry = fileURLToPath(new URL("./main.ts", import.meta.url));
  // The server is Bun (it runs TypeScript directly): this runtime when it
  // is Bun, else `bun` from PATH — e.g. when the caller runs under Node.
  const runtime = process.versions.bun ? process.execPath : "bun";
  const child = spawn(runtime, [entry], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, MOXEN_SERVER_ENDPOINT: endpoint },
  });
  child.unref();
  const deadline = Date.now() + AUTOSTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probe(endpoint)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new CliError("SERVER_START_FAILED", `Started a moxen server but it never listened at ${endpoint}.`, {
    details: { endpoint, pid: child.pid ?? null },
  });
}
