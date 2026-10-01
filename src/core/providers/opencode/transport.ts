/**
 * OpenCode transport: spawn `opencode serve` per working directory (or
 * attach to an external URL) and talk to it through `@opencode/client`
 * (OpenCode v2's generated client).
 *
 * The only file in this driver with a runtime SDK import. Everything else
 * depends on the narrow `OpencodeServerConnection` below, so tests inject
 * a fake without binaries or ports. v2's API is an intentional break from
 * v1; `translate.ts` converts its events and history into the vocabulary
 * the driver reads, and this file speaks v2 to the server. Serve mechanics:
 * `serve --hostname=… --port=…`, readiness off the `server listening on <url>`
 * line, `OPENCODE_CONFIG_CONTENT` passthrough (share/update pinned off), and
 * a password on every spawned server (v2 authenticates every `/api` call with
 * HTTP Basic `opencode:<password>`), version gate before use.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";

import { OpenCode } from "@opencode/client";

import { CliError } from "../../errors.js";
import { killProcessTree } from "../../infra/process.js";
import {
  buildServerConfigContent,
  compareSemver,
  OPENCODE_DEFAULT_HOSTNAME,
  OPENCODE_SERVER_READY_PATTERN,
  OPENCODE_SERVER_START_TIMEOUT_MS,
  resolveSpawnedServerPassword,
  type OpencodeSettings,
} from "./config.js";
import { authTypesOf } from "./catalog.js";
import {
  answerForForm,
  OpencodeEventTranslator,
  translateTimeline,
  type OpencodeMessage,
  type OpencodeSubscribedEvent,
} from "./translate.js";

export type { OpencodeMessage, OpencodeSubscribedEvent } from "./translate.js";

/** An attachment as v2's prompt takes it: a URI (here a `data:` URL) and a name. */
export interface OpencodeFilePart {
  readonly uri: string;
  readonly name: string;
}

/** Caller-assigned message id in the server's format (`msg_` + 12 hex + 14 base62). */
export function newOpencodeMessageId(): string {
  const hex = randomBytes(6).toString("hex");
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(14);
  let tail = "";
  for (let index = 0; index < bytes.length; index += 1) {
    tail += chars[(bytes[index] ?? 0) % chars.length];
  }
  return `msg_${hex}${tail}`;
}

export type OpencodeMcpConfig =
  | { readonly type: "local"; readonly command: readonly string[]; readonly environment?: Readonly<Record<string, string>> }
  | { readonly type: "remote"; readonly url: string; readonly headers?: Readonly<Record<string, string>> };

/** A model address, as v2's `Model.Ref`: provider, model id, optional reasoning variant. */
export interface OpencodeModelRef {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string;
}

/** A native session as the driver needs it: its id plus what it is already set to. */
export interface OpencodeSessionState {
  readonly sessionID: string;
  /** The session that started this one: set on a `subagent` child. */
  readonly parentID?: string;
  readonly agent?: string;
  readonly model?: OpencodeModelRef;
}

/** One model's token limits, as the server reports them (`Model.limit`). */
export interface OpencodeModelLimit {
  readonly context: number;
  readonly input?: number;
  readonly output: number;
}

/** A model the server can run (`model.list`). */
export interface OpencodeModelInfo {
  readonly providerID: string;
  readonly modelID: string;
  /** Reasoning-variant ids (`low`, `high`, …); empty when the model has none. */
  readonly variants: readonly string[];
  readonly limit: OpencodeModelLimit;
}

/** What a context-window reading needs from the server, fetched once per connection. */
export interface OpencodeContextSettings {
  /** Keyed `provider/model`. */
  readonly limits: ReadonlyMap<string, OpencodeModelLimit>;
  /** `compaction.auto` (default on) and `compaction.buffer` (null: derive from the limit), from the server's config. */
  readonly autoCompact: boolean;
  readonly buffer: number | null;
}

