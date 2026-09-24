/**
 * OpenCode transport: spawn `opencode serve` per working directory (or
 * attach to an external URL) and talk to it through `@opencode-ai/sdk`.
 *
 * The only file in this driver with a runtime SDK import. Everything else
 * depends on the narrow `OpencodeServerConnection` below, so tests inject
 * a fake without binaries or ports. Serve mechanics follow the upstream reference's
 * `opencodeRuntime.ts`: `serve --hostname=… --port=…`, readiness off the
 * `opencode server listening on <url>` sentinel, `OPENCODE_CONFIG_CONTENT`
 * passthrough (plus our vendored plugins), password via env for spawned
 * servers, version gate before use.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";

import { createOpencodeClient } from "@opencode-ai/sdk/v2";

import { CliError } from "../../errors.js";
import { killProcessTree } from "../../infra/process.js";
import {
  buildServerConfigContent,
  compareSemver,
  OPENCODE_DEFAULT_HOSTNAME,
  OPENCODE_SERVER_READY_PREFIX,
  OPENCODE_SERVER_START_TIMEOUT_MS,
  resolveSpawnedServerPassword,
  resolveVendoredPluginPaths,
  type OpencodeSettings,
} from "./config.js";

/** Single text part the driver sends. */
export interface OpencodeTextPart {
  readonly type: "text";
  readonly text: string;
}

/** An image, as OpenCode's `FilePartInput`: a data URL with its type and name. */
export interface OpencodeFilePart {
  readonly type: "file";
  readonly mime: string;
  readonly filename: string;
  readonly url: string;
}

export type OpencodePromptPart = OpencodeTextPart | OpencodeFilePart;

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

/** Structural events the driver demuxes (SDK `Event` union, defensively read). */
export type OpencodeSubscribedEvent = {
  readonly type: string;
  readonly properties: Record<string, unknown>;
};

export type OpencodeMcpConfig =
  | { readonly type: "local"; readonly command: readonly string[]; readonly environment?: Readonly<Record<string, string>> }
  | { readonly type: "remote"; readonly url: string; readonly headers?: Readonly<Record<string, string>> };

export interface OpencodeSessionSummary {
  readonly sessionID: string;
}

/** One model's token limits, as the server reports them (`Model.limit`). */
export interface OpencodeModelLimit {
  readonly context: number;
  readonly input?: number;
  readonly output: number;
}

/** What a context-window reading needs from the server, fetched once per connection. */
export interface OpencodeContextSettings {
  /** Keyed `provider/model`. */
  readonly limits: ReadonlyMap<string, OpencodeModelLimit>;
  /** `compaction.auto` (default on) and `compaction.reserved`, from the server's config. */
  readonly autoCompact: boolean;
  readonly reserved: number | null;
}

