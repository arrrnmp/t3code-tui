/**
 * The command protocol: what a client may ask the server to do.
 *
 * `dispatch` used to be `(command: unknown) => Promise<unknown>`. Every
 * caller hand-built `{ type, commandId, ... }` object literals and the
 * server re-derived their shape at runtime through a drift of `asRecord`
 * casts, so a misspelled field was a silent no-op rather than a compile
 * error. That is survivable with one client. With two — and then over a
 * wire, where the object really does arrive as `unknown` — it is not.
 *
 * So the shapes live here once, in two halves that must agree:
 *
 * - `Command` / `CommandResults` are the *compile-time* contract. Clients
 *   get narrowing and a typed result per command type.
 * - `decodeCommand` is the *runtime* contract, for input that genuinely
 *   arrives untyped: a socket frame, or a client that skipped the types.
 *   It is the only place allowed to guess at an unknown shape.
 *
 * Deliberately hand-written rather than schema-library-generated. Nothing
 * in the tree uses `effect/Schema` today, and ARCHITECTURE.md already
 * carries Effect's release churn as a standing risk; a discriminated union
 * plus these decoders costs less and breaks in more obvious ways.
 */
import type { ImageAttachmentUpload } from "../core/attachments.js";
import { CliError } from "../core/errors.js";
import type {
  CancelledTask,
  DelegateRequest,
  Delegation,
  DescribedTask,
  EnsuredProject,
  EnsureProjectRequest,
  Handover,
  HandoverRequest,
  RevertResult,
  ThreadList,
  ThreadListQuery,
  WorkspaceQuery,
} from "../core/threads/operations.js";
import type { ModelRequest } from "../core/catalog/selection.js";
import type { Diagnosis } from "../core/diagnostics/doctor.js";
import type { ProviderSummary, SkillInventory } from "../core/catalog/summary.js";
import type { StoredProject } from "../core/projects/projects.js";
import type { SendDelivery, SendIfBusy, TurnDelivery, TurnStatus } from "../core/threads/types.js";
import type { ThreadInspection, ThreadListStatus, ThreadReadView, ThreadReading } from "../core/threads/views.js";
import type {
  InteractionMode,
  MessageEnvelope,
  ModelSelection,
  ProjectEnvelope,
  RuntimeMode,
  SpeedMode,
  ThreadEnvelope,
  WorkspaceResolution,
} from "../core/types.js";

export interface ThreadMessageInput {
  readonly text: string;
  readonly attachments?: readonly ImageAttachmentUpload[];
}

/**
 * An answer per question. The panel carries `string[]` for a multi-select;
 * the provider SPI wants one string per question, and the server joins
 * them rather than making every driver handle both.
 */
export type UserInputAnswers = Readonly<Record<string, string | readonly string[]>>;

export type CommandBody =
  | { readonly type: "project.create"; readonly workspaceRoot: string; readonly projectId?: string; readonly title?: string }
  | {
      readonly type: "thread.create";
      readonly projectId: string;
      readonly threadId?: string;
      readonly title?: string;
      readonly modelSelection?: ModelSelection;
      readonly runtimeMode?: RuntimeMode;
      readonly interactionMode?: InteractionMode;
      readonly branch?: string | null;
    }
  | {
      readonly type: "thread.turn.start";
      readonly threadId: string;
      readonly message: ThreadMessageInput;
      readonly modelSelection?: ModelSelection;
      /** What a busy thread does with a plain send: refuse (default) or take it as a steer. */
      readonly ifBusy?: SendIfBusy;
      readonly delivery?: SendDelivery;
      /** Settled threads refuse turns unless woken by the send itself. */
      readonly wakeSettled?: boolean;
      readonly handoffNote?: string;
      /** Resolve once the turn settles rather than at acceptance. */
      readonly wait?: boolean;
    }
  | { readonly type: "thread.turn.interrupt"; readonly threadId: string; readonly turnId?: string }
  | { readonly type: "thread.settle"; readonly threadId: string; readonly reason?: string }
  | { readonly type: "thread.unsettle"; readonly threadId: string; readonly reason?: string }
  | { readonly type: "thread.snooze"; readonly threadId: string; readonly snoozedUntil: string }
  | { readonly type: "thread.unsnooze"; readonly threadId: string }
  | { readonly type: "thread.archive"; readonly threadId: string }
  | { readonly type: "thread.delete"; readonly threadId: string }
  | {
      readonly type: "thread.meta.update";
      readonly threadId: string;
      readonly title?: string;
      readonly regenerateTitle?: boolean;
    }
  | {
      readonly type: "thread.model-selection.set";
      readonly threadId: string;
      readonly modelSelection: ModelSelection;
    }
  | {
      readonly type: "thread.runtime-mode.set";
      readonly threadId: string;
      readonly runtimeMode: RuntimeMode;
      readonly interactionMode?: InteractionMode;
    }
  | {
      readonly type: "thread.user-input.respond";
      readonly threadId: string;
      readonly requestId: string;
      readonly answers: UserInputAnswers;
    }
  | { readonly type: "thread.user-input.dismiss"; readonly threadId: string; readonly requestId: string }
  /** Revert the conversation so its first `turnCount` turns remain; files are left as they are. */
  | { readonly type: "thread.conversation.revert"; readonly threadId: string; readonly turnCount: number }
  /** A new thread for a prompt: project policy, local vs worktree, model from config and flags. */
  | ({ readonly type: "thread.handover"; readonly wait?: boolean } & HandoverRequest)
  /** A task run in a child thread of the same project. The task id is the child thread id. */
  | ({ readonly type: "thread.delegate" } & DelegateRequest)
  | { readonly type: "thread.task.cancel"; readonly parentThreadId: string; readonly taskId: string }
  | ({ readonly type: "project.ensure" } & EnsureProjectRequest)
  | {
      readonly type: "model.visibility.set";
      readonly instanceId: string;
      readonly model: string;
      readonly hidden: boolean;
    };