export interface OpencodeServerConnection {
  readonly url: string;
  readonly version: string;
  readonly external: boolean;
  /**
   * Resolves when the server behind this connection is gone (a spawned child
   * exited); never for an external server, whose loss shows as a dead event
   * stream instead. The driver drops a connection that closes.
   */
  readonly closed: Promise<void>;
  /** Untitled when `title` is absent, so OpenCode's own `title` agent names it after the first step. */
  createSession(input: { title?: string }): Promise<OpencodeSessionState>;
  /** The session's title as the server has it, null while it has none (or the session is gone). */
  sessionTitle(sessionID: string): Promise<string | null>;
  /** `session.update` with a title. */
  renameSession(sessionID: string, title: string): Promise<void>;
  /**
   * Have OpenCode's `title` agent name the session again: an empty title
   * clears it and the server regenerates one from the conversation before
   * answering. (`title: null` is ignored.) Resolves to the new title.
   */
  regenerateSessionTitle(sessionID: string): Promise<string | null>;
  /** The session as the server has it, or null when it is gone. */
  getSession(sessionID: string): Promise<OpencodeSessionState | null>;
  /**
   * `mcp.add` for this connection's directory. Runtime state, gone on server
   * restart, so callers dedupe per connection.
   */
  addMcpServer(name: string, config: OpencodeMcpConfig): Promise<void>;
  /**
   * The session's timeline as `{info, parts}` messages, oldest first. `tail`
   * reads only the newest N timeline items (one request) — enough for usage
   * and "is the last prompt answered", which never need the whole history.
   */
  sessionMessages(sessionID: string, options?: { tail?: number }): Promise<ReadonlyArray<OpencodeMessage>>;
  /** The messages the model sees now (`session.context`: after the last compaction), oldest first. */
  sessionContext(sessionID: string): Promise<ReadonlyArray<OpencodeMessage>>;
  /**
   * Credential type per provider id (`api` | `oauth` | `env`) as this server
   * knows them (`GET /api/integration`). Connection types only, never a secret.
   */
  storedAuthTypes(): Promise<Record<string, string>>;
  /** `session.inbox.cancel`: drop a queued, undelivered inbox item (a prompt or steer). */
  cancelInbox(sessionID: string, inboxID: string): Promise<void>;
  contextSettings(): Promise<OpencodeContextSettings>;
  /** Models the server can run right now (`model.list`). */
  listModels(): Promise<ReadonlyArray<OpencodeModelInfo>>;
  /** `command.list` plus `skill.list` (skills carry `source: "skill"`; v2 has no command hints). */
  listCommands(): Promise<ReadonlyArray<{ name: string; description: string | null; source: string | null; hints: readonly string[] }>>;
  /**
   * `session.prompt`. v2 prompts carry only text and files: the model, agent
   * and instructions are session state, set through the three calls below.
   */
  prompt(input: {
    sessionID: string;
    messageID?: string;
    text: string;
    files?: ReadonlyArray<OpencodeFilePart>;
  }): Promise<{ messageID: string }>;
  /** `session.switchModel`. The server does not validate it; the caller checks `listModels`. */
  switchModel(sessionID: string, model: OpencodeModelRef): Promise<void>;
  switchAgent(sessionID: string, agent: string): Promise<void>;
  /** Set (string) or clear (null) one runtime instruction entry for the session. */
  setInstructions(sessionID: string, key: string, value: string | null): Promise<void>;
  abortSession(sessionID: string): Promise<void>;
  /** `session.fork`: a copy of the session, up to (excluding) `beforeMessageID` when given. */
  forkSession(sessionID: string, beforeMessageID?: string): Promise<OpencodeSessionState>;
  /** `session.compact`, on the session's own model (v2 takes none: switch it first). */
  summarizeSession(sessionID: string): Promise<void>;
  replyToPermission(sessionID: string, requestID: string, reply: "once" | "always" | "reject"): Promise<void>;
  /** Answer a question form: one `string[]` per question, in the order it was asked. */
  replyToQuestion(sessionID: string, requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): Promise<void>;
  rejectQuestion(sessionID: string, requestID: string): Promise<void>;
  /**
   * The server's event stream, translated. Resolves once the stream is live:
   * v2 does not replay events, so anything sent before this returns can be missed.
   */
  subscribeEvents(input: { signal: AbortSignal }): Promise<{ stream: AsyncIterable<OpencodeSubscribedEvent> }>;
  dispose(): Promise<void>;
}

