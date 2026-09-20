/**
 * Shared NDJSON JSON-RPC-over-stdio transport for the Codex app-server and
 * Grok ACP runtimes. Both CLIs speak newline-delimited JSON-RPC on stdio
 * (verified against the upstream protocol packages, not vendored).
 *
 * `JsonRpcPeer` frames lines, routes responses/requests/notifications, and
 * enforces request timeouts. Process spawning is injected (`ProcessSpawner`)
 * so tests use an in-memory linked pair instead of real CLIs. Only this
 * file touches `node:child_process`.
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

import { CliError } from "../errors.js";

export type JsonRpcId = string | number;

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface SpawnedProcess {
  readonly pid: number | undefined;
  writeLine(line: string): void;
  onData(handler: (chunk: string) => void): () => void;
  onExit(handler: (code: number | null) => void): () => void;
  onStderr?(handler: (chunk: string) => void): () => void;
  kill(signal?: NodeJS.Signals): void;
}

export interface ProcessSpawner {
  spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess;
}

export function nodeProcessSpawner(): ProcessSpawner {
  return {
    spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess {
      const child: ChildProcess = nodeSpawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      // Drain stderr so a chatty CLI never blocks on a full pipe.
      child.stderr?.resume();
      const dataHandlers = new Set<(chunk: string) => void>();
      const exitHandlers = new Set<(code: number | null) => void>();
      child.stdout?.on("data", (chunk: string) => {
        for (const handler of [...dataHandlers]) handler(chunk);
      });
      child.on("exit", (code) => {
        for (const handler of [...exitHandlers]) handler(code);
      });
      return {
        pid: child.pid,
        writeLine(line: string): void {
          child.stdin?.write(`${line}\n`, "utf8");
        },
        onData(handler: (chunk: string) => void): () => void {
          dataHandlers.add(handler);
          return () => {
            dataHandlers.delete(handler);
          };
        },
        onExit(handler: (code: number | null) => void): () => void {
          exitHandlers.add(handler);
          return () => {
            exitHandlers.delete(handler);
          };
        },
        kill(signal?: NodeJS.Signals): void {
          try {
            child.kill(signal ?? "SIGTERM");
          } catch {
            // Already gone.
          }
        },
      };
    },
  };
}

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export interface JsonRpcPeerOptions {
  readonly onParseError?: (line: string, cause: unknown) => void;
  readonly defaultRequestTimeoutMs?: number;
  /** SIGTERM → SIGKILL grace on close. 0 kills immediately. */
  readonly forceKillAfterMs?: number;
}

const JSONRPC_VERSION = "2.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * One side of a JSON-RPC conversation. Owns framing, id allocation,
 * pending-request bookkeeping, and server-side handler dispatch.
 */
