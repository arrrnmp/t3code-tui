/**
 * Minimal ACP (Agent Client Protocol, schema v0.11.3) client over the shared
 * NDJSON peer. Covers exactly what the Grok driver needs: initialize,
 * session/new, session/prompt, session/cancel, session/set_model (best
 * effort), plus serving session/request_permission, fs/read_text_file, and
 * the `_x.ai/ask_user_question` extension. Terminal/fs-write/elicitation
 * answer "not supported" — documented Stage 3 limits. Unknown
 * session/update variants are ignored so schema drift degrades to silence.
 */
import { readFile } from "node:fs/promises";

import { JsonRpcPeer } from "../stdio.js";

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface AcpImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export type AcpPromptContent = AcpTextContent | AcpImageContent | { readonly type: string; [key: string]: unknown };

export interface AcpModelInfo {
  readonly modelId: string;
  readonly name?: string;
  readonly reasoningEffort?: string;
}

export interface AcpModelState {
  readonly currentModelId?: string;
  readonly availableModels: AcpModelInfo[];
}

export interface AcpPermissionToolCall {
  readonly toolCallId: string;
  readonly title?: string;
  readonly kind?: string;
  readonly rawInput?: unknown;
}

export interface AcpPermissionOption {
  readonly optionId: string;
  readonly kind: string;
  readonly name?: string;
}

export interface AcpPermissionRequest {
  readonly sessionId: string;
  readonly toolCall: AcpPermissionToolCall;
  readonly options: AcpPermissionOption[];
}

export type AcpPermissionAnswer =
  | { readonly outcome: "selected"; readonly optionId: string }
  | { readonly outcome: "cancelled" };

export interface AcpSessionUpdate {
  readonly sessionId: string;
  readonly update: { readonly sessionUpdate: string; [key: string]: unknown };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readModelState(value: unknown): AcpModelState | null {
  const record = asRecord(value);
  if (!record) return null;
  const rawModels = record["availableModels"];
  const availableModels: AcpModelInfo[] = [];
  if (Array.isArray(rawModels)) {
    for (const entry of rawModels) {
      const item = asRecord(entry);
      const modelId = item ? asString(item["modelId"]) : undefined;
      if (!modelId) continue;
      const meta = asRecord(item?.["_meta"]);
      const reasoning = meta ? asString(meta["reasoningEffort"]) : undefined;
      availableModels.push({
        modelId,
        ...(item && asString(item["name"]) ? { name: asString(item["name"]) as string } : {}),
        ...(reasoning ? { reasoningEffort: reasoning } : {}),
      });
    }
  }
  const currentModelId = asString(record["currentModelId"]);
  return { ...(currentModelId ? { currentModelId } : {}), availableModels };
}

export interface AcpClientOptions {
  /** Cap for fs/read_text_file answers. */
  readonly maxReadBytes?: number;
}

const READ_CAP_DEFAULT = 256 * 1024;

export class AcpClient {
  private permissionHandler: ((request: AcpPermissionRequest) => Promise<AcpPermissionAnswer>) | null = null;
  private updateHandler: ((update: AcpSessionUpdate) => void) | null = null;
  private customHandlers = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
  private readonly maxReadBytes: number;

  constructor(
    private readonly peer: JsonRpcPeer,
    options: AcpClientOptions = {},
  ) {
    this.maxReadBytes = options.maxReadBytes ?? READ_CAP_DEFAULT;
    this.peer.onRequest((method, params) => this.onServerRequest(method, params));
    this.peer.onNotification((method, params) => this.onNotification(method, params));
  }

  onPermissionRequest(
    handler: (request: AcpPermissionRequest) => Promise<AcpPermissionAnswer>,
  ): void {
    this.permissionHandler = handler;
  }

  onUpdate(handler: (update: AcpSessionUpdate) => void): void {
    this.updateHandler = handler;
  }

  /** Extension methods (e.g. `_x.ai/ask_user_question`). Thrown = not-found. */
  onCustomRequest(method: string, handler: (params: unknown) => Promise<unknown> | unknown): void {
    this.customHandlers.set(method, handler);
  }