export interface EnsureOpencodeServerInput {
  readonly settings: OpencodeSettings;
  readonly workingDirectory: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface OpencodeTransport {
  ensureServer(input: EnsureOpencodeServerInput): Promise<OpencodeServerConnection>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function errorDetail(cause: unknown): string {
  if (cause instanceof Error) {
    // Declared v2 errors carry their tag as `name` (`SessionNotFoundError`).
    return cause.name !== "Error" && cause.name !== "ClientError" && !cause.message.includes(cause.name)
      ? `${cause.name}: ${cause.message}`
      : cause.message;
  }
  return String(cause);
}

/** A 404 from the server: a declared `*NotFoundError`, or an undeclared status 404. */
function isNotFound(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (cause.name.endsWith("NotFoundError")) return true;
  const status = asRecord((cause as { cause?: unknown }).cause)?.status;
  return status === 404;
}

async function request<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof CliError) throw cause;
    throw new CliError("OPENCODE_REQUEST_FAILED", `OpenCode ${label} failed: ${errorDetail(cause)}.`, {
      details: { label },
      cause,
    });
  }
}

type SdkClient = ReturnType<typeof OpenCode.make>;

const sessionStateOf = (label: string, data: unknown): OpencodeSessionState => {
  const record = asRecord(data);
  const id = asString(record?.id);
  if (!id) throw new CliError("OPENCODE_REQUEST_FAILED", `OpenCode ${label} did not return a session id.`, {});
  const model = asRecord(record?.model);
  const providerID = asString(model?.providerID);
  const modelID = asString(model?.id);
  const variant = asString(model?.variant);
  return {
    sessionID: id,
    ...(asString(record?.parentID) ? { parentID: asString(record?.parentID) as string } : {}),
    ...(asString(record?.agent) ? { agent: asString(record?.agent) as string } : {}),
    ...(providerID && modelID ? { model: { providerID, modelID, ...(variant ? { variant } : {}) } } : {}),
  };
};

/** Timeline items read per page, and the most pages a full read follows. */
const MESSAGE_PAGE_SIZE = 100;
const MESSAGE_MAX_PAGES = 200;
/** How long `subscribeEvents` waits for the stream's first frame (`server.connected`). */
const SUBSCRIBE_READY_MS = 10_000;

class LiveOpencodeServerConnection implements OpencodeServerConnection {
  private disposed = false;
  private readonly translator = new OpencodeEventTranslator();
  readonly closed: Promise<void>;