export interface OpencodeServerConnection {
  readonly url: string;
  readonly version: string;
  readonly external: boolean;
  createSession(input: { title: string }): Promise<OpencodeSessionSummary>;
  getSession(sessionID: string): Promise<{ id: string } | null>;
  /**
   * `mcp.add` for this connection's directory. OpenCode (re)spawns the
   * server on every call, so callers dedupe.
   */
  addMcpServer(name: string, config: OpencodeMcpConfig): Promise<void>;
  sessionMessages(sessionID: string): Promise<ReadonlyArray<{ info: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>>;
  contextSettings(): Promise<OpencodeContextSettings>;
  /** `command.list`: slash commands, skills (`source: "skill"`) and MCP prompts. */
  listCommands(): Promise<ReadonlyArray<{ name: string; description: string | null; source: string | null; hints: readonly string[] }>>;
  promptAsync(input: {
    sessionID: string;
    model?: { providerID: string; modelID: string };
    messageID?: string;
    /** Appended to the agent's system prompt for this prompt (`SessionPromptAsyncData.body.system`). */
    system?: string;
    /** A named agent (e.g. the built-in read-only `plan`). */
    agent?: string;
    parts: ReadonlyArray<OpencodePromptPart>;
  }): Promise<{ messageID: string }>;
  abortSession(sessionID: string): Promise<void>;
  forkSession(sessionID: string, messageID?: string): Promise<OpencodeSessionSummary>;
  summarizeSession(sessionID: string, model?: { providerID: string; modelID: string }): Promise<void>;
  replyToPermission(requestID: string, reply: "once" | "always" | "reject"): Promise<void>;
  replyToQuestion(requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): Promise<void>;
  rejectQuestion(requestID: string): Promise<void>;
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
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** Unwrap an SDK `RequestResult`: data on success, `CliError` on failure. */
function unwrap<T>(result: { data?: T; error?: unknown }, label: string): T {
  if (result.error !== undefined && result.error !== null) {
    throw new CliError("OPENCODE_REQUEST_FAILED", `OpenCode ${label} failed: ${errorDetail(result.error)}.`, {
      details: { label },
    });
  }
  if (result.data === undefined || result.data === null) {
    throw new CliError("OPENCODE_REQUEST_FAILED", `OpenCode ${label} returned no data.`, {
      details: { label },
    });
  }
  return result.data;
}

type SdkClient = ReturnType<typeof createOpencodeClient>;

class LiveOpencodeServerConnection implements OpencodeServerConnection {
  private disposed = false;

  constructor(
    readonly url: string,
    readonly version: string,
    readonly external: boolean,
    private readonly client: SdkClient,
    private readonly child: ChildProcess | null,
    private readonly hostname: string,
  ) {}

  async createSession(input: { title: string }): Promise<OpencodeSessionSummary> {
    const data = unwrap(await this.client.session.create({ title: input.title }), "session.create");
    const id = asRecord(data)?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new CliError("OPENCODE_REQUEST_FAILED", "OpenCode session.create did not return a session id.", {});
    }
    return { sessionID: id };
  }

  async getSession(sessionID: string): Promise<{ id: string } | null> {
    const result = await this.client.session.get({ sessionID });
    if (result.error !== undefined && result.error !== null) return null;
    const id = asRecord(result.data)?.id;
    return typeof id === "string" ? { id } : null;
  }

  async addMcpServer(name: string, config: OpencodeMcpConfig): Promise<void> {
    const body =
      config.type === "local"
        ? { type: "local" as const, command: [...config.command], ...(config.environment ? { environment: { ...config.environment } } : {}) }
        : { type: "remote" as const, url: config.url, ...(config.headers ? { headers: { ...config.headers } } : {}) };
    unwrap(await this.client.mcp.add({ name, config: body }), "mcp.add");
  }

  async sessionMessages(sessionID: string): Promise<ReadonlyArray<{ info: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>> {
    const data = unwrap(await this.client.session.messages({ sessionID }), "session.messages");
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      const record = asRecord(entry);
      const info = record ? asRecord(record.info) : null;
      const parts = record && Array.isArray(record.parts) ? record.parts : [];
      if (!info) return [];
      return [{
        info,
        parts: parts.flatMap((part) => {
          const parsed = asRecord(part);
          return parsed ? [parsed] : [];
        }),
      }];
    });
  }

  async listCommands(): Promise<ReadonlyArray<{ name: string; description: string | null; source: string | null; hints: readonly string[] }>> {
    const data = unwrap(await this.client.command.list(), "command.list");
    return (Array.isArray(data) ? data : []).flatMap((entry) => {
      const command = asRecord(entry);
      const name = typeof command?.name === "string" ? command.name : null;
      if (!command || !name) return [];
      return [{
        name,
        description: typeof command.description === "string" ? command.description : null,
        source: typeof command.source === "string" ? command.source : null,
        hints: Array.isArray(command.hints) ? command.hints.filter((hint): hint is string => typeof hint === "string") : [],
      }];
    });
  }