export class JsonRpcPeer {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly requestHandlers = new Set<
    (method: string, params: unknown) => Promise<unknown> | unknown
  >();
  private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
  private readonly exitHandlers = new Set<(code: number | null) => void>();
  private buffer = "";
  private closedFlag = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly process: SpawnedProcess,
    private readonly options: JsonRpcPeerOptions = {},
  ) {
    this.process.onData((chunk) => this.onChunk(chunk));
    this.process.onExit((code) => this.onProcessExit(code));
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  get pid(): number | undefined {
    return this.process.pid;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closedFlag) {
      return Promise.reject(
        new CliError("PEER_CLOSED", `Cannot send ${method}: the peer is closed.`, {
          details: { method },
        }),
      );
    }
    const id: JsonRpcId = `req-${this.nextId++}`;
    const timeout = timeoutMs ?? this.options.defaultRequestTimeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CliError("PEER_REQUEST_TIMEOUT", `Request ${method} timed out after ${timeout}ms.`, {
            details: { method, timeoutMs: timeout },
          }),
        );
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.send({ jsonrpc: JSONRPC_VERSION, id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closedFlag) return;
    this.send({ jsonrpc: JSONRPC_VERSION, method, ...(params === undefined ? {} : { params }) });
  }

  onRequest(
    handler: (method: string, params: unknown) => Promise<unknown> | unknown,
  ): () => void {
    this.requestHandlers.add(handler);
    return () => {
      this.requestHandlers.delete(handler);
    };
  }

  onNotification(handler: (method: string, params: unknown) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  onExit(handler: (code: number | null) => void): () => void {
    this.exitHandlers.add(handler);
    return () => {
      this.exitHandlers.delete(handler);
    };
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const [, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      pending.reject(new CliError("PEER_CLOSED", "The peer closed while a request was pending."));
    }
    this.pending.clear();
    const grace = this.options.forceKillAfterMs ?? 2000;
    try {
      this.process.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    if (grace <= 0) {
      try {
        this.process.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      return;
    }
    this.killTimer = setTimeout(() => {
      try {
        this.process.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, grace);
    if (typeof this.killTimer === "object" && typeof (this.killTimer as unknown as { unref?: unknown }).unref === "function") {
      (this.killTimer as unknown as { unref(): void }).unref();
    }
  }

  private send(envelope: Record<string, unknown>): void {
    this.process.writeLine(JSON.stringify(envelope));
  }

  private onChunk(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch (cause) {
      this.options.onParseError?.(line, cause);
      return;
    }
    if (!isRecord(message)) return;
    const id = message["id"];
    const hasId = id !== undefined && (typeof id === "string" || typeof id === "number");
    const method = message["method"];
    // A method member means call/notification even when an id is present
    // (server→client request); id-only frames are responses.
    if (typeof method === "string") {
      const params = message["params"];
      if (hasId) {
        void this.onServerRequest(id as JsonRpcId, method, params);
      } else {
        for (const handler of [...this.notificationHandlers]) handler(method, params);
      }
      return;
    }
    if (hasId) {
      this.onResponse(id as JsonRpcId, message);
    }
  }

  private onResponse(id: JsonRpcId, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (isRecord(message["error"])) {
      const error = message["error"] as Record<string, unknown>;
      pending.reject(
        new CliError("PEER_REQUEST_FAILED", `Request failed: ${String(error["message"] ?? "unknown error")}`.slice(0, 300), {
          details: { id, code: error["code"], data: error["data"] },
        }),
      );
      return;
    }
    pending.resolve(message["result"]);
  }

  private async onServerRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    const handlers = [...this.requestHandlers];
    if (handlers.length === 0) {
      this.send({
        jsonrpc: JSONRPC_VERSION,
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
      return;
    }
    try {
      const result = await handlers[0]!(method, params);
      if (!this.closedFlag) {
        this.send({ jsonrpc: JSONRPC_VERSION, id, result: result ?? null });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!this.closedFlag) {
        this.send({ jsonrpc: JSONRPC_VERSION, id, error: { code: -32000, message: message.slice(0, 300) } });
      }
    }
  }

  private onProcessExit(code: number | null): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const [, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      pending.reject(
        new CliError("PEER_EXITED", `The peer process exited (code ${String(code)}).`, {
          details: { code },
        }),
      );
    }
    this.pending.clear();
    for (const handler of [...this.exitHandlers]) handler(code);
  }
}

interface LinkedState {
  readonly dataHandlers: Set<(chunk: string) => void>;
  readonly exitHandlers: Set<(code: number | null) => void>;
  closed: boolean;
  other: LinkedState | null;
}

function makeEndpoint(): { state: LinkedState; api: SpawnedProcess } {
  const state: LinkedState = {
    dataHandlers: new Set(),
    exitHandlers: new Set(),
    closed: false,
    other: null,
  };
  const api: SpawnedProcess = {
    pid: undefined,
    writeLine(line: string): void {
      const other = state.other;
      if (state.closed || !other || other.closed) return;
      queueMicrotask(() => {
        if (other.closed) return;
        for (const handler of [...other.dataHandlers]) handler(`${line}\n`);
      });
    },
    onData(handler: (chunk: string) => void): () => void {
      state.dataHandlers.add(handler);
      return () => {
        state.dataHandlers.delete(handler);
      };
    },
    onExit(handler: (code: number | null) => void): () => void {
      state.exitHandlers.add(handler);
      return () => {
        state.exitHandlers.delete(handler);
      };
    },
    kill(): void {
      if (state.closed) return;
      state.closed = true;
      queueMicrotask(() => {
        for (const handler of [...state.exitHandlers]) handler(null);
      });
    },
  };
  return { state, api };
}

/** In-memory linked pair: writes on one end arrive as data on the other. */
export function createLinkedPair(): { client: SpawnedProcess; server: SpawnedProcess } {
  const client = makeEndpoint();
  const server = makeEndpoint();
  client.state.other = server.state;
  server.state.other = client.state;
  return { client: client.api, server: server.api };
}
