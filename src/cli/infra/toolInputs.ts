import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import type { DatabaseSync } from "node:sqlite";

export type SqliteRunner = (args: string[]) => Promise<{ stdout: string }>;

const SELECT_COMPLETED_INPUTS =
  "SELECT activity_id, payload_json FROM projection_thread_activities WHERE thread_id = ? AND kind = 'tool.completed'";

/** Full tool inputs for an open thread's completed tool calls, by
    toolCallId — the live subscription strips every `input` object, but the
    local projection database keeps them. Read-only, same pattern as the
    local project discovery: null when the database is unavailable (no
    driver, missing file or schema) and the UI keeps its existing
    fallbacks. An explicitly injected runner always wins (tests); otherwise
    the host runtime's embedded driver is tried before the `sqlite3` CLI. */
export async function readCompletedToolInputs(
  stateDir: string,
  threadId: string,
  run?: SqliteRunner,
): Promise<Map<string, Record<string, unknown>> | null> {
  // Ids flow from our own projected state, but they still cross into a
  // subprocess argv — whitelist the charset so nothing can smuggle out.
  if (!/^[A-Za-z0-9:_-]+$/.test(threadId)) return null;
  if (run === undefined) {
    const dbPath = `${stateDir}/state.sqlite`;
    const embedded = (await readViaBunSqlite(dbPath, threadId)) ?? (await readViaNodeSqlite(dbPath, threadId));
    if (embedded !== null) return embedded;
  }
  const runner =
    run ??
    ((args) =>
      new Promise((resolve, reject) => {
        execFile(
          "sqlite3",
          [`${stateDir}/state.sqlite`, ...args],
          { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
          (error, stdout) => {
            if (error !== null) reject(error instanceof Error ? error : new Error(String(error)));
            else resolve({ stdout: typeof stdout === "string" ? stdout : String(stdout) });
          },
        );
      }));
  let stdout: string;
  try {
    ({ stdout } = await runner([
      "-json",
      `SELECT activity_id, payload_json FROM projection_thread_activities WHERE thread_id = '${threadId}' AND kind = 'tool.completed'`,
    ]));
  } catch {
    return null;
  }
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return parseToolInputRows(rows);
}

/**
 * Reads through `bun:sqlite` — the TUI always runs under Bun — instead of
 * shelling out to a `sqlite3` binary that may not be installed. Null when
 * unavailable (Node/vitest, missing file, bad schema) so callers fall
 * through; an empty map is a successful read with no stored inputs. The
 * existence check runs first because opening would otherwise create an
 * empty database file, and a busy timeout keeps contention with the live
 * server's writes from failing the read.
 */
async function readViaBunSqlite(
  dbPath: string,
  threadId: string,
): Promise<Map<string, Record<string, unknown>> | null> {
  if (!existsSync(dbPath)) return null;
  const Database = loadBunDatabase();
  if (Database === null) return null;
  let database: InstanceType<typeof Database> | null = null;
  try {
    database = new Database(dbPath, { readonly: true });
    database.exec("PRAGMA busy_timeout = 3000");
    const rows = database.query(SELECT_COMPLETED_INPUTS).all(threadId);
    return parseToolInputRows(rows);
  } catch {
    return null;
  } finally {
    try {
      database?.close();
    } catch {
      // Best effort: a failed close must not fail the read.
    }
  }
}

/**
 * Loads `bun:sqlite` without a static import (which tsc could not resolve
 * without Bun's types, and which would break loading this module under
 * Node entirely). `createRequire` is typed via `@types/node` on both
 * runtimes; resolving `bun:sqlite` through it only succeeds under Bun —
 * under Node it throws, which reads as "no embedded driver".
 */
function loadBunDatabase(): (new (
  path: string,
  options?: { readonly?: boolean },
) => {
  exec(sql: string): void;
  query(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
}) | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("bun:sqlite") as { Database?: unknown };
    if (typeof mod.Database !== "function") return null;
    return mod.Database as new (
      path: string,
      options?: { readonly?: boolean },
    ) => {
      exec(sql: string): void;
      query(sql: string): { all(...params: unknown[]): unknown[] };
      close(): void;
    };
  } catch {
    return null;
  }
}

/**
 * Same embedded read through `node:sqlite` for compiled-Node usage (the
 * `dist` CLI) — mirrors `localProjects.ts`. Null under Bun and wherever
 * the file or schema is unavailable.
 */
async function readViaNodeSqlite(
  dbPath: string,
  threadId: string,
): Promise<Map<string, Record<string, unknown>> | null> {
  if (!existsSync(dbPath)) return null;
  let DatabaseSyncCtor: typeof DatabaseSync | null = null;
  try {
    ({ DatabaseSync: DatabaseSyncCtor } = await import("node:sqlite"));
  } catch {
    return null;
  }
  if (DatabaseSyncCtor === null) return null;
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSyncCtor(dbPath, { readOnly: true });
    database.exec("PRAGMA busy_timeout = 3000");
    const rows = database.prepare(SELECT_COMPLETED_INPUTS).all(threadId);
    return parseToolInputRows(rows as unknown[]);
  } catch {
    return null;
  } finally {
    try {
      database?.close();
    } catch {
      // Best effort: a failed close must not fail the read.
    }
  }
}

function parseToolInputRows(rows: unknown[]): Map<string, Record<string, unknown>> {
  const inputs = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (typeof record.activity_id !== "string") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(typeof record.payload_json === "string" ? record.payload_json : "");
    } catch {
      continue;
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) continue;
    const data = (payload as Record<string, unknown>).data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) continue;
    const dataRecord = data as Record<string, unknown>;
    const asInput = (value: unknown): Record<string, unknown> | null =>
      value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0
        ? (value as Record<string, unknown>)
        : null;
    const stateRecord =
      dataRecord.state !== null && typeof dataRecord.state === "object" && !Array.isArray(dataRecord.state)
        ? (dataRecord.state as Record<string, unknown>)
        : null;
    const resolved = stateRecord === null ? asInput(dataRecord.input) : (asInput(stateRecord.input) ?? asInput(dataRecord.input));
    if (resolved === null) continue;
    const toolCallId = (payload as Record<string, unknown>).toolCallId;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) continue;
    inputs.set(toolCallId, resolved);
  }
  return inputs;
}