  async contextSettings(): Promise<OpencodeContextSettings> {
    const providers = asRecord(unwrap(await this.client.config.providers(), "config.providers"));
    const limits = new Map<string, OpencodeModelLimit>();
    for (const entry of Array.isArray(providers?.providers) ? providers.providers : []) {
      const provider = asRecord(entry);
      const providerId = typeof provider?.id === "string" ? provider.id : null;
      const models = asRecord(provider?.models);
      if (!providerId || !models) continue;
      for (const [modelId, raw] of Object.entries(models)) {
        const limit = asRecord(asRecord(raw)?.limit);
        const context = typeof limit?.context === "number" ? limit.context : 0;
        if (context <= 0) continue;
        limits.set(`${providerId}/${modelId}`, {
          context,
          output: typeof limit?.output === "number" ? limit.output : 0,
          ...(typeof limit?.input === "number" ? { input: limit.input } : {}),
        });
      }
    }
    // Config is advisory: a server that will not answer keeps upstream defaults.
    const config = await this.client.config.get().then((result) => asRecord(result.data)).catch(() => null);
    const compaction = asRecord(config?.compaction);
    return {
      limits,
      autoCompact: compaction?.auto !== false,
      reserved: typeof compaction?.reserved === "number" ? compaction.reserved : null,
    };
  }

  async promptAsync(input: {
    sessionID: string;
    model?: { providerID: string; modelID: string };
    messageID?: string;
    system?: string;
    agent?: string;
    parts: ReadonlyArray<OpencodePromptPart>;
  }): Promise<{ messageID: string }> {
    // promptAsync answers 204 with an empty body ("Prompt accepted") —
    // the message id is caller-assigned, passed in and echoed back.
    const messageID = input.messageID ?? newOpencodeMessageId();
    unwrap(
      await this.client.session.promptAsync({
        sessionID: input.sessionID,
        messageID,
        ...(input.model ? { model: input.model } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        parts: input.parts.map((part) =>
          part.type === "text"
            ? { type: "text" as const, text: part.text }
            : { type: "file" as const, mime: part.mime, filename: part.filename, url: part.url },
        ),
      }),
      "session.promptAsync",
    );
    return { messageID };
  }

  async abortSession(sessionID: string): Promise<void> {
    await this.client.session.abort({ sessionID }).catch(() => undefined);
  }

  async forkSession(sessionID: string, messageID?: string): Promise<OpencodeSessionSummary> {
    const data = unwrap(
      await this.client.session.fork({ sessionID, ...(messageID ? { messageID } : {}) }),
      "session.fork",
    );
    const id = asRecord(data)?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new CliError("OPENCODE_REQUEST_FAILED", "OpenCode session.fork did not return a session id.", {});
    }
    return { sessionID: id };
  }

  async summarizeSession(sessionID: string, model?: { providerID: string; modelID: string }): Promise<void> {
    unwrap(
      await this.client.session.summarize({ sessionID, ...(model ? { providerID: model.providerID, modelID: model.modelID } : {}) }),
      "session.summarize",
    );
  }

  async replyToPermission(requestID: string, reply: "once" | "always" | "reject"): Promise<void> {
    unwrap(await this.client.permission.reply({ requestID, reply }), "permission.reply");
  }

  async replyToQuestion(requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): Promise<void> {
    unwrap(await this.client.question.reply({ requestID, answers: [...answers.map((row) => [...row])] }), "question.reply");
  }

  async rejectQuestion(requestID: string): Promise<void> {
    unwrap(await this.client.question.reject({ requestID }), "question.reject");
  }

