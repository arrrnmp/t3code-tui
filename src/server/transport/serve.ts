/**
 * Serve a `ClientApi` over the local endpoint: one process owns the store,
 * the drivers and every live provider session, and any number of clients
 * (TUI, CLI invocations) talk to it.
 *
 * That ownership is the point. In-process, each client held its own
 * drivers, so a turn could only be steered, answered or even seen live
 * from the process that started it; here there is exactly one owner.
 *
 * Each socket must open with `hello` (protocol version check) before any
 * other request. Subscriptions belong to the socket that opened them and
 * end with it.
 */
import { rm } from "node:fs/promises";
import net from "node:net";

import { CliError } from "../../core/errors.js";
import type { ClientApi } from "../api.js";
import { isNamedPipe, probe } from "./endpoint.js";
import {
  encode,
  LineReader,
  parseLine,
  PROTOCOL_VERSION,
  toWireError,
  type HelloResult,
  type ServerMessage,
} from "./wire.js";

export interface ServerHandle {
  readonly endpoint: string;
  /** Resolves once the server has stopped (after `close`, or a client's `shutdown`). */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export interface ServeOptions {
  readonly endpoint: string;
  readonly api: ClientApi;
  /** Runs once the listener has stopped — the owner releases drivers here. */
  readonly onClose?: () => Promise<void>;
}

export async function serve(options: ServeOptions): Promise<ServerHandle> {
  const { endpoint, api } = options;
  // Listening twice on a live named pipe does not fail cleanly, and on
  // unix a live socket file would be clobbered: ask first.
  if (await probe(endpoint)) {
    throw new CliError("SERVER_RUNNING", `A moxen server is already listening at ${endpoint}.`, {
      details: { endpoint },
    });
  }
  // Unix only: a socket file left by a crashed server refuses connections
  // (the probe above) but still blocks `listen`. Named pipes vanish with
  // their process, so there is nothing to reclaim on Windows.
  if (!isNamedPipe(endpoint)) await rm(endpoint, { force: true }).catch(() => undefined);

  const sockets = new Set<net.Socket>();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let closing: Promise<void> | null = null;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    handleSocket(socket, api, () => void close());
    socket.once("close", () => sockets.delete(socket));
  });

  const close = (): Promise<void> => {
    closing ??= (async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      await options.onClose?.().catch(() => undefined);
      resolveClosed();
    })();
    return closing;
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return { endpoint, closed, close };
}

function handleSocket(socket: net.Socket, api: ClientApi, shutdown: () => void): void {
  socket.setEncoding("utf8");
  const reader = new LineReader();
  const subscriptions = new Map<number, () => void>();
  let greeted = false;

  const send = (message: ServerMessage): void => {
    if (!socket.destroyed) socket.write(encode(message));
  };
  const reply = (id: number, run: () => Promise<unknown> | unknown): void => {
    void (async () => {
      try {
        send({ id, result: (await run()) ?? null });
      } catch (cause) {
        send({ id, error: toWireError(cause) });
      }
    })();
  };

  socket.on("data", (chunk: string) => {
    for (const line of reader.push(chunk)) {
      const message = parseLine(line);
      const id = typeof message?.id === "number" ? message.id : null;
      const method = typeof message?.method === "string" ? message.method : null;
      if (message === null || id === null || method === null) continue;
      const params = (message.params ?? {}) as Record<string, unknown>;

      if (method === "hello") {
        reply(id, () => {
          if (params.protocol !== PROTOCOL_VERSION) {
            throw new CliError(
              "PROTOCOL_MISMATCH",
              `This moxen server speaks protocol ${PROTOCOL_VERSION}; the client speaks ${String(params.protocol)}. Restart the server so both run the same version.`,
              { details: { server: PROTOCOL_VERSION, client: params.protocol } },
            );
          }
          greeted = true;
          const hello: HelloResult = { protocol: PROTOCOL_VERSION, server: "moxen", pid: process.pid };
          return hello;
        });
        continue;
      }
      if (!greeted) {
        send({ id, error: toWireError(new CliError("PROTOCOL_HELLO_REQUIRED", "Send hello before any request.")) });
        continue;
      }

      switch (method) {
        case "dispatch":
          reply(id, () => api.dispatch(message.params as never));
          break;
        case "query":
          reply(id, () => api.query(message.params as never));
          break;
        case "getConfig":
          reply(id, () => api.getConfig());
          break;
        case "turnDiff":
          reply(id, () => api.turnDiff(String(params.threadId), Number(params.toTurnCount)));
          break;
        case "subscribeShell":
        case "subscribeThread": {
          const options = typeof params.afterSequence === "number" ? { afterSequence: params.afterSequence } : {};
          const onItem = (item: unknown): void => send({ subscription: id, item });
          const onError = (error: unknown): void => send({ subscription: id, error: toWireError(error) });
          // Acknowledge first: an implementation may emit its first frame
          // synchronously, and the client must know the id by then.
          send({ id, result: { subscription: id } });
          try {
            const unsubscribe =
              method === "subscribeShell"
                ? api.subscribeShell(options, onItem, onError)
                : api.subscribeThread(String(params.threadId), options, onItem, onError);
            subscriptions.set(id, unsubscribe);
          } catch (cause) {
            onError(cause);
          }
          break;
        }
        case "unsubscribe": {
          const subscription = Number(params.subscription);
          subscriptions.get(subscription)?.();
          subscriptions.delete(subscription);
          send({ id, result: null });
          break;
        }
        case "shutdown":
          send({ id, result: null });
          shutdown();
          break;
        default:
          send({ id, error: toWireError(new CliError("UNKNOWN_METHOD", `Unknown method ${method}.`)) });
      }
    }
  });

  socket.once("close", () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
  });
  socket.on("error", () => undefined);
}
