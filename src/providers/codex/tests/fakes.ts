/**
 * Scripted codex app-server doubles over a linked pair. The fake answers
 * the handshake + thread/turn calls and lets tests push server-initiated
 * traffic (approvals, notifications) on demand.
 */
import { createLinkedPair, JsonRpcPeer, type SpawnedProcess } from "../../stdio.js";
import type { CodexSpawnOptions, CodexTransport } from "../transport.js";

export interface FakeCodexScript {
  readonly account?: unknown;
  readonly threadId?: string;
  readonly rateLimits?: unknown;
  readonly models?: unknown[];
  readonly failRequests?: Record<string, string>;
}

export class FakeCodexServer {
  readonly peer: JsonRpcPeer;
  readonly requests: Array<{ method: string; params: unknown }> = [];

  constructor(
    serverProcess: SpawnedProcess,
    private readonly script: FakeCodexScript = {},
  ) {
    this.peer = new JsonRpcPeer(serverProcess, { forceKillAfterMs: 0 });
    this.peer.onRequest(async (method, params) => {
      this.requests.push({ method, params });
      return this.answer(method, params);
    });
  }

  private answer(method: string, params: unknown): unknown {
    const failure = this.script.failRequests?.[method];
    if (failure) throw new Error(failure);
    void params;
    switch (method) {
      case "initialize":
        return { capabilities: {} };
      case "account/read":
        return this.script.account ?? { accountType: "chatgpt" };
      case "account/rateLimits/read":
        return (
          this.script.rateLimits ?? {
            primary: { usedPercent: 12, resetsAt: 1_788_000_000, windowDurationMins: 300 },
            secondary: { usedPercent: 34, resetsAt: 1_788_060_000, windowDurationMins: 10080 },
          }
        );
      case "thread/start":
        return { threadId: this.script.threadId ?? "codex-thread-1" };
      case "turn/start":
      case "turn/interrupt":
      case "thread/compact/start":
      case "config/mcpServer/reload":
        return {};
      case "model/list":
        return { models: this.script.models ?? [{ id: "gpt-test" }] };
      case "thread/rollback":
      case "thread/revert":
        return { threadId: this.script.threadId ?? "codex-thread-1", turns: [] };
      case "thread/read":
        return { threadId: this.script.threadId ?? "codex-thread-1", turns: [] };
      case "feedback/upload":
        return { url: null };
      case "account/rateLimitResetCredit/consume":
        return { status: "consumed" };
      case "skills/list":
        return { skills: [] };
      default:
        throw new Error(`unexpected method ${method}`);
    }
  }

  notify(method: string, params?: unknown): void {
    this.peer.notify(method, params);
  }

  /** Server→client request; resolves when the driver answers. */
  ask(method: string, params?: unknown): Promise<unknown> {
    return this.peer.request(method, params, 5000);
  }

  requestsTo(method: string): Array<{ method: string; params: unknown }> {
    return this.requests.filter((request) => request.method === method);
  }
}

export class FakeCodexTransport implements CodexTransport {
  readonly sessions: Array<{ client: JsonRpcPeer; server: FakeCodexServer }> = [];

  constructor(private readonly script: FakeCodexScript = {}) {}

  startPeer(_options: CodexSpawnOptions): JsonRpcPeer {
    const { client, server } = createLinkedPair();
    const clientPeer = new JsonRpcPeer(client, { forceKillAfterMs: 0 });
    const fake = new FakeCodexServer(server, this.script);
    this.sessions.push({ client: clientPeer, server: fake });
    return clientPeer;
  }
}