  async subscribeEvents(input: { signal: AbortSignal }): Promise<{ stream: AsyncIterable<OpencodeSubscribedEvent> }> {
    const subscription = await this.client.event.subscribe(undefined, { signal: input.signal });
    async function* events(): AsyncGenerator<OpencodeSubscribedEvent> {
      for await (const event of subscription.stream as AsyncIterable<unknown>) {
        const record = asRecord(event);
        if (!record || typeof record.type !== "string") continue;
        const properties = asRecord(record.properties) ?? {};
        yield { type: record.type, properties };
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

async function verifyServerVersion(
  client: SdkClient,
  minVersion: string,
  binaryPath: string,
): Promise<string> {
  let health: { data?: unknown; error?: unknown };
  try {
    health = await client.global.health();
  } catch (cause) {
    throw new CliError("OPENCODE_UNREACHABLE", `Could not reach the OpenCode server: ${errorDetail(cause)}.`, {
      details: { binaryPath },
    });
  }
  const data = asRecord(health.data);
  const version = asString(data?.version) ?? "";
  if (data?.healthy !== true || version.length === 0) {
    throw new CliError("OPENCODE_UNHEALTHY", "The OpenCode server did not report healthy.", {
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
  return { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` };
}

export class SpawnOpencodeTransport implements OpencodeTransport {
  async ensureServer(input: EnsureOpencodeServerInput): Promise<OpencodeServerConnection> {
    const { settings } = input;
    const baseEnv = input.env ?? process.env;
    if (settings.serverUrl.trim().length > 0) {
      const url = settings.serverUrl.trim();
      const client = createOpencodeClient({
        baseUrl: url,
        directory: input.workingDirectory,
        headers: basicAuthHeader(settings.serverPassword),
        throwOnError: true,
      });
      const version = await verifyServerVersion(client, settings.minVersion, settings.binaryPath);
      return new LiveOpencodeServerConnection(url, version, true, client, null, OPENCODE_DEFAULT_HOSTNAME);
    }

    const port = await findAvailablePort().catch((cause: unknown) => {
      throw new CliError("OPENCODE_SPAWN_FAILED", `Could not find a port for opencode serve: ${errorDetail(cause)}.`, {
        details: { binaryPath: settings.binaryPath },
      });
    });
    const password = resolveSpawnedServerPassword(settings, baseEnv);
    const childEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      OPENCODE_CONFIG_CONTENT: buildServerConfigContent(
        baseEnv.OPENCODE_CONFIG_CONTENT,
        resolveVendoredPluginPaths(),
      ),
      ...(password.length > 0 ? { OPENCODE_SERVER_PASSWORD: password } : {}),
    };
    const child = spawn(settings.binaryPath, ["serve", `--hostname=${OPENCODE_DEFAULT_HOSTNAME}`, `--port=${port}`], {
      env: childEnv,
      cwd: input.workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const url = await waitForServerReady(child, settings.binaryPath).catch(async (cause: unknown) => {
      killProcessTree(child, "SIGKILL");
      throw cause;
    });
    const client = createOpencodeClient({
      baseUrl: url,
      directory: input.workingDirectory,
      headers: basicAuthHeader(password),
      throwOnError: true,
    });
    const version = await verifyServerVersion(client, settings.minVersion, settings.binaryPath).catch(
      async (cause: unknown) => {
        await new LiveOpencodeServerConnection(url, versionFallback(), false, client, child, OPENCODE_DEFAULT_HOSTNAME)
          .dispose()
          .catch(() => undefined);
        throw cause;
      },
    );
    return new LiveOpencodeServerConnection(url, version, false, client, child, OPENCODE_DEFAULT_HOSTNAME);
  }
}

function versionFallback(): string {
  return "0.0.0";
}

function waitForServerReady(child: ChildProcess, binaryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new CliError("OPENCODE_SPAWN_FAILED", `Timed out waiting for opencode serve to listen: ${output.slice(-500)}.`, {
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
      const index = output.indexOf(OPENCODE_SERVER_READY_PREFIX);
      if (index < 0) return;
      const match = output.slice(index).match(/on\s+(https?:\/\/[^\s]+)/);
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
        new CliError("OPENCODE_SPAWN_FAILED", `opencode serve exited before listening (code ${code}): ${output.slice(-500)}.`, {
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