  async initialize(): Promise<{ agentCapabilities: unknown; authMethods: unknown; _meta: unknown }> {
    const response = (await this.peer.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: "t3code-tui", version: "0.0.0" },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
    })) as Record<string, unknown>;
    return {
      agentCapabilities: response["agentCapabilities"] ?? null,
      authMethods: response["authMethods"] ?? null,
      _meta: response["_meta"] ?? null,
    };
  }

  async newSession(cwd: string): Promise<{ sessionId: string; models: AcpModelState | null; modes: unknown; _meta: unknown }> {
    const response = (await this.peer.request("session/new", { cwd, mcpServers: [] })) as Record<string, unknown>;
    const sessionId = asString(response["sessionId"]);
    if (!sessionId) throw new Error("session/new did not return a sessionId");
    return {
      sessionId,
      models: readModelState(response["models"]),
      modes: response["modes"] ?? null,
      _meta: response["_meta"] ?? null,
    };
  }

  async prompt(
    sessionId: string,
    blocks: AcpPromptContent[],
  ): Promise<{ stopReason: string; usage: Record<string, unknown> | null }> {
    const response = (await this.peer.request("session/prompt", {
      sessionId,
      prompt: blocks,
    })) as Record<string, unknown>;
    return {
      stopReason: asString(response["stopReason"]) ?? "end_turn",
      usage: asRecord(response["usage"]),
    };
  }

  cancel(sessionId: string): void {
    this.peer.notify("session/cancel", { sessionId });
  }

  /** Best effort: older agents may not implement set_model. */
  async setModel(sessionId: string, modelId: string, meta?: Record<string, unknown>): Promise<boolean> {
    try {
      await this.peer.request("session/set_model", {
        sessionId,
        modelId,
        ...(meta ? { _meta: meta } : {}),
      });
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.peer.close();
  }

  private onServerRequest(method: string, params: unknown): Promise<unknown> | unknown {
    if (method === "session/request_permission") {
      const handler = this.permissionHandler;
      if (!handler) throw new Error("no permission handler registered");
      const record = asRecord(params) ?? {};
      const toolCall = asRecord(record["toolCall"]) ?? {};
      const options = Array.isArray(record["options"]) ? (record["options"] as unknown[]) : [];
      const parsed: AcpPermissionOption[] = [];
      for (const entry of options) {
        const item = asRecord(entry);
        if (item && typeof item["optionId"] === "string" && typeof item["kind"] === "string") {
          parsed.push({
            optionId: item["optionId"] as string,
            kind: item["kind"] as string,
            ...(typeof item["name"] === "string" ? { name: item["name"] as string } : {}),
          });
        }
      }
      return handler({
        sessionId: asString(record["sessionId"]) ?? "",
        toolCall: {
          toolCallId: asString(toolCall["toolCallId"]) ?? "",
          ...(asString(toolCall["title"]) ? { title: asString(toolCall["title"]) as string } : {}),
          ...(asString(toolCall["kind"]) ? { kind: asString(toolCall["kind"]) as string } : {}),
          ...("rawInput" in toolCall ? { rawInput: toolCall["rawInput"] } : {}),
        },
        options: parsed,
      }).then((answer) =>
        answer.outcome === "cancelled" ? { outcome: "cancelled" } : { outcome: "selected", optionId: answer.optionId },
      );
    }
    if (method === "fs/read_text_file") {
      const record = asRecord(params) ?? {};
      const filePath = asString(record["path"]);
      if (!filePath) throw new Error("fs/read_text_file needs a path");
      return readFile(filePath, "utf8").then((content) => ({
        content: content.slice(0, this.maxReadBytes),
      }));
    }
    const custom = this.customHandlers.get(method);
    if (custom) return custom(params);
    if (method === "fs/write_text_file" || method.startsWith("terminal/") || method === "session/elicitation") {
      throw new Error(`${method} is not supported by this client`);
    }
    throw new Error(`Method not found: ${method}`);
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    const record = asRecord(params);
    const update = asRecord(record?.["update"]);
    const sessionId = asString(record?.["sessionId"]);
    if (!record || !update || !sessionId || typeof update["sessionUpdate"] !== "string") return;
    this.updateHandler?.({ sessionId, update: update as AcpSessionUpdate["update"] });
  }
}

/** Seed for the /compact command from initialize._meta (defensive). */
export function compactCommandFromMeta(meta: unknown): string | null {
  const record = asRecord(meta);
  if (!record) return null;
  for (const key of ["compactCommand", "compact_command", "compact"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().startsWith("/")) return value.trim();
  }
  const commands = record["commands"];
  if (Array.isArray(commands)) {
    for (const entry of commands) {
      const item = asRecord(entry);
      const name = item ? asString(item["name"] ?? item["command"]) : undefined;
      if (name === "compact" || name === "/compact") return "/compact";
    }
  }
  return null;
}
