/**
 * Scripted ACP doubles over a linked pair. The fake answers initialize,
 * session/new, and session/prompt (via an injectable handler so tests can
 * interleave server-initiated traffic), and records everything the driver
 * sends.
 */
import { createLinkedPair, JsonRpcPeer, type SpawnedProcess } from "../../stdio.js";
import type { GrokSpawnOptions, GrokTransport } from "../transport.js";

export interface FakeAcpModels {
  readonly currentModelId?: string;
  readonly availableModels?: Array<{ modelId: string; reasoningEffort?: string }>;
}

export interface FakeAcpScript {
  readonly initializeMeta?: unknown;
  readonly sessionId?: string;
  readonly models?: FakeAcpModels | null;
  readonly prompt?: (params: unknown) => Promise<{ stopReason: string; usage?: Record<string, unknown> }>;
}

export interface FakePromptResponse {
  readonly stopReason: string;
  readonly usage?: Record<string, unknown>;
}

export class FakeAcpServer {
  readonly peer: JsonRpcPeer;
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly cancels: unknown[] = [];
  promptHandler: (params: unknown) => Promise<FakePromptResponse> = async () => ({
    stopReason: "end_turn",
  });

  constructor(
    serverProcess: SpawnedProcess,
    private readonly script: FakeAcpScript = {},
  ) {
    if (script.prompt) {
      this.promptHandler = script.prompt as (params: unknown) => Promise<FakePromptResponse>;
    }
    this.peer = new JsonRpcPeer(serverProcess, { forceKillAfterMs: 0 });
    this.peer.onRequest(async (method, params) => {
      this.requests.push({ method, params });
      return this.answer(method, params);
    });
    this.peer.onNotification((method, params) => {
      if (method === "session/cancel") this.cancels.push(params);
    });
  }

  private answer(method: string, params: unknown): unknown {
    void params;
    switch (method) {
      case "initialize":
        return { protocolVersion: 1, agentCapabilities: {}, _meta: this.script.initializeMeta ?? null };
      case "session/new": {
        const models = this.script.models;
        return {
          sessionId: this.script.sessionId ?? "acp-session-1",
          models: models
            ? {
                ...(models.currentModelId ? { currentModelId: models.currentModelId } : {}),
                availableModels: (models.availableModels ?? []).map((model) => ({
                  modelId: model.modelId,
                  ...(model.reasoningEffort ? { _meta: { reasoningEffort: model.reasoningEffort } } : {}),
                })),
              }
            : null,
        };
      }
      case "session/prompt":
        return this.promptHandler(params);
      case "session/set_model":
        return {};
      case "session/close":
        return {};
      default:
        throw new Error(`unexpected method ${method}`);
    }
  }

  update(sessionId: string, update: Record<string, unknown>): void {
    this.peer.notify("session/update", { sessionId, update });
  }

  askPermission(
    sessionId: string,
    toolCall: Record<string, unknown>,
    options: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.peer.request(
      "session/request_permission",
      { sessionId, toolCall, options },
      5000,
    );
  }

  askQuestion(params: unknown): Promise<unknown> {
    return this.peer.request("_x.ai/ask_user_question", params, 5000);
  }

  requestsTo(method: string): Array<{ method: string; params: unknown }> {
    return this.requests.filter((request) => request.method === method);
  }
}

export class FakeGrokTransport implements GrokTransport {
  readonly sessions: Array<{ client: JsonRpcPeer; server: FakeAcpServer; options: GrokSpawnOptions }> = [];

  constructor(private readonly script: FakeAcpScript = {}) {}

  startPeer(options: GrokSpawnOptions): JsonRpcPeer {
    const { client, server } = createLinkedPair();
    const clientPeer = new JsonRpcPeer(client, { forceKillAfterMs: 0 });
    const fake = new FakeAcpServer(server, this.script);
    this.sessions.push({ client: clientPeer, server: fake, options });
    return clientPeer;
  }
}
