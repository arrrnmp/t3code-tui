/**
 * The moxen tools over MCP's streamable HTTP transport, on loopback, served
 * by the process that owns the provider sessions — so a delegation runs
 * where its parent's session lives (the shared server, or the TUI that
 * started it), rather than in a stdio child that dies with the provider
 * session and owns threads nobody can steer.
 *
 * One endpoint per thread: `POST /mcp/<threadId>` with `Authorization:
 * Bearer <token>`, a random secret minted per thread for this process only,
 * so no other local process can act for a thread. Answers are plain JSON
 * (the transport's non-streaming form): the tools never stream.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ClientApi } from "../api.js";
import { answerMcp } from "./stdio.js";

export interface McpHttpServer {
  /** How a provider reaches one thread's tools here. */
  specFor(threadId: string): { readonly url: string; readonly headers: Readonly<Record<string, string>> };
  close(): Promise<void>;
}

/** Tool calls block for up to 45s (`task_status`); a body past this is not an MCP request. */
const MAX_BODY_BYTES = 1_000_000;

export async function startMcpHttpServer(api: ClientApi, version?: string): Promise<McpHttpServer> {
  const tokens = new Map<string, string>();
  const server: Server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const match = /^\/mcp\/([^/?#]+)/.exec(request.url ?? "");
    const threadId = match?.[1] ? decodeURIComponent(match[1]) : null;
    const expected = threadId === null ? undefined : tokens.get(threadId);
    const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
    if (threadId === null || expected === undefined || !sameSecret(given, expected)) {
      response.writeHead(401).end();
      return;
    }
    // No server-initiated stream (GET) and no session to end (DELETE).
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    const body = await readBody(request);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      respondJson(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const session = { api, parentThreadId: threadId, ...(version ? { version } : {}) };
    if (Array.isArray(parsed)) {
      const answers = (await Promise.all(parsed.map((item) => answerMcp(session, item)))).filter((answer) => answer !== null);
      if (answers.length === 0) response.writeHead(202).end();
      else respondJson(response, 200, answers);
      return;
    }
    const answer = await answerMcp(session, parsed);
    if (answer === null) response.writeHead(202).end();
    else respondJson(response, 200, answer);
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    specFor(threadId) {
      let token = tokens.get(threadId);
      if (token === undefined) {
        token = randomBytes(24).toString("hex");
        tokens.set(threadId, token);
      }
      return { url: `http://127.0.0.1:${port}/mcp/${encodeURIComponent(threadId)}`, headers: { Authorization: `Bearer ${token}` } };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function respondJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