  constructor(
    readonly url: string,
    readonly version: string,
    readonly external: boolean,
    private readonly client: SdkClient,
    private readonly child: ChildProcess | null,
    private readonly directory: string,
  ) {
    this.closed = child
      ? new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        })
      : new Promise<void>(() => undefined);
  }

  private get location(): { directory: string } {
    return { directory: this.directory };
  }

  async createSession(input: { title?: string }): Promise<OpencodeSessionState> {
    // The location goes in the body: v2 ignores the directory header on create.
    const data = await request("session.create", () =>
      this.client.session.create({ ...(input.title ? { title: input.title } : {}), location: this.location }),
    );
    return sessionStateOf("session.create", data);
  }

  async sessionTitle(sessionID: string): Promise<string | null> {
    const data = await request("session.get", () => this.client.session.get({ sessionID }));
    return asString(asRecord(data)?.title)?.trim() || null;
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    await request("session.update", () => this.client.session.update({ sessionID, title }));
  }

  async regenerateSessionTitle(sessionID: string): Promise<string | null> {
    await request("session.update", () => this.client.session.update({ sessionID, title: "" }));
    return await this.sessionTitle(sessionID);
  }

  async getSession(sessionID: string): Promise<OpencodeSessionState | null> {
    try {
      return sessionStateOf("session.get", await this.client.session.get({ sessionID }));
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw new CliError("OPENCODE_REQUEST_FAILED", `OpenCode session.get failed: ${errorDetail(cause)}.`, {
        details: { label: "session.get" },
        cause,
      });
    }
  }

  async addMcpServer(name: string, config: OpencodeMcpConfig): Promise<void> {
    const body =
      config.type === "local"
        ? { type: "local" as const, command: [...config.command], ...(config.environment ? { environment: { ...config.environment } } : {}) }
        : { type: "remote" as const, url: config.url, ...(config.headers ? { headers: { ...config.headers } } : {}) };
    await request("mcp.add", () => this.client.mcp.add({ server: name, location: this.location, config: body }));
  }

  async sessionMessages(sessionID: string, options?: { tail?: number }): Promise<ReadonlyArray<OpencodeMessage>> {
    if (options?.tail !== undefined) {
      const page = await request("message.list", () =>
        this.client.message.list({ sessionID, order: "desc", limit: options.tail }),
      );
      const data = Array.isArray(asRecord(page)?.data) ? (asRecord(page)?.data as unknown[]) : [];
      return translateTimeline([...data].reverse());
    }
    const items: unknown[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < MESSAGE_MAX_PAGES; pages += 1) {
      const page = await request("message.list", () =>
        this.client.message.list(
          cursor === undefined
            ? { sessionID, order: "asc", limit: MESSAGE_PAGE_SIZE }
            : { sessionID, cursor, limit: MESSAGE_PAGE_SIZE },
        ),
      );
      const record = asRecord(page);
      const data = Array.isArray(record?.data) ? (record.data as unknown[]) : [];
      items.push(...data);
      const next = asString(asRecord(record?.cursor)?.next);
      if (data.length === 0 || next === null || next === cursor) break;
      cursor = next;
    }
    return translateTimeline(items);
  }

  async sessionContext(sessionID: string): Promise<ReadonlyArray<OpencodeMessage>> {
    const items = await request("session.context", () => this.client.session.context({ sessionID }));
    return translateTimeline(Array.isArray(items) ? items : []);
  }

  async storedAuthTypes(): Promise<Record<string, string>> {
    const result = await request("integration.list", () => this.client.integration.list({ location: this.location }));
    return authTypesOf(asRecord(result)?.data);
  }

  async cancelInbox(sessionID: string, inboxID: string): Promise<void> {
    await request("session.inbox.cancel", () => this.client.session.inbox.cancel({ sessionID, inboxID }));
  }

  async listModels(): Promise<ReadonlyArray<OpencodeModelInfo>> {
    const result = await request("model.list", () => this.client.model.list({ location: this.location }));
    const data = Array.isArray(asRecord(result)?.data) ? (asRecord(result)?.data as unknown[]) : [];
    return data.flatMap((entry) => {
      const model = asRecord(entry);
      const providerID = asString(model?.providerID);
      const modelID = asString(model?.id);
      if (!model || !providerID || !modelID) return [];
      const limit = asRecord(model.limit);
      const context = typeof limit?.context === "number" ? limit.context : 0;
      return [{
        providerID,
        modelID,
        variants: (Array.isArray(model.variants) ? model.variants : []).flatMap((variant) => {
          const id = asString(asRecord(variant)?.id);
          return id ? [id] : [];
        }),
        limit: {
          context,
          output: typeof limit?.output === "number" ? limit.output : 0,
          ...(typeof limit?.input === "number" ? { input: limit.input } : {}),
        },
      }];
    });
  }

  async listCommands(): Promise<ReadonlyArray<{ name: string; description: string | null; source: string | null; hints: readonly string[] }>> {
    const [commands, skills] = await Promise.all([
      request("command.list", () => this.client.command.list({ location: this.location })),
      // Skills are their own list in v2; a server without them still lists commands.
      this.client.skill.list({ location: this.location }).catch(() => null),
    ]);
    const read = (result: unknown): Array<Record<string, unknown>> => {
      const data = asRecord(result)?.data;
      return (Array.isArray(data) ? data : []).flatMap((entry) => {
        const record = asRecord(entry);
        return record && asString(record.name) ? [record] : [];
      });
    };
    const skillEntries = read(skills).map((skill) => ({
      name: skill.name as string,
      description: asString(skill.description),
      source: "skill" as string | null,
      hints: [] as readonly string[],
    }));
    const skillNames = new Set(skillEntries.map((entry) => entry.name));
    const commandEntries = read(commands)
      .filter((command) => !skillNames.has(command.name as string))
      .map((command) => ({
        name: command.name as string,
        description: asString(command.description),
        source: "command" as string | null,
        hints: [] as readonly string[],
      }));
    return [...commandEntries, ...skillEntries];
  }

  async contextSettings(): Promise<OpencodeContextSettings> {
    const limits = new Map<string, OpencodeModelLimit>();
    for (const model of await this.listModels()) {
      if (model.limit.context > 0) limits.set(`${model.providerID}/${model.modelID}`, model.limit);
    }
    // Config is advisory: a server that will not answer keeps upstream defaults.
    const entries = await this.client.config.get({ location: this.location }).catch(() => []);
    // `config.get` is not merged: a list of documents, lowest priority first.
    let autoCompact = true;
    let buffer: number | null = null;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const record = asRecord(entry);
      if (record?.type !== "document") continue;
      const compaction = asRecord(asRecord(record.info)?.compaction);
      if (!compaction) continue;
      if (typeof compaction.auto === "boolean") autoCompact = compaction.auto;
      // `reserved` is v1's name for `buffer`.
      const size = typeof compaction.buffer === "number" ? compaction.buffer : compaction.reserved;
      if (typeof size === "number") buffer = size;
    }
    return { limits, autoCompact, buffer };
  }

  async prompt(input: {
    sessionID: string;
    messageID?: string;
    text: string;
    files?: ReadonlyArray<OpencodeFilePart>;
  }): Promise<{ messageID: string }> {
    // The message id is caller-assigned and echoed back as the inbox id.
    const messageID = input.messageID ?? newOpencodeMessageId();
    await request("session.prompt", () =>
      this.client.session.prompt({
        sessionID: input.sessionID,
        id: messageID,
        text: input.text,
        ...(input.files && input.files.length > 0
          ? { files: input.files.map((file) => ({ uri: file.uri, name: file.name })) }
          : {}),
      }),
    );
    return { messageID };
  }

  async switchModel(sessionID: string, model: OpencodeModelRef): Promise<void> {
    await request("session.switchModel", () =>
      this.client.session.switchModel({
        sessionID,
        model: { id: model.modelID, providerID: model.providerID, ...(model.variant ? { variant: model.variant } : {}) },
      }),
    );
  }

  async switchAgent(sessionID: string, agent: string): Promise<void> {
    await request("session.switchAgent", () => this.client.session.switchAgent({ sessionID, agent }));
  }

  async setInstructions(sessionID: string, key: string, value: string | null): Promise<void> {
    if (value === null) {
      await request("session.instructions.entry.remove", () =>
        this.client.session.instructions.entry.remove({ sessionID, key }),
      );
      return;
    }
    await request("session.instructions.entry.put", () =>
      this.client.session.instructions.entry.put({ sessionID, key, value }),
    );
  }

  async abortSession(sessionID: string): Promise<void> {
    await this.client.session.interrupt({ sessionID }).catch(() => undefined);
  }

  async forkSession(sessionID: string, beforeMessageID?: string): Promise<OpencodeSessionState> {
    const data = await request("session.fork", () =>
      this.client.session.fork({ sessionID, ...(beforeMessageID ? { before: beforeMessageID } : {}) }),
    );
    return sessionStateOf("session.fork", data);
  }

  async summarizeSession(sessionID: string): Promise<void> {
    await request("session.compact", () => this.client.session.compact({ sessionID }));
  }

  async replyToPermission(sessionID: string, requestID: string, reply: "once" | "always" | "reject"): Promise<void> {
    await request("permission.reply", () =>
      this.client.permission.reply({ sessionID, requestID, decision: reply }),
    );
  }

  async replyToQuestion(sessionID: string, requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): Promise<void> {
    let fields = this.translator.formFields(requestID);
    if (!fields) {
      // Seen before this process listened (a resumed session): ask the server.
      const detail = await request("session.form.get", () => this.client.session.form.get({ sessionID, formID: requestID }));
      fields = (Array.isArray(asRecord(detail)?.fields) ? (asRecord(detail)?.fields as unknown[]) : []).flatMap((field) => {
        const record = asRecord(field);
        const key = asString(record?.key);
        return key ? [{ key, type: asString(record?.type) ?? "string" }] : [];
      });
    }
    await request("session.form.reply", () =>
      this.client.session.form.reply({ sessionID, formID: requestID, answer: answerForForm(fields, answers) }),
    );
  }

  async rejectQuestion(sessionID: string, requestID: string): Promise<void> {
    await request("session.form.cancel", () => this.client.session.form.cancel({ sessionID, formID: requestID }));
  }

  async subscribeEvents(input: { signal: AbortSignal }): Promise<{ stream: AsyncIterable<OpencodeSubscribedEvent> }> {
    const translator = this.translator;
    translator.resetLive();
    const iterator = this.client.event.subscribe({ signal: input.signal })[Symbol.asyncIterator]();
    // Events before the first frame (`server.connected`) are not replayed, so
    // do not report the stream live until the server has confirmed it. A
    // rejected first frame (bad password, server gone) is the caller's to see.
    const first = iterator.next();
    void first.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      first,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SUBSCRIBE_READY_MS);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]).finally(() => clearTimeout(timer));
    async function* events(): AsyncGenerator<OpencodeSubscribedEvent> {
      try {
        let step = await first;
        while (!step.done) {
          for (const event of translator.translate(step.value)) yield event;
          step = await iterator.next();
        }
      } finally {
        await iterator.return?.().catch(() => undefined);
      }
    }
    return { stream: events() };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    if (!child || this.external) return;
    await new Promise<void>((resolve) => {
      const pid = child.pid;
      const done = (): void => resolve();
      if (!pid) {
        child.kill("SIGKILL");
        done();
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        done();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
      try {
        // The spawned binary may be a shim: the tree, or the server survives it.
        if (process.platform === "win32") killProcessTree(child, "SIGKILL");
        else process.kill(-pid, "SIGTERM");
      } catch {
        clearTimeout(timer);
        done();
      }
    });
  }
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, OPENCODE_DEFAULT_HOSTNAME, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** `GET /api/info`: v2's replacement for v1's `global.health` (which now answers with the web app). */
async function verifyServerVersion(
  client: SdkClient,
  minVersion: string,
  binaryPath: string,
): Promise<string> {
  let info: unknown;
  try {
    info = await client.server.info();
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "UnauthorizedError" || asRecord((cause as { cause?: unknown }).cause)?.status === 401)) {
      // Not worded as an auth failure: that reads as "sign in to a provider".
      throw new CliError("OPENCODE_SERVER_REJECTED", "The OpenCode server rejected the configured server password.", {
        details: { binaryPath },
      });
    }
    throw new CliError("OPENCODE_UNREACHABLE", `Could not reach the OpenCode server: ${errorDetail(cause)}.`, {
      details: { binaryPath },
    });
  }
  const version = asString(asRecord(info)?.version) ?? "";
  if (version.length === 0) {
    throw new CliError("OPENCODE_UNHEALTHY", "The OpenCode server did not report a version.", {
      details: { version },
    });
  }
  if (compareSemver(version, minVersion) < 0) {
    throw new CliError(
      "OPENCODE_TOO_OLD",
      `OpenCode v${version} is too old. Upgrade to v${minVersion} or newer.`,
      { details: { version, minVersion } },
    );
  }
  return version;
}