/**
 * `commandId` is client-assigned correlation, carried for every command
 * and read by none of them yet. It exists so a transport can match a
 * response to its request without the command bodies knowing about it.
 */
export type Command = CommandBody & { readonly commandId?: string };

export type CommandType = CommandBody["type"];

/** `accepted` means the server took the command, not that the work finished. */
interface Accepted {
  readonly accepted: true;
}

export interface CommandResults {
  "project.create": { readonly projectId: string; readonly created: boolean };
  "thread.create": { readonly threadId: string } & Accepted;
  "thread.turn.start": StartedTurnSummary & Accepted;
  "thread.turn.interrupt": Accepted;
  "thread.settle": Accepted;
  "thread.unsettle": Accepted;
  "thread.snooze": Accepted;
  "thread.unsnooze": Accepted;
  "thread.archive": Accepted;
  "thread.delete": Accepted;
  "thread.meta.update": Accepted;
  "thread.model-selection.set": Accepted;
  "thread.runtime-mode.set": Accepted;
  "thread.user-input.respond": Accepted;
  "thread.user-input.dismiss": Accepted;
  "thread.conversation.revert": RevertResult & Accepted;
  "thread.handover": Omit<Handover, "started"> & { readonly started: StartedTurnSummary | null };
  "thread.delegate": Delegation;
  "thread.task.cancel": CancelledTask;
  "project.ensure": EnsuredProject;
  "model.visibility.set": { readonly hidden: boolean };
}

/** A started turn, minus the in-process run handle that cannot cross a wire. */
export interface StartedTurnSummary {
  readonly turnId: string;
  readonly messageId: string;
  readonly delivery: TurnDelivery;
  readonly status: TurnStatus;
  /** Steer/inject only: whether the running provider turn received it, or it was only recorded. */
  readonly steerDelivered?: boolean;
}

// -- queries ------------------------------------------------------------------

/**
 * Reads. Kept apart from `Command` so a client can tell from the type
 * alone that asking cannot change anything — which is also what lets a
 * transport retry one after a dropped connection.
 */
export type Query =
  | { readonly type: "projects.list" }
  | ({ readonly type: "project.resolve" } & WorkspaceQuery)
  | ({ readonly type: "threads.list" } & ThreadListQuery)
  | { readonly type: "thread.inspect"; readonly threadId: string }
  | {
      readonly type: "thread.read";
      readonly threadId: string;
      readonly view?: ThreadReadView;
      readonly lastTurn?: boolean;
    }
  | { readonly type: "thread.task.status"; readonly parentThreadId: string; readonly taskId: string }
  /**
   * Resolves once the turn is no longer running or queued. A read that
   * blocks: it changes nothing, so a client can abandon it (or, over a
   * wire, retry it) freely — the turn runs on regardless.
   */
  | { readonly type: "thread.turn.await"; readonly threadId: string; readonly turnId: string }
  /** The live provider catalog, probed on every call, with hidden-model preferences applied. */
  | { readonly type: "providers.list" }
  /** Binaries, git, store and stored-credential presence on the machine running the sessions. */
  | { readonly type: "doctor" }
  /** Skills and slash commands one provider resolves for a working directory. */
  | { readonly type: "skills.list"; readonly instanceId: string; readonly cwd: string };

