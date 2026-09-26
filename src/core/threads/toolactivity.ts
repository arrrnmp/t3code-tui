/**
 * Tool calls → activity ledger rows.
 *
 * The TUI's `describeActivity` renders rich tool rows (`$ command`,
 * `Update path +3 -1`, `Read path`, `Grep pattern`…) off the activity
 * payload shape. After the decouple nothing produced those rows: the
 * store only appended lifecycle bookkeeping (`turn.started` carrying the
 * prompt, `turn.completed` carrying a turn id), so a plain chat turn
 * rendered as "Worked for 4s · 2 steps" over a prompt echo and a UUID,
 * and a turn that really did work showed none of it. ARCHITECTURE.md §9 puts
 * `tool.execute.*` on the bus and §12 owns the harness; this is the
 * missing half — the drivers already publish the events.
 *
 * Each provider's `raw` payload is normalized to one `NativeToolCall`,
 * then shaped into the payload the renderer expects. We emit the *full*
 * shape (`data.state.input`, `data.files[].diff`, exit codes, timings)
 * rather than a stripped wire form, so rows resolve directly instead
 * of through the renderer's degraded-input fallbacks.
 *
 * Rows are append-only: `collapseToolActivities`
 * folds started/updated/completed onto the first row's position by
 * `payload.toolCallId`, keeping the newest payload.
 */
import type { ProviderRuntimeEvent } from "../providers/spi.js";

/** A `tool.execute.*` event — the only kind this module maps. */
export type ToolRuntimeEvent = Extract<ProviderRuntimeEvent, { readonly tool: string }>;

export type ToolCallStatus = "inProgress" | "completed" | "failed";

export interface ToolActivityRow {
  /** Stable per tool call; drives transcript collapsing. */
  readonly callId: string;
  readonly kind: string;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  /**
   * What this row actually says. A provider that streams output deltas
   * republishes the same call many times per second; the runner skips a
   * write whose signature is unchanged so the ledger records transitions,
   * not keystrokes.
   */
  readonly signature: string;
}

/** Provider-native tool call, normalized. */
interface NativeToolCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly output: string | null;
  readonly status: ToolCallStatus;
  readonly exit: number | null;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly files: ReadonlyArray<{ path: string; diff?: string }>;
  /**
   * Unified patch for the whole call, where the provider ships one. The
   * renderer reads it from `data.state.metadata.diff` (`providedDiff`) and
   * prefers it over reconstructing from `old_string`/`new_string`.
   */
  readonly patch: string | null;
  /** Provider-supplied label, when it has a better one than the tool name. */
  readonly title: string | null;
  /** Set only when the provider names the item kind itself (Codex does). */
  readonly itemType: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Event type → status, the fallback when the payload carries none. */
function statusOfEvent(type: ToolRuntimeEvent["type"]): ToolCallStatus {
  return type === "tool.execute.completed" ? "completed" : "inProgress";
}

/**
 * Claude publishes one `tool_use` block per call (`{ toolUseId, input }`)
 * and, once the harness returns, one `tool_result`
 * (`{ toolUseId, output, isError }`). Names are the SDK's own
 * (`Bash`, `Read`, `Edit`, …), which the renderer already maps.
 */
function fromClaude(event: ToolRuntimeEvent, raw: Record<string, unknown>): NativeToolCall | null {
  const callId = asString(raw.toolUseId);
  if (callId === null) return null;
  const isError = raw.isError === true;
  const status: ToolCallStatus = event.type === "tool.execute.completed"
    ? (isError ? "failed" : "completed")
    : "inProgress";
  return {
    callId,
    tool: event.tool,
    input: asRecord(raw.input) ?? {},
    output: asString(raw.output),
    status,
    exit: null,
    startMs: null,
    endMs: null,
    files: [],
    patch: null,
    title: null,
    itemType: null,
  };
}

/**
 * Codex sends `item/started|completed` with `{ item }`, where the item
 * union names its own kind and carries typed fields — the richest source
 * of the four (`commandExecution` has `command`/`cwd`/`exitCode`/
 * `durationMs`/`aggregatedOutput`, `fileChange` has `changes[]` with
 * per-file unified diffs).
 */
