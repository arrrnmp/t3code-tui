import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

import { T3Api, withT3Session } from "../infra/api.js";
import { CliError } from "../../errors.js";
import type { T3Invocation } from "../infra/process.js";
import type { CliConfig, T3Runtime } from "../../types.js";

// Wire method names from T3's own RPC contracts (packages/contracts/src/rpc.ts).
// Payloads are minimal by design; responses decode as unknown so a T3 version
// that extends its schemas cannot break this client — field extraction lives
// in catalog.ts and fails explicitly when load-bearing shapes drift.
const ServerGetConfigRpc = Rpc.make("server.getConfig", {
  payload: Schema.Struct({}),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

const ServerRefreshProvidersRpc = Rpc.make("server.refreshProviders", {
  payload: Schema.Struct({
    instanceId: Schema.optional(Schema.String),
    refreshModels: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

const WsRpcGroup = RpcGroup.make(ServerGetConfigRpc, ServerRefreshProvidersRpc);

export type WsMethod = "server.getConfig" | "server.refreshProviders";

const DEFAULT_TIMEOUTS_MS: Record<WsMethod, number> = {
  "server.getConfig": 30_000,
  "server.refreshProviders": 120_000,
};

function wsUrlFor(origin: string, ticket: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  url.searchParams.set("wsTicket", ticket);
  return url.toString();
}

async function requestWsTicket(api: T3Api): Promise<string> {
  const body = (await api.request("POST", "/api/auth/websocket-ticket")) as { ticket?: unknown } | null;
  const ticket = body !== null && typeof body === "object" ? body.ticket : undefined;
  if (typeof ticket !== "string" || ticket.trim().length === 0) {
    throw new CliError("T3_WS_TICKET_FAILED", "T3 did not return a websocket ticket.", {
      details: { path: "/api/auth/websocket-ticket" },
    });
  }
  return ticket;
}

function wsConstructorLayer(sockets: Array<{ close(): void }>) {
  const constructor = ((url: string | URL, protocols?: string | string[]) => {
    const socket = new WebSocket(url, protocols);
    sockets.push(socket);
    return socket;
  }) as never;
  return Layer.succeed(Socket.WebSocketConstructor, constructor);
}

async function callRpc(url: string, method: WsMethod, payload: Record<string, unknown>): Promise<unknown> {
  const sockets: Array<{ close(): void }> = [];
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url).pipe(Layer.provide(wsConstructorLayer(sockets)))),
    Layer.provide(RpcSerialization.layerJson),
  );
  const program = Effect.gen(function* () {
    const client = yield* RpcClient.make(WsRpcGroup);
    if (method === "server.getConfig") return yield* client["server.getConfig"]({});
    return yield* client["server.refreshProviders"]({
      ...(typeof payload.instanceId === "string" ? { instanceId: payload.instanceId } : {}),
      ...(typeof payload.refreshModels === "boolean" ? { refreshModels: payload.refreshModels } : {}),
    });
  }).pipe(Effect.timeoutOption(Duration.millis(DEFAULT_TIMEOUTS_MS[method])));
  try {
    const result = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(protocol))));
    if (Option.isNone(result)) {
      throw new CliError("T3_WS_TIMEOUT", `T3 did not answer ${method} within ${DEFAULT_TIMEOUTS_MS[method] / 1000} seconds.`, {
        details: { method },
      });
    }
    return result.value;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("T3_WS_RPC_FAILED", `T3 websocket call failed: ${method}.`, { cause: error });
  } finally {
    for (const socket of sockets.splice(0)) {
      try {
        socket.close();
      } catch {
        // Closing is best-effort; the scope finalizer owns the socket.
      }
    }
  }
}

export async function withWsRpc<T>(
  runtime: T3Runtime,
  config: CliConfig,
  run: (
    call: (method: WsMethod, payload?: Record<string, unknown>) => Promise<unknown>,
    invocation: T3Invocation,
  ) => Promise<T>,
): Promise<T> {
  return await withT3Session(runtime, config, async (token, invocation) => {
    const api = new T3Api(runtime, token);
    const ticket = await requestWsTicket(api);
    const url = wsUrlFor(runtime.origin, ticket);
    return await run((method, payload) => callRpc(url, method, payload ?? {}), invocation);
  });
}