export type QueryType = Query["type"];

export type QueryOf<T extends QueryType> = Extract<Query, { readonly type: T }>;

export interface QueryResults {
  "projects.list": { readonly projects: readonly StoredProject[] };
  "project.resolve": { readonly workspace: WorkspaceResolution; readonly project: StoredProject | null };
  "threads.list": ThreadList;
  "thread.inspect": { readonly project: StoredProject | null; readonly thread: ThreadInspection };
  "thread.read": { readonly project: StoredProject | null; readonly thread: ThreadReading };
  "thread.task.status": DescribedTask;
  "thread.turn.await": { readonly status: TurnStatus };
  "providers.list": { readonly providers: readonly ProviderSummary[] };
  doctor: Diagnosis;
  "skills.list": SkillInventory;
}

export type QueryResult<T extends QueryType = QueryType> = QueryResults[T];

/** The command with a given `type` — what `dispatch` narrows a literal to. */
export type CommandOf<T extends CommandType> = Extract<Command, { readonly type: T }>;

export type CommandResult<T extends CommandType = CommandType> = CommandResults[T];

// -- subscription frames -----------------------------------------------------

/**
 * `snapshotSequence` is a resume cursor for a transport that replays; the
 * in-process connection re-snapshots on change and always sends 0.
 */
export type ShellFrame =
  | {
      readonly kind: "snapshot";
      readonly snapshot: {
        readonly snapshotSequence: number;
        readonly projects: readonly ProjectEnvelope[];
        readonly threads: readonly ThreadEnvelope[];
      };
    }
  | { readonly kind: "synchronized" };

export type ThreadFrame =
  | { readonly kind: "snapshot"; readonly snapshot: { readonly snapshotSequence: number; readonly thread: ThreadEnvelope } }
  | { readonly kind: "synchronized" }
  /** Live assistant text between snapshots: `text` is the delta, not the whole reply. */
  | {
      readonly kind: "event";
      readonly event: { readonly type: "thread.message-sent"; readonly payload: { readonly message: MessageEnvelope } };
    };

// -- getConfig ---------------------------------------------------------------

export interface ConfigOptionChoice {
  readonly id: string;
  readonly label: string;
  readonly isDefault?: boolean | null;
}

export interface ConfigModel {
  readonly slug: string;
  readonly name: string;
  readonly isCustom: boolean;
  readonly isDefault?: boolean | null;
  readonly capabilities?: {
    readonly optionDescriptors: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly type: "select";
      readonly options: readonly ConfigOptionChoice[];
      readonly currentValue?: string | null;
    }>;
  };
}

export interface ConfigProvider {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName: string | null;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: string | null;
  readonly auth: { readonly status: string | null };
  readonly models: readonly ConfigModel[];
  readonly supportedRuntimeModes?: readonly string[] | null;
  readonly usageLimits?: unknown;
  readonly skills?: unknown;
}

/**
 * The `getConfig` payload. `extractProviders` still decodes it defensively
 * (it was the desktop server's shape first), so the optional fields here
 * are the ones that decoder tolerates missing, not ones the server omits.
 */
export interface ConfigPayload {
  readonly providers: readonly ConfigProvider[];
  readonly settings: Readonly<Record<string, unknown>>;
}

// -- runtime decoding --------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const RUNTIME_MODES: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto",
  "auto-accept-edits",
  "full-access",
];

export function asRuntimeMode(value: unknown): RuntimeMode {
  return typeof value === "string" && (RUNTIME_MODES as readonly string[]).includes(value)
    ? (value as RuntimeMode)
    : "full-access";
}

export function asInteractionMode(value: unknown): InteractionMode {
  return value === "plan" ? "plan" : "default";
}

export function asModelSelection(value: unknown): ModelSelection | null {
  const record = asRecord(value);
  const instanceId = record ? asString(record.instanceId) : null;
  const model = record ? asString(record.model) : null;
  if (!instanceId || !model) return null;
  const options = record?.options;
  const normalized = Array.isArray(options)
    ? options.flatMap((entry) => {
        const row = asRecord(entry);
        const id = row ? asString(row.id) : null;
        const optionValue = row?.value;
        if (!id || (typeof optionValue !== "string" && typeof optionValue !== "boolean")) return [];
        return [{ id, value: optionValue }];
      })
    : [];
  return { instanceId, model, ...(normalized.length > 0 ? { options: normalized } : {}) };
}