function basicAuthHeader(password: string): Record<string, string> {
  if (password.length === 0) return {};
  return { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` };
}

export class SpawnOpencodeTransport implements OpencodeTransport {
  async ensureServer(input: EnsureOpencodeServerInput): Promise<OpencodeServerConnection> {
    const { settings } = input;
    const baseEnv = input.env ?? process.env;
    if (settings.serverUrl.trim().length > 0) {
      const url = settings.serverUrl.trim();
      const client = OpenCode.make({ baseUrl: url, headers: basicAuthHeader(settings.serverPassword) });
      const version = await verifyServerVersion(client, settings.minVersion, settings.binaryPath);
      return new LiveOpencodeServerConnection(url, version, true, client, null, input.workingDirectory);
    }

    const port = await findAvailablePort().catch((cause: unknown) => {
      throw new CliError("OPENCODE_SPAWN_FAILED", `Could not find a port for opencode serve: ${errorDetail(cause)}.`, {
        details: { binaryPath: settings.binaryPath },
      });
    });
    // Always a password: v2 authenticates every call, and would otherwise
    // invent one and print it. Never logged (see `waitForServerReady`).
    const password = resolveSpawnedServerPassword(settings, baseEnv);
    const childEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      OPENCODE_CONFIG_CONTENT: buildServerConfigContent(baseEnv.OPENCODE_CONFIG_CONTENT),
      OPENCODE_PASSWORD: password,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    };
    const child = spawn(settings.binaryPath, ["serve", `--hostname=${OPENCODE_DEFAULT_HOSTNAME}`, `--port=${port}`], {
      env: childEnv,
      cwd: input.workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const url = await waitForServerReady(child, settings.binaryPath, password).catch(async (cause: unknown) => {
      killProcessTree(child, "SIGKILL");
      throw cause;
    });
    const client = OpenCode.make({ baseUrl: url, headers: basicAuthHeader(password) });
    const version = await verifyServerVersion(client, settings.minVersion, settings.binaryPath).catch(
      async (cause: unknown) => {
        await new LiveOpencodeServerConnection(url, versionFallback(), false, client, child, input.workingDirectory)
          .dispose()
          .catch(() => undefined);
        throw cause;
      },
    );
    return new LiveOpencodeServerConnection(url, version, false, client, child, input.workingDirectory);
  }
}

function versionFallback(): string {
  return "0.0.0";
}

function waitForServerReady(child: ChildProcess, binaryPath: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    // Server output can end up in an error message; the password never does.
    const shown = (): string => (password.length > 0 ? output.split(password).join("***") : output).slice(-500);
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new CliError("OPENCODE_SPAWN_FAILED", `Timed out waiting for opencode serve to listen: ${shown()}.`, {
          details: { binaryPath },
        }),
      );
    }, OPENCODE_SERVER_START_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      if (output.length > 64 * 1024) output = output.slice(-64 * 1024);
      const match = output.match(OPENCODE_SERVER_READY_PATTERN);
      if (!match?.[1]) return;
      cleanup();
      resolve(match[1]);
    };
    const onError = (cause: Error): void => {
      cleanup();
      reject(
        new CliError("OPENCODE_SPAWN_FAILED", `Could not spawn opencode serve: ${cause.message}.`, {
          details: { binaryPath },
        }),
      );
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(
        new CliError("OPENCODE_SPAWN_FAILED", `opencode serve exited before listening (code ${code}): ${shown()}.`, {
          details: { binaryPath, code },
        }),
      );
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}
