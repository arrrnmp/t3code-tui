/**
 * MCP servers moxen injects into every provider session: one declaration,
 * translated by each driver into its provider's native form (Claude SDK
 * `mcpServers`, Codex `mcp_servers.*` config overrides, OpenCode
 * `mcp.add`, ACP `session/new` `mcpServers`).
 *
 * Declared under `mcpServers` in the global config and in a project's
 * `moxen.json`, in the shape `.mcp.json` uses:
 *
 *   "mcpServers": {
 *     "fs":   { "command": "npx", "args": ["-y", "some-mcp"], "env": { "K": "v" } },
 *     "docs": { "type": "http", "url": "https://…/mcp", "headers": { "Authorization": "…" } }
 *   }
 *
 * A project entry replaces the global one of the same name; `null` removes
 * it for that project. `env` and `headers` may hold secrets: they go to the
 * provider and nowhere else (`redactMcpServers` is what gets displayed).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { APP_NAME } from "./config.js";
import { CliError } from "./errors.js";

export type McpServerEntry =
  | {
      readonly type?: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "http";
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    };

/** One resolved server, as drivers receive it. */
export type McpServerSpec =
  | {
      readonly name: string;
      readonly type: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | {
      readonly name: string;
      readonly type: "http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

/**
 * Names become tool prefixes (`mcp__<name>__tool`) and Codex config paths
 * (`mcp_servers.<name>`), so a dot or space would break one or the other.
 */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

function invalid(source: string, message: string): CliError {
  return new CliError("INVALID_CONFIG", `${source}: ${message}`);
}

function stringRecord(value: unknown, source: string, field: string): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(source, `${field} must be an object of strings.`);
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw invalid(source, `${field}.${key} must be a string.`);
    out[key] = item;
  }
  return out;
}

function parseEntry(name: string, raw: unknown, source: string): McpServerEntry {
  const where = `${source} mcpServers.${name}`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid(where, "must be an object.");
  const input = raw as Record<string, unknown>;
  const type = input.type ?? (typeof input.url === "string" && input.command === undefined ? "http" : "stdio");
  if (type === "http") {
    if (typeof input.url !== "string" || !/^https?:\/\//.test(input.url)) {
      throw invalid(where, "url must be an http(s) URL.");
    }
    const headers = stringRecord(input.headers, where, "headers");
    return { type: "http", url: input.url, ...(Object.keys(headers).length > 0 ? { headers } : {}) };
  }
  if (type !== "stdio") throw invalid(where, "type must be stdio or http.");
  if (typeof input.command !== "string" || input.command.trim().length === 0) {
    throw invalid(where, "command must be a non-empty string.");
  }
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string"))) {
    throw invalid(where, "args must be an array of strings.");
  }
  const env = stringRecord(input.env, where, "env");
  return {
    command: input.command,
    ...(input.args !== undefined ? { args: input.args as string[] } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/**
 * Validate an `mcpServers` object. `null` values survive (they remove a
 * global server for one project); the global config refuses them.
 */
export function parseMcpServers(
  raw: unknown,
  source: string,
  options: { readonly allowRemoval?: boolean } = {},
): Record<string, McpServerEntry | null> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(source, "mcpServers must be an object keyed by server name.");
  }
  const out: Record<string, McpServerEntry | null> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!NAME.test(name)) throw invalid(source, `mcpServers name "${name}" may use only letters, digits, - and _.`);
    if (entry === null) {
      if (!options.allowRemoval) throw invalid(source, `mcpServers.${name} must be an object.`);
      out[name] = null;
      continue;
    }
    out[name] = parseEntry(name, entry, source);
  }
  return out;
}

function toSpec(name: string, entry: McpServerEntry): McpServerSpec {
  if (entry.type === "http") return { name, type: "http", url: entry.url, headers: { ...entry.headers } };
  return { name, type: "stdio", command: entry.command, args: [...(entry.args ?? [])], env: { ...entry.env } };
}

/** `mcpServers` from `<workspaceRoot>/moxen.json`, or none. */
async function projectMcpServers(workspaceRoot: string): Promise<Record<string, McpServerEntry | null>> {
  const file = path.join(workspaceRoot, `${APP_NAME}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // Missing or unreadable: the project declares nothing. (Env-mode
    // resolution reads the same file just as leniently.)
    return {};
  }
  const servers = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).mcpServers : undefined;
  if (servers === undefined) return {};
  return parseMcpServers(servers, file, { allowRemoval: true });
}

/**
 * The servers a session in `workspaceRoot` gets: the global ones, with the
 * project's `moxen.json` layered over them by name. Sorted by name, so a
 * provider sees the same order every start.
 */
export async function resolveMcpServers(
  global: Readonly<Record<string, McpServerEntry>> | undefined,
  workspaceRoot: string | null,
): Promise<McpServerSpec[]> {
  const merged: Record<string, McpServerEntry | null> = { ...global };
  if (workspaceRoot) Object.assign(merged, await projectMcpServers(workspaceRoot));
  return Object.entries(merged)
    .flatMap(([name, entry]) => (entry ? [toSpec(name, entry)] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** For display: `env` and `headers` values replaced, keys kept. */
export function redactMcpServers(
  servers: Readonly<Record<string, McpServerEntry>>,
): Record<string, McpServerEntry> {
  const hide = (record: Readonly<Record<string, string>> | undefined) =>
    record ? Object.fromEntries(Object.keys(record).map((key) => [key, "<redacted>"])) : undefined;
  return Object.fromEntries(
    Object.entries(servers).map(([name, entry]) => {
      if (entry.type === "http") {
        const headers = hide(entry.headers);
        return [name, { ...entry, ...(headers ? { headers } : {}) }];
      }
      const env = hide(entry.env);
      return [name, { ...entry, ...(env ? { env } : {}) }];
    }),
  );
}