export function requireThreadId(value: unknown): string {
  const threadId = typeof value === "string" ? value.trim() : "";
  if (!threadId) {
    throw new CliError("THREAD_ID_REQUIRED", "A non-empty thread id is required.", { exitCode: 2 });
  }
  return threadId;
}

export function unknownCommand(type: string): CliError {
  return new CliError("UNKNOWN_COMMAND", `Unsupported command type: ${type}.`, { details: { type } });
}

function requireField(value: unknown, command: string, field: string): string {
  const text = asString(value);
  if (text === null) {
    throw new CliError("INVALID_THREAD_OPTION", `${command} requires ${field}.`, { exitCode: 2 });
  }
  return text;
}

function decodeAnswers(value: unknown, command: string): UserInputAnswers {
  const record = asRecord(value);
  if (record === null) {
    throw new CliError("INVALID_THREAD_OPTION", `${command} requires answers.`, { exitCode: 2 });
  }
  const answers: Record<string, string | readonly string[]> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") answers[key] = raw;
    else if (Array.isArray(raw)) {
      answers[key] = raw.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return answers;
}

function decodeMessage(value: unknown): ThreadMessageInput {
  const message = asRecord(value);
  const text = message ? (asString(message.text) ?? "") : "";
  if (!text.trim()) {
    throw new CliError("PROMPT_REQUIRED", "A non-empty thread message is required.", { exitCode: 2 });
  }
  const attachments =
    message && Array.isArray(message.attachments) ? (message.attachments as ImageAttachmentUpload[]) : [];
  return { text, ...(attachments.length > 0 ? { attachments } : {}) };
}

/**
 * Turn an untrusted value into a `Command`, or throw the same `CliError`
 * the handler would have thrown. Every check that used to be scattered
 * through the dispatch handlers happens here, once, before any of them
 * runs — which is what lets a transport validate a frame without also
 * executing it.
 */
export function decodeCommand(value: unknown): Command {
  const record = asRecord(value);
  const type = record ? asString(record.type) : null;
  if (record === null || type === null) {
    throw unknownCommand(String(asRecord(value)?.type ?? "missing"));
  }
  const commandId = asString(record.commandId);
  const meta = commandId === null ? {} : { commandId };
  const threadId = (): string => requireThreadId(record.threadId);

  switch (type) {
    case "project.create":
      return {
        ...meta,
        type,
        workspaceRoot: requireField(record.workspaceRoot, type, "workspaceRoot"),
        ...(asString(record.projectId) ? { projectId: asString(record.projectId) as string } : {}),
        ...(asString(record.title) ? { title: asString(record.title) as string } : {}),
      };
    case "thread.create": {
      const projectId = asString(record.projectId);
      if (projectId === null) {
        throw new CliError("PROJECT_ID_REQUIRED", "thread.create requires projectId.", { exitCode: 2 });
      }
      const selection = asModelSelection(record.modelSelection);
      return {
        ...meta,
        type,
        projectId,
        ...(asString(record.threadId) ? { threadId: asString(record.threadId) as string } : {}),
        ...(asString(record.title) ? { title: asString(record.title) as string } : {}),
        ...(selection ? { modelSelection: selection } : {}),
        // Absent modes stay absent: the server fills them from config.
        ...optionalEnum(record, "runtimeMode", RUNTIME_MODES, type),
        ...optionalEnum(record, "interactionMode", ["default", "plan"] as const, type),
        ...(typeof record.branch === "string" ? { branch: record.branch } : {}),
      };
    }
    case "thread.turn.start": {
      const selection = asModelSelection(record.modelSelection);
      return {
        ...meta,
        type,
        threadId: threadId(),
        message: decodeMessage(record.message),
        ...(selection ? { modelSelection: selection } : {}),
        ...optionalEnum(record, "ifBusy", ["reject", "inject"] as const, type),
        ...optionalEnum(record, "delivery", ["auto", "steer", "restart", "queue"] as const, type),
        ...optionalBoolean(record, "wakeSettled"),
        ...optionalString(record, "handoffNote"),
        ...optionalBoolean(record, "wait"),
      };
    }
    case "thread.turn.interrupt":
      return {
        ...meta,
        type,
        threadId: threadId(),
        ...(asString(record.turnId) ? { turnId: asString(record.turnId) as string } : {}),
      };
    case "thread.settle":
    case "thread.unsettle":
      return {
        ...meta,
        type,
        threadId: threadId(),
        ...(asString(record.reason) ? { reason: asString(record.reason) as string } : {}),
      };
    case "thread.snooze": {
      const until = asString(record.snoozedUntil);
      if (until === null) {
        throw new CliError("SNOOZE_UNTIL_INVALID", "Use --until with a valid ISO-8601 datetime.", { exitCode: 2 });
      }
      return { ...meta, type, threadId: threadId(), snoozedUntil: until };
    }
    case "thread.unsnooze":
    case "thread.archive":
    case "thread.delete":
      return { ...meta, type, threadId: threadId() };
    case "thread.meta.update":
      return {
        ...meta,
        type,
        threadId: threadId(),
        ...(typeof record.title === "string" ? { title: record.title } : {}),
        ...(record.regenerateTitle === true ? { regenerateTitle: true } : {}),
      };
    case "thread.model-selection.set": {
      const selection = asModelSelection(record.modelSelection);
      if (selection === null) {
        throw new CliError("INVALID_THREAD_OPTION", "model-selection.set requires a model selection.");
      }
      return { ...meta, type, threadId: threadId(), modelSelection: selection };
    }
    case "thread.runtime-mode.set": {
      const mode = record.runtimeMode;
      if (typeof mode !== "string" || !(RUNTIME_MODES as readonly string[]).includes(mode)) {
        throw new CliError("INVALID_THREAD_OPTION", "runtime-mode.set requires a known runtime mode.", {
          exitCode: 2,
        });
      }
      return {
        ...meta,
        type,
        threadId: threadId(),
        runtimeMode: mode as RuntimeMode,
        ...(record.interactionMode !== undefined
          ? { interactionMode: asInteractionMode(record.interactionMode) }
          : {}),
      };
    }
    case "thread.user-input.respond":
      return {
        ...meta,
        type,
        threadId: threadId(),
        requestId: requireField(record.requestId, type, "requestId"),
        answers: decodeAnswers(record.answers, type),
      };
    case "thread.user-input.dismiss":
      return {
        ...meta,
        type,
        threadId: threadId(),
        requestId: requireField(record.requestId, type, "requestId"),
      };
    case "thread.conversation.revert": {
      const turnCount = record.turnCount;
      if (typeof turnCount !== "number" || !Number.isInteger(turnCount) || turnCount < 0) {
        throw new CliError("INVALID_THREAD_OPTION", `${type} requires a non-negative integer turnCount.`, {
          exitCode: 2,
        });
      }
      return { ...meta, type, threadId: threadId(), turnCount };
    }
    case "thread.handover":
      return {
        ...meta,
        type,
        cwd: requireField(record.cwd, type, "cwd"),
        // Emptiness is the operation's to reject, with its own PROMPT_REQUIRED.
        prompt: typeof record.prompt === "string" ? record.prompt : "",
        ...optionalEnum(record, "workspaceMode", ["repo", "folder"] as const, type),
        ...optionalEnum(record, "projectPolicy", ["create", "existing"] as const, type),
        ...optionalEnum(record, "threadEnvMode", ["auto", "local", "worktree"] as const, type),
        ...optionalEnum(record, "runtimeMode", RUNTIME_MODES, type),
        ...optionalEnum(record, "interactionMode", ["default", "plan"] as const, type),
        ...decodeModelRequest(record, type),
        ...optionalBoolean(record, "dryRun"),
        ...optionalBoolean(record, "wait"),
      };
    case "thread.delegate":
      return {
        ...meta,
        type,
        parentThreadId: requireThreadId(record.parentThreadId),
        task: typeof record.task === "string" ? record.task : "",
        ...optionalString(record, "title"),
        ...decodeModelRequest(record, type),
        ...optionalBoolean(record, "wait"),
        ...optionalNumber(record, "timeoutMs", type),
        ...optionalBoolean(record, "dryRun"),
        ...optionalEnum(record, "isolation", ["shared", "worktree"] as const, type),
      };
    case "thread.task.cancel":
      return {
        ...meta,
        type,
        parentThreadId: requireThreadId(record.parentThreadId),
        taskId: requireField(record.taskId, type, "taskId"),
      };
    case "project.ensure":
      return {
        ...meta,
        type,
        cwd: requireField(record.cwd, type, "cwd"),
        ...optionalEnum(record, "workspaceMode", ["repo", "folder"] as const, type),
        ...optionalEnum(record, "projectPolicy", ["create", "existing"] as const, type),
        ...optionalBoolean(record, "dryRun"),
      };
    case "model.visibility.set":
      if (typeof record.hidden !== "boolean") {
        throw new CliError("INVALID_THREAD_OPTION", `${type} requires hidden.`, { exitCode: 2 });
      }
      return {
        ...meta,
        type,
        instanceId: requireField(record.instanceId, type, "instanceId"),
        model: requireField(record.model, type, "model"),
        hidden: record.hidden,
      };
    default:
      throw unknownCommand(type);
  }
}

// -- field decoders ------------------------------------------------------------

function optionalString<K extends string>(record: Record<string, unknown>, key: K): { [P in K]?: string } {
  const value = asString(record[key]);
  return (value === null ? {} : { [key]: value }) as { [P in K]?: string };
}

function optionalBoolean<K extends string>(record: Record<string, unknown>, key: K): { [P in K]?: boolean } {
  const value = record[key];
  return (typeof value === "boolean" ? { [key]: value } : {}) as { [P in K]?: boolean };
}

function optionalNumber<K extends string>(record: Record<string, unknown>, key: K, command: string): { [P in K]?: number } {
  const value = record[key];
  if (value === undefined) return {} as { [P in K]?: number };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CliError("INVALID_THREAD_OPTION", `${command} ${key} must be a number.`, { exitCode: 2 });
  }
  return { [key]: value } as { [P in K]?: number };
}

