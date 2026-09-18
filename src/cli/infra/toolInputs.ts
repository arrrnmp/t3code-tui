import { execFile } from "node:child_process";

export type SqliteRunner = (args: string[]) => Promise<{ stdout: string }>;

/** Full tool inputs for an open thread's completed tool calls, by
    toolCallId — the live subscription strips every `input` object, but the
    local projection database keeps them. Read-only, same pattern as the
    local project discovery: null when the database is unavailable (no
    sqlite3 binary, missing file or schema) and the UI keeps its existing
    fallbacks. */
export async function readCompletedToolInputs(
  stateDir: string,
  threadId: string,
  run: SqliteRunner = (args) =>
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
    }),
): Promise<Map<string, Record<string, unknown>> | null> {
  // Ids flow from our own projected state, but they still cross into a
  // subprocess argv — whitelist the charset so nothing can smuggle out.
  if (!/^[A-Za-z0-9:_-]+$/.test(threadId)) return null;
  let stdout: string;
  try {
    ({ stdout } = await run([
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
