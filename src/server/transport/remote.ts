/**
 * `ClientApi` over the wire (`./wire.ts`): what a client uses when a
 * moxen server is running, instead of owning drivers itself.
 *
 * Requests are matched to responses by id. A dropped connection rejects
 * whatever was in flight with `SERVER_DISCONNECTED` — a command may or may
 * not have run, and only the caller can decide whether to retry it — but
 * subscriptions survive: the client reconnects and re-subscribes, and
 * because every subscription opens with a full snapshot, the subscriber
 * is back in sync on the first frame, with nothing to replay.
 */
import net from "node:net";

import { CliError } from "../../core/errors.js";
import type { ClientApi } from "../api.js";
import type {
  CommandOf,
  CommandResult,
  CommandType,
  ConfigPayload,
  QueryOf,
  QueryResult,
  QueryType,
  ShellFrame,
  ThreadFrame,
} from "../protocol.js";
import {
  encode,
  fromWireError,
  LineReader,
  parseLine,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HelloResult,
  type WireError,
} from "./wire.js";

type Method = ClientMessage["method"];

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

interface Subscription {
  readonly method: "subscribeShell" | "subscribeThread";
  readonly params: Record<string, unknown>;
  readonly onItem: (item: unknown) => void;
  readonly onError: (error: unknown) => void;
  /** The server-side id on the current socket; null while (re)connecting. */
  remote: number | null;
  /** A subscribe request is in flight; a second one would double every frame. */
  subscribing: boolean;
}

const RECONNECT_MIN_MS = 200;
const RECONNECT_MAX_MS = 2_000;

export interface RemoteConnectionOptions {
  /** Reconnect and re-subscribe after the server goes away (default true). */
  readonly reconnect?: boolean;
}

export class RemoteConnection implements ClientApi {
  private socket: net.Socket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly subscriptions = new Set<Subscription>();
  private closed = false;
  private reconnecting: Promise<void> | null = null;
  helloResult: HelloResult | null = null;

  private constructor(
    readonly endpoint: string,
    private readonly options: RemoteConnectionOptions,
  ) {}

  /** Connects and completes the protocol handshake, or throws. */
  static async connect(endpoint: string, options: RemoteConnectionOptions = {}): Promise<RemoteConnection> {
    const connection = new RemoteConnection(endpoint, options);
    await connection.open();
    return connection;
  }

