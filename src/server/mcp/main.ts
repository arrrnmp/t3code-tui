/**
 * The `moxen` MCP server process a provider session launches over stdio:
 * `bun src/server/mcp/main.ts --thread <parent-thread-id>`. It reaches
 * moxen the way every client does (`openClient`, per `MOXEN_SERVER`): with
 * a shared server running, delegated tasks live there and outlast this
 * process; without one they run in here, for as long as the parent's
 * provider session keeps this server up.
 *
 * Stdout is the protocol channel: nothing else may be written to it.
 */
import { fileURLToPath } from "node:url";

import type { McpServerSpec } from "../../core/mcp.js";
import { openClient } from "../client.js";
import { MOXEN_CHECKLIST_ARG, serveMcp } from "./stdio.js";

/** The name agents see its tools under (`mcp__moxen__delegate`). */
export const MOXEN_MCP_SERVER_NAME = "moxen";

/** How a provider session launches the moxen tools for one thread. */
export function moxenMcpServerSpec(threadId: string): Extract<McpServerSpec, { type: "stdio" }> {
  const entry = fileURLToPath(new URL("./main.ts", import.meta.url));
  // Bun runs the TypeScript directly: this runtime when it is Bun, else `bun` from PATH.
  const runtime = process.versions.bun ? process.execPath : "bun";
  return { name: MOXEN_MCP_SERVER_NAME, type: "stdio", command: runtime, args: [entry, "--thread", threadId], env: {} };
}

function threadArg(argv: readonly string[]): string | null {
  const index = argv.indexOf("--thread");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && value.trim() ? value.trim() : null;
}

if (import.meta.main) {
  const parentThreadId = threadArg(process.argv.slice(2));
  if (!parentThreadId) {
    process.stderr.write("moxen mcp: --thread <thread-id> is required\n");
    process.exit(2);
  }
  const api = await openClient();
  try {
    const checklist = process.argv.slice(2).includes(MOXEN_CHECKLIST_ARG);
    await serveMcp({ api, parentThreadId, checklist, input: process.stdin, output: process.stdout });
  } finally {
    await api.close().catch(() => undefined);
  }
  process.exit(0);
}
