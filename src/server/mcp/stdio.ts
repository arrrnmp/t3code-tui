/**
 * A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, tools
 * only — `initialize`, `tools/list`, `tools/call`, `ping`. That is the
 * whole surface the moxen tools need, and it keeps us off a runtime
 * dependency we would otherwise only reach transitively.
 */
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

import type { ClientApi } from "../api.js";
import { callMoxenTool, MOXEN_TOOLS } from "./tools.js";

/** Newest first; an unknown client version is answered with the newest. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ServeMcpOptions {
  readonly api: ClientApi;
  /** The thread whose agent these tools act for. */
  readonly parentThreadId: string;
  readonly input: Readable;
  readonly output: Writable;
  readonly version?: string;
}

type JsonRpcId = string | number;

interface JsonRpcRequest {
  readonly id?: JsonRpcId;
  readonly method?: unknown;
  readonly params?: unknown;
}

/** Serve until `input` ends. Requests are answered concurrently; each reply is one line. */
export async function serveMcp(options: ServeMcpOptions): Promise<void> {
  const write = (message: unknown): void => {
    options.output.write(`${JSON.stringify(message)}\n`);
  };
  const reply = (id: JsonRpcId, result: unknown): void => write({ jsonrpc: "2.0", id, result });
  const fail = (id: JsonRpcId | null, code: number, message: string): void =>
    write({ jsonrpc: "2.0", id, error: { code, message } });

  const handle = async (request: JsonRpcRequest): Promise<void> => {
    const id = request.id;
    const method = typeof request.method === "string" ? request.method : "";
    // Notifications (`notifications/initialized`, `notifications/cancelled`) need no answer.
    if (id === undefined) return;
    const params = request.params !== null && typeof request.params === "object" ? (request.params as Record<string, unknown>) : {};
    switch (method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
        reply(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "moxen", version: options.version ?? "0.0.0" },
          instructions:
            "moxen runs coding agents as threads. Use delegate to hand a self-contained task to a subagent thread " +
            "(any provider, in its own git worktree), then task_status to collect its report.",
        });
        return;
      }
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, { tools: MOXEN_TOOLS });
        return;
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const args =
          params.arguments !== null && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const result = await callMoxenTool(options.api, options.parentThreadId, name, args);
        reply(id, { content: [{ type: "text", text: result.text }], isError: result.isError });
        return;
      }
      default:
        fail(id, -32601, `Method not found: ${method}`);
    }
  };

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  const inFlight = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      fail(null, -32700, "Parse error");
      continue;
    }
    const running = handle(request).catch((cause: unknown) => {
      if (request.id !== undefined) fail(request.id, -32603, cause instanceof Error ? cause.message : String(cause));
    });
    inFlight.add(running);
    void running.finally(() => inFlight.delete(running));
  }
  await Promise.all(inFlight);
}