/** A known value or absent; anything else is refused rather than defaulted. */
function optionalEnum<K extends string, V extends string>(
  record: Record<string, unknown>,
  key: K,
  allowed: readonly V[],
  command: string,
): { [P in K]?: V } {
  const value = record[key];
  if (value === undefined) return {} as { [P in K]?: V };
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new CliError("INVALID_THREAD_OPTION", `${command} ${key} must be one of ${allowed.join(", ")}.`, {
      exitCode: 2,
      details: { [key]: value },
    });
  }
  return { [key]: value as V } as { [P in K]?: V };
}

function decodeModelRequest(record: Record<string, unknown>, command: string): ModelRequest {
  return {
    ...optionalString(record, "provider"),
    ...optionalString(record, "model"),
    ...optionalEnum(record, "speedMode", ["standard", "fast"] as const satisfies readonly SpeedMode[], command),
    ...optionalString(record, "thinkingEffort"),
  };
}

/** `decodeCommand` for reads. */
export function decodeQuery(value: unknown): Query {
  const record = asRecord(value);
  const type = record ? asString(record.type) : null;
  if (record === null || type === null) {
    throw new CliError("UNKNOWN_QUERY", `Unsupported query type: ${String(asRecord(value)?.type ?? "missing")}.`);
  }
  switch (type) {
    case "projects.list":
      return { type };
    case "project.resolve":
      return {
        type,
        cwd: requireField(record.cwd, type, "cwd"),
        ...optionalEnum(record, "workspaceMode", ["repo", "folder"] as const, type),
      };
    case "threads.list":
      return {
        type,
        ...optionalString(record, "projectId"),
        ...optionalString(record, "cwd"),
        ...optionalEnum(record, "workspaceMode", ["repo", "folder"] as const, type),
        ...optionalEnum(record, "status", ["active", "settled", "snoozed", "all"] as const satisfies readonly ThreadListStatus[], type),
      };
    case "thread.inspect":
      return { type, threadId: requireThreadId(record.threadId) };
    case "thread.read":
      return {
        type,
        threadId: requireThreadId(record.threadId),
        // Validated by the read itself, whose error names the CLI flag
        // that `--json` consumers already match on.
        ...(typeof record.view === "string" ? { view: record.view as ThreadReadView } : {}),
        ...optionalBoolean(record, "lastTurn"),
      };
    case "thread.task.status":
      return {
        type,
        parentThreadId: requireThreadId(record.parentThreadId),
        taskId: requireField(record.taskId, type, "taskId"),
      };
    case "thread.turn.await":
      return {
        type,
        threadId: requireThreadId(record.threadId),
        turnId: requireField(record.turnId, type, "turnId"),
      };
    case "providers.list":
    case "doctor":
      return { type };
    case "skills.list":
      return {
        type,
        instanceId: requireField(record.instanceId, type, "instanceId"),
        cwd: requireField(record.cwd, type, "cwd"),
      };
    default:
      throw new CliError("UNKNOWN_QUERY", `Unsupported query type: ${type}.`, { details: { type } });
  }
}