function fromCodex(event: ToolRuntimeEvent, raw: Record<string, unknown>): NativeToolCall | null {
  const item = asRecord(raw.item);
  if (item === null) return null;
  const callId = asString(item.id);
  if (callId === null) return null;
  const type = asString(item.type) ?? "dynamicToolCall";
  const rawStatus = asString(item.status);
  const status: ToolCallStatus = rawStatus === "failed" || rawStatus === "interrupted"
    ? "failed"
    : rawStatus === "completed"
      ? "completed"
      : rawStatus === "inProgress"
        ? "inProgress"
        : statusOfEvent(event.type);
  const durationMs = asNumber(item.durationMs);

  if (type === "commandExecution") {
    const exit = asNumber(item.exitCode);
    return {
      callId,
      tool: "bash",
      input: {
        command: asString(item.command) ?? "",
        ...(asString(item.cwd) ? { workdir: asString(item.cwd) } : {}),
      },
      output: asString(item.aggregatedOutput),
      status: exit !== null && exit !== 0 ? "failed" : status,
      exit,
      startMs: null,
      endMs: durationMs,
      files: [],
      patch: null,
      title: null,
      itemType: "command_execution",
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const files = changes.flatMap((entry) => {
      const change = asRecord(entry);
      const path = change === null ? null : asString(change.path);
      if (path === null) return [];
      const diff = change === null ? null : asString(change.diff);
      return [diff === null ? { path } : { path, diff }];
    });
    // Codex is the only provider that ships ready-made unified patches.
    // They belong where the renderer looks for a provider patch; leaving
    // them only in `files[]` dropped them and rendered a diff-less row.
    const patch = files
      .map((file) => file.diff)
      .filter((diff): diff is string => diff !== undefined && diff.length > 0)
      .join("\n");
    return {
      callId,
      tool: asString(asRecord(changes[0])?.kind) ?? "edit",
      input: {},
      output: null,
      status,
      exit: null,
      startMs: null,
      endMs: null,
      files,
      patch: patch.length > 0 ? patch : null,
      title: null,
      itemType: "file_change",
    };
  }
  if (type === "webSearch") {
    return {
      callId,
      tool: "websearch",
      input: { query: asString(item.query) ?? "" },
      output: null,
      status,
      exit: null,
      startMs: null,
      endMs: null,
      files: [],
      patch: null,
      title: null,
      itemType: "web_search",
    };
  }
  if (type === "imageView") {
    return {
      callId,
      tool: "imageview",
      input: {},
      output: asString(item.path),
      status,
      exit: null,
      startMs: null,
      endMs: null,
      files: [],
      patch: null,
      title: asString(item.path),
      itemType: "image_view",
    };
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall" || type === "collabAgentToolCall") {
    return {
      callId,
      tool: asString(item.tool) ?? "tool",
      input: asRecord(item.arguments) ?? {},
      output: null,
      status,
      exit: null,
      startMs: null,
      endMs: durationMs,
      files: [],
      patch: null,
      title: null,
      itemType: type === "collabAgentToolCall" ? "collab_agent_tool_call" : "dynamic_tool_call",
    };
  }
  // Reasoning, plan and message items are not tool calls; the transcript
  // renders those from their own channels.
  return null;
}

/**
 * Grok speaks ACP: `tool_call` / `tool_call_update` carry `toolCallId`,
 * a human `title`, a coarse `kind` (`read`/`edit`/`execute`/`search`/…),
 * `status`, `locations[].path` and the untyped `rawInput`/`rawOutput`.
 */
function fromGrok(event: ToolRuntimeEvent, raw: Record<string, unknown>): NativeToolCall | null {
  const callId = asString(raw.toolCallId);
  if (callId === null) return null;
  const rawStatus = asString(raw.status);
  const status: ToolCallStatus = rawStatus === "failed"
    ? "failed"
    : rawStatus === "completed"
      ? "completed"
      : rawStatus === "pending" || rawStatus === "in_progress"
        ? "inProgress"
        : statusOfEvent(event.type);
  const kind = asString(raw.kind);
  const input = asRecord(raw.rawInput) ?? {};
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const firstPath = asString(asRecord(locations[0])?.path);
  // ACP's `kind` is the only reliable verb (titles are prose), so it is
  // the tool name; a location fills the path the renderer looks for.
  const tool = kind === "execute" ? "bash" : (kind ?? "tool");
  return {
    callId,
    tool,
    input: firstPath !== null && asString(input.file_path) === null && asString(input.path) === null
      ? { ...input, file_path: firstPath }
      : input,
    output: asString(raw.rawOutput) ?? null,
    status,
    exit: null,
    startMs: null,
    endMs: null,
    files: kind === "edit" && firstPath !== null ? [{ path: firstPath }] : [],
    patch: null,
    title: asString(raw.title),
    itemType: null,
  };
}

/**
 * OpenCode streams one `message.part.updated` per tool part; the part's
 * own `state.status` (`pending`/`running`/`completed`/`error`) is the
 * truth, not the event name.
 */
function fromOpencode(event: ToolRuntimeEvent, raw: Record<string, unknown>): NativeToolCall | null {
  const callId = asString(raw.callID) ?? asString(raw.id);
  if (callId === null) return null;
  const state = asRecord(raw.state) ?? {};
  const rawStatus = asString(state.status);
  const status: ToolCallStatus = rawStatus === "error"
    ? "failed"
    : rawStatus === "completed"
      ? "completed"
      : rawStatus === "pending" || rawStatus === "running"
        ? "inProgress"
        : statusOfEvent(event.type);
  const time = asRecord(state.time) ?? {};
  const metadata = asRecord(state.metadata) ?? {};
  return {
    callId,
    tool: asString(raw.tool) ?? event.tool,
    input: asRecord(state.input) ?? {},
    output: asString(state.output) ?? asString(state.error),
    status,
    exit: asNumber(metadata.exit),
    startMs: asNumber(time.start),
    endMs: asNumber(time.end),
    files: [],
    patch: null,
    title: asString(state.title),
    itemType: null,
  };
}

/** Shell tools, by the verb their (possibly namespaced) name ends in —
    Claude's `PowerShell` included, which otherwise fell to a generic card. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "exec", "powershell", "pwsh", "monitor"]);

/** Tool-name → renderer item type, for providers that don't name it. */
function itemTypeForTool(tool: string): string {
  // Namespaced harness tools (`default.bash`) carry the verb last.
  const short = tool.toLowerCase().split(/[^a-z]+/).filter((part) => part.length > 0).pop() ?? "";
  if (SHELL_TOOLS.has(short) || short === "execute") return "command_execution";
  if (short === "edit" || short === "write" || short === "multiedit" || short === "patch") return "file_change";
  if (short === "websearch" || short === "webfetch" || short === "fetch") return "web_search";
  return "dynamic_tool_call";
}

/** One human line for the ledger's own `summary` column (CLI/JSON readers). */
function summarize(native: NativeToolCall, itemType: string): string {
  const input = native.input;
  const path = asString(input.file_path) ?? asString(input.filePath) ?? asString(input.path)
    ?? native.files[0]?.path ?? null;
  if (itemType === "command_execution") {
    const command = asString(input.command) ?? native.title ?? native.tool;
    return `$ ${command}`.slice(0, 200);
  }
  if (path !== null) return `${native.tool} ${path}`.slice(0, 200);
  const pattern = asString(input.pattern) ?? asString(input.query) ?? asString(input.url);
  if (pattern !== null) return `${native.tool} ${pattern}`.slice(0, 200);
  return (native.title ?? native.tool).slice(0, 200);
}

/** Cap on the result text carried into the ledger (the renderer tails 3 lines). */
const DETAIL_LIMIT = 4000;

/**
 * Map one `tool.execute.*` event to the row to append, or null when the
 * event names no tool call we can identify (an unrecognized `raw` shape,
 * or a Codex item that is not a tool call at all). Never throws: a shape
 * we fail to read must cost a transcript row, not the turn.
 */
export function toolActivityRow(event: ToolRuntimeEvent): ToolActivityRow | null {
  const raw = asRecord(event.raw);
  if (raw === null) return null;
  let native: NativeToolCall | null = null;
  switch (event.provider) {
    case "claude":
      native = fromClaude(event, raw);
      break;
    case "codex":
      native = fromCodex(event, raw);
      break;
    case "grok":
      native = fromGrok(event, raw);
      break;
    case "opencode":
      native = fromOpencode(event, raw);
      break;
    default:
      native = null;
  }
  if (native === null) return null;

  const itemType = native.itemType ?? itemTypeForTool(native.tool);
  const detail = native.output === null ? null : native.output.slice(0, DETAIL_LIMIT);
  const payload: Record<string, unknown> = {
    itemType,
    status: native.status,
    toolCallId: native.callId,
    title: native.title ?? native.tool,
    ...(detail === null ? {} : { detail }),
    data: {
      tool: native.tool,
      ...(native.files.length > 0 ? { files: native.files } : {}),
      state: {
        status: native.status,
        input: native.input,
        ...(native.output === null ? {} : { output: detail }),
        ...(native.exit === null && native.patch === null
          ? {}
          : {
            metadata: {
              ...(native.exit === null ? {} : { exit: native.exit }),
              ...(native.patch === null ? {} : { diff: native.patch }),
            },
          }),
        ...(native.startMs === null && native.endMs === null
          ? {}
          : {
            time: {
              ...(native.startMs === null ? {} : { start: native.startMs }),
              ...(native.endMs === null ? {} : { end: native.endMs }),
            },
          }),
      },
    },
  };
  const kind = native.status === "inProgress" ? "tool-call.started" : "tool-call.completed";
  return {
    callId: native.callId,
    kind,
    summary: summarize(native, itemType),
    payload,
    // Output length stands in for the output itself: a streaming command
    // grows it monotonically, so every real change registers without
    // hashing kilobytes of terminal scrollback on each delta.
    signature: `${native.status}|${itemType}|${native.exit ?? ""}|${detail?.length ?? 0}|${native.files.length}`,
  };
}
