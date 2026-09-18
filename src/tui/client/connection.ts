import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

import { CliError } from "../../errors.js";
import { T3Api } from "../../cli/infra/api.js";
import type { T3Runtime } from "../../types.js";

// Subscriptions decode as `unknown` on purpose: the TUI reads a narrow set of
// fields through its own structural decoders, so a T3 release that extends
// these payloads cannot break the connection layer.
const SubscribeShellRpc = Rpc.make("orchestration.subscribeShell", {
  payload: Schema.Struct({
    afterSequence: Schema.optional(Schema.Number),
    requestCompletionMarker: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Unknown,
  error: Schema.Unknown,
  stream: true,
});

const SubscribeThreadRpc = Rpc.make("orchestration.subscribeThread", {
  payload: Schema.Struct({
    threadId: Schema.String,
    afterSequence: Schema.optional(Schema.Number),
    requestCompletionMarker: Schema.optional(Schema.Boolean),
    acceptBoundedSnapshot: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Unknown,
  error: Schema.Unknown,
  stream: true,
});

const GetTurnDiffRpc = Rpc.make("orchestration.getTurnDiff", {
  payload: Schema.Struct({
    threadId: Schema.String,
    fromTurnCount: Schema.Number,
    toTurnCount: Schema.Number,
    ignoreWhitespace: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

const ServerGetConfigRpc = Rpc.make("server.getConfig", {
  payload: Schema.Struct({}),
  success: Schema.Unknown,
  error: Schema.Unknown,
});

const OrchestrationRpcs = RpcGroup.make(SubscribeShellRpc, SubscribeThreadRpc, GetTurnDiffRpc, ServerGetConfigRpc);

type OrchestrationClient = {
  readonly "orchestration.subscribeShell": (payload: {
    afterSequence?: number;
    requestCompletionMarker?: boolean;
  }) => Stream.Stream<unknown, unknown>;
  readonly "orchestration.subscribeThread": (payload: {
    threadId: string;
    afterSequence?: number;
    requestCompletionMarker?: boolean;
    acceptBoundedSnapshot?: boolean;
  }) => Stream.Stream<unknown, unknown>;
  readonly "orchestration.getTurnDiff": (payload: {
    threadId: string;
    fromTurnCount: number;
    toTurnCount: number;
    ignoreWhitespace?: boolean;
  }) => Effect.Effect<unknown, unknown>;
  readonly "server.getConfig": (payload: {}) => Effect.Effect<unknown, unknown>;
};

function websocketUrl(origin: string, ticket: string): string {
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
    throw new CliError("T3_WS_TICKET_FAILED", "T3 did not return a websocket ticket.");
  }
  return ticket;
}

export type Unsubscribe = () => void;

/**
 * A websocket connection held open for the lifetime of the TUI. Unlike the
 * one-shot CLI commands, subscriptions stay attached so the server pushes
 * changes instead of the client polling for them.
 */
export class T3Connection {
  private constructor(
    readonly api: T3Api,
    private readonly client: OrchestrationClient,
    private readonly scope: Scope.Closeable,
  ) {}

  static async open(runtime: T3Runtime, token: string): Promise<T3Connection> {
    const api = new T3Api(runtime, token);
    const ticket = await requestWsTicket(api);
    const url = websocketUrl(runtime.origin, ticket);

    const protocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(url)),
      Layer.provide(
        Layer.succeed(Socket.WebSocketConstructor, ((target: string | URL) => new WebSocket(target)) as never),
      ),
      Layer.provide(RpcSerialization.layerJson),
    );

    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.buildWithScope(protocol, scope);
        return yield* RpcClient.make(OrchestrationRpcs).pipe(Effect.provide(context));
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    ).catch((cause) => {
      throw new CliError("T3_WS_CONNECT_FAILED", "Could not open the T3 websocket.", { cause });
    });

    return new T3Connection(api, client as unknown as OrchestrationClient, scope);
  }

  private consume(stream: Stream.Stream<unknown, unknown>, onItem: (item: unknown) => void, onError: (error: unknown) => void): Unsubscribe {
    const fiber = Effect.runFork(
      Stream.runForEach(stream, (item) => Effect.sync(() => onItem(item))).pipe(
        Effect.catchCause((cause) => Effect.sync(() => onError(cause))),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }

  subscribeShell(
    options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.consume(
      this.client["orchestration.subscribeShell"]({
        ...(options.afterSequence === undefined ? {} : { afterSequence: options.afterSequence }),
        requestCompletionMarker: true,
      }),
      onItem,
      onError,
    );
  }

  subscribeThread(
    threadId: string,
    options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.consume(
      this.client["orchestration.subscribeThread"]({
        threadId,
        ...(options.afterSequence === undefined ? {} : { afterSequence: options.afterSequence }),
        requestCompletionMarker: true,
        acceptBoundedSnapshot: true,
      }),
      onItem,
      onError,
    );
  }

  /** Unified patch for one turn, taken from the checkpoint pair around it. */
  async turnDiff(threadId: string, toTurnCount: number): Promise<string | null> {
    const result = await Effect.runPromise(
      this.client["orchestration.getTurnDiff"]({
        threadId,
        fromTurnCount: Math.max(0, toTurnCount - 1),
        toTurnCount,
      }).pipe(Effect.catchCause(() => Effect.succeed(null))),
    );
    const record = result !== null && typeof result === "object" ? (result as Record<string, unknown>) : null;
    return typeof record?.diff === "string" ? record.diff : null;
  }

  async dispatch(command: unknown): Promise<unknown> {
    return await this.api.dispatch(command);
  }

  /** Provider catalog for the model picker; decoded by `extractProviders`. */
  async getConfig(): Promise<unknown> {
    return await Effect.runPromise(this.client["server.getConfig"]({}));
  }

  async close(): Promise<void> {
    await Effect.runPromise(Scope.close(this.scope, Exit.succeed(undefined))).catch(() => undefined);
  }
}