  private async open(): Promise<void> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const candidate = net.connect(this.endpoint);
      candidate.once("connect", () => {
        candidate.off("error", reject);
        resolve(candidate);
      });
      candidate.once("error", (cause) =>
        reject(
          new CliError("SERVER_UNAVAILABLE", `No moxen server is listening at ${this.endpoint}.`, {
            cause,
            details: { endpoint: this.endpoint },
          }),
        ),
      );
    });
    socket.setEncoding("utf8");
    const reader = new LineReader();
    socket.on("data", (chunk: string) => {
      for (const line of reader.push(chunk)) this.receive(line);
    });
    socket.on("error", () => undefined);
    socket.once("close", () => this.onClose(socket));
    this.socket = socket;
    this.helloResult = (await this.request("hello", { protocol: PROTOCOL_VERSION })) as HelloResult;
    for (const subscription of this.subscriptions) await this.resubscribe(subscription);
  }

  private receive(line: string): void {
    const message = parseLine(line);
    if (message === null) return;
    if (typeof message.subscription === "number") {
      const subscription = [...this.subscriptions].find((candidate) => candidate.remote === message.subscription);
      if (!subscription) return;
      if ("error" in message) subscription.onError(fromWireError(message.error as WireError));
      else subscription.onItem(message.item);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if ("error" in message) pending.reject(fromWireError(message.error as WireError));
    else pending.resolve(message.result);
  }

  private request(method: Method, params?: unknown): Promise<unknown> {
    return this.send(method, params).response;
  }

  /** Like `request`, but the id is known before any reply can arrive. */
  private send(method: Method, params?: unknown): { id: number | null; response: Promise<unknown> } {
    const socket = this.socket;
    if (this.closed || socket === null || socket.destroyed) {
      return {
        id: null,
        response: Promise.reject(
          new CliError("SERVER_DISCONNECTED", "The connection to the moxen server is closed.", {
            details: { endpoint: this.endpoint },
          }),
        ),
      };
    }
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    socket.write(encode({ id, method, ...(params === undefined ? {} : { params }) } as ClientMessage));
    return { id, response };
  }

  private onClose(socket: net.Socket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    for (const subscription of this.subscriptions) subscription.remote = null;
    const inFlight = [...this.pending.values()];
    this.pending.clear();
    for (const pending of inFlight) {
      pending.reject(
        new CliError("SERVER_DISCONNECTED", "The moxen server went away before answering.", {
          details: { endpoint: this.endpoint },
        }),
      );
    }
    if (!this.closed && this.options.reconnect !== false && this.subscriptions.size > 0) void this.reconnect();
  }

  private reconnect(): Promise<void> {
    this.reconnecting ??= (async () => {
      let delay = RECONNECT_MIN_MS;
      while (!this.closed && this.socket === null && this.subscriptions.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          await this.open();
        } catch {
          delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        }
      }
    })().finally(() => {
      this.reconnecting = null;
    });
    return this.reconnecting;
  }

  private async resubscribe(subscription: Subscription): Promise<void> {
    if (subscription.subscribing || subscription.remote !== null) return;
    subscription.subscribing = true;
    // The server names the subscription after the request id, and its first
    // frame can arrive in the same chunk as the reply — before an `await`
    // here would resume. So the id is claimed as the request goes out.
    const { id, response } = this.send(subscription.method, subscription.params);
    subscription.remote = id;
    try {
      await response;
      if (!this.subscriptions.has(subscription) && id !== null) {
        void this.request("unsubscribe", { subscription: id }).catch(() => undefined);
      }
    } catch (cause) {
      subscription.remote = null;
      subscription.onError(cause);
    } finally {
      subscription.subscribing = false;
    }
  }

  private subscribe(
    method: Subscription["method"],
    params: Record<string, unknown>,
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void {
    const subscription: Subscription = { method, params, onItem, onError, remote: null, subscribing: false };
    this.subscriptions.add(subscription);
    if (this.socket) void this.resubscribe(subscription);
    else void this.reconnect();
    return () => {
      this.subscriptions.delete(subscription);
      if (subscription.remote !== null) {
        void this.request("unsubscribe", { subscription: subscription.remote }).catch(() => undefined);
      }
    };
  }

  // -- ClientApi ---------------------------------------------------------------

  subscribeShell(
    options: { afterSequence?: number },
    onItem: (item: ShellFrame) => void,
    onError: (error: unknown) => void,
  ): () => void {
    return this.subscribe("subscribeShell", { ...options }, onItem as (item: unknown) => void, onError);
  }

  subscribeThread(
    threadId: string,
    options: { afterSequence?: number },
    onItem: (item: ThreadFrame) => void,
    onError: (error: unknown) => void,
  ): () => void {
    return this.subscribe("subscribeThread", { threadId, ...options }, onItem as (item: unknown) => void, onError);
  }

  async dispatch<T extends CommandType>(command: CommandOf<T>): Promise<CommandResult<T>> {
    return (await this.request("dispatch", command)) as CommandResult<T>;
  }

  async query<T extends QueryType>(query: QueryOf<T>): Promise<QueryResult<T>> {
    return (await this.request("query", query)) as QueryResult<T>;
  }

  async turnDiff(threadId: string, toTurnCount: number): Promise<string | null> {
    return (await this.request("turnDiff", { threadId, toTurnCount })) as string | null;
  }

  async getConfig(): Promise<ConfigPayload> {
    return (await this.request("getConfig")) as ConfigPayload;
  }

  /** Ask the server to stop. Resolves once it has acknowledged. */
  async shutdownServer(): Promise<void> {
    await this.request("shutdown");
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscriptions.clear();
    this.socket?.end();
    this.socket = null;
  }
}
