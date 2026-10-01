/**
 * A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, tools
 * only — `initialize`, `tools/list`, `tools/call`, `ping`. That is the
 * whole surface the moxen tools need, and it keeps us off a runtime
 * dependency we would otherwise only reach transitively. `answerMcp` is the
 * protocol itself, shared with the HTTP transport (`http.ts`).
 */
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

import type { ClientApi } from "../api.js";
import { callMoxenTool, MOXEN_TOOLS, TODOS_TOOL } from "./tools.js";

/** Newest first; an unknown client version is answered with the newest. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** What the server tells a model about itself, whatever the transport. */
export const MOXEN_MCP_INSTRUCTIONS =
  "moxen runs coding agents as threads. Use delegate to hand a self-contained task to a subagent thread " +
  "(any provider and model, in its own git worktree), then task_status to collect its report. " +
  "The models tool lists the providers, models and efforts you can delegate to.";

/** How a client asks for the `todos` tool too: the HTTP endpoint's query, the stdio server's flag. */
export const MOXEN_CHECKLIST_QUERY = "checklist=1";
export const MOXEN_CHECKLIST_ARG = "--checklist";

export interface McpSessionOptions {
  readonly api: ClientApi;
  /** The thread whose agent these tools act for. */
  readonly parentThreadId: string;
  readonly version?: string;
  /** Also offer `todos`: the provider keeps no checklist of its own. */
  readonly checklist?: boolean;
}

export interface ServeMcpOptions extends McpSessionOptions {
  readonly input: Readable;
  readonly output: Writable;
}

type JsonRpcId = string | number;

interface JsonRpcRequest {
  readonly id?: JsonRpcId;
  readonly method?: unknown;
  readonly params?: unknown;
}

/**
 * The JSON-RPC answer to one request, or null for a notification (no id),
 * which needs none. Never throws: a tool failure is a tool error result, an
 * internal failure a JSON-RPC error.
 */
export async function answerMcp(options: McpSessionOptions, raw: unknown): Promise<Record<string, unknown> | null> {
  const request = (raw !== null && typeof raw === "object" ? raw : {}) as JsonRpcRequest;
  const id = request.id;
  if (id === undefined) return null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  const method = typeof request.method === "string" ? request.method : "";
  const params = request.params !== null && typeof request.params === "object" ? (request.params as Record<string, unknown>) : {};
  try {
    switch (method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
        return reply({
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "moxen", version: options.version ?? "0.0.0" },
          instructions: MOXEN_MCP_INSTRUCTIONS,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: options.checklist === true ? [...MOXEN_TOOLS, TODOS_TOOL] : MOXEN_TOOLS });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const args =
          params.arguments !== null && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const result = await callMoxenTool(options.api, options.parentThreadId, name, args);
        return reply({ content: [{ type: "text", text: result.text }], isError: result.isError });
      }
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (cause) {
    return fail(-32603, cause instanceof Error ? cause.message : String(cause));
  }
}

/** Serve until `input` ends. Requests are answered concurrently; each reply is one line. */
export async function serveMcp(options: ServeMcpOptions): Promise<void> {
  const write = (message: unknown): void => {
    options.output.write(`${JSON.stringify(message)}\n`);
  };
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  const inFlight = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const running = answerMcp(options, request).then((answer) => {
      if (answer !== null) write(answer);
    });
    inFlight.add(running);
    void running.finally(() => inFlight.delete(running));
  }
  await Promise.all(inFlight);
}
