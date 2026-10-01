/**
 * Push-driven OpenCode doubles: the fake server answers session calls from
 * a script and lets tests push SSE events on demand, so turn lifecycles
 * are deterministic (no real binaries, ports, or network).
 */
import type {
  EnsureOpencodeServerInput,
  OpencodeContextSettings,
  OpencodeFilePart,
  OpencodeMessage,
  OpencodeModelInfo,
  OpencodeModelLimit,
  OpencodeModelRef,
  OpencodeServerConnection,
  OpencodeSessionState,
  OpencodeSubscribedEvent,
  OpencodeTransport,
} from "../transport.js";
import { answerForForm, OpencodeEventTranslator } from "../translate.js";

export interface FakeOpencodeScript {
  readonly version?: string;
  readonly sessionID?: string;
  readonly messages?: ReadonlyArray<OpencodeMessage>;
  /** What `getSession` reports for a session that exists (agent/model it is already on). */
  readonly sessionState?: { readonly agent?: string; readonly model?: OpencodeModelRef };
  /** `model.list`. Unset: the list is unreadable, so the driver skips its model check. */
  readonly models?: ReadonlyArray<OpencodeModelInfo>;
  readonly failMethods?: Record<string, string>;
  /** Session ids `getSession` reports as gone (pruned, another machine). */
  readonly lostSessions?: readonly string[];
  /** Child session id → the session that started it (a `subagent` child's `parentID`). */
  readonly parents?: Record<string, string>;
  readonly commands?: ReadonlyArray<{ name: string; description: string | null; source: string | null; hints: readonly string[] }>;
  /** `model.list` limits, keyed `provider/model`. */
  readonly limits?: Record<string, OpencodeModelLimit>;
  readonly autoCompact?: boolean;
  /**
   * `false`: the server never confirms an interrupt (the driver's own timeout settles the turn).
   * `"immediately"`: the confirming event is delivered before the abort call returns.
   */
  readonly confirmInterrupts?: boolean | "immediately";
  /** Credential types `storedAuthTypes` reports (`integration.list`); unset: none. */
  readonly authTypes?: Record<string, string>;
  /** Inbox ids `cancelInbox` refuses (already delivered); `"*"` refuses every id. */
  readonly undeliverableInbox?: readonly string[];
  /** `compaction.buffer` from the server's config. */
  readonly buffer?: number | null;
}

export class FakeOpencodeServerConnection implements OpencodeServerConnection {
  readonly url = "http://127.0.0.1:4096";
  readonly version: string;
  readonly external = false;
  readonly calls: Array<{ method: string; args: unknown }> = [];
  readonly subscribers: Array<(event: OpencodeSubscribedEvent) => void> = [];
  readonly aborted: string[] = [];
  disposed = false;
  /** Resolves when `kill()` is called: a spawned server's process exiting. */
  readonly closed: Promise<void>;
  private markClosed: () => void = () => undefined;
  /** Replaces the scripted `session.messages` answer mid-test. */
  messages: FakeOpencodeScript["messages"] | null = null;
  /** Fork counter, so each fork gets its own id. */
  private forks = 0;
  /** The real v2 → internal translation, for `pushRaw`. */
  readonly translator = new OpencodeEventTranslator();
  /** Set by `endStream`: every open subscription finishes, as a dropped SSE connection does. */
  private streamEnded = false;

  constructor(private readonly script: FakeOpencodeScript = {}) {
    this.version = script.version ?? "2.0.19";
    this.closed = new Promise<void>((resolve) => {
      this.markClosed = resolve;
    });
  }

  /** The server process dies (the driver learns through `closed`). */
  kill(): void {
    this.markClosed();
  }

  /** Push one SSE event to every subscriber (resolves when delivered). */
  async push(event: OpencodeSubscribedEvent): Promise<void> {
    for (const subscriber of [...this.subscribers]) subscriber(event);
    await Promise.resolve();
  }

  /** Push a raw v2 event through the real translator, exactly as the live transport does. */
  async pushRaw(event: Record<string, unknown>): Promise<void> {
    for (const translated of this.translator.translate(event)) await this.push(translated);
  }

  /** End the event stream without the driver asking (a dropped connection). */
  endStream(): void {
    this.streamEnded = true;
    for (const subscriber of [...this.subscribers]) subscriber({ type: "stream.ended", properties: {} });
    this.subscribers.length = 0;
  }

  private failChecked(method: string): void {
    const failure = this.script.failMethods?.[method];
    if (failure) throw new Error(failure);
  }

  /** The title the fake server holds, and what a regeneration will give it. */
  title: string | null = null;
  regeneratedTitle = "Regenerated title";

  async sessionTitle(sessionID: string): Promise<string | null> {
    this.calls.push({ method: "session.title", args: { sessionID } });
    return this.title;
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    this.calls.push({ method: "session.update", args: { sessionID, title } });
    this.title = title;
  }

  async regenerateSessionTitle(sessionID: string): Promise<string | null> {
    this.calls.push({ method: "session.regenerateTitle", args: { sessionID } });
    this.title = this.regeneratedTitle;
    return this.title;
  }

  async createSession(input: { title?: string }): Promise<OpencodeSessionState> {
    this.failChecked("session.create");
    this.calls.push({ method: "session.create", args: input });
    return { sessionID: this.script.sessionID ?? "opencode-session-1" };
  }

  async getSession(sessionID: string): Promise<OpencodeSessionState | null> {
    this.calls.push({ method: "session.get", args: { sessionID } });
    if (this.script.lostSessions?.includes(sessionID)) return null;
    const parentID = this.script.parents?.[sessionID];
    return { sessionID, ...(parentID ? { parentID } : {}), ...this.script.sessionState };
  }

  async addMcpServer(name: string, config: unknown): Promise<void> {
    // Recorded before failing, so a test can count retries.
    this.calls.push({ method: "mcp.add", args: { name, config } });
    this.failChecked("mcp.add");
  }

  async sessionMessages(sessionID: string, options?: { tail?: number }): Promise<ReadonlyArray<OpencodeMessage>> {
    this.calls.push({ method: "session.messages", args: { sessionID, ...options } });
    return this.messages ?? this.script.messages ?? [];
  }

  async sessionContext(sessionID: string): Promise<ReadonlyArray<OpencodeMessage>> {
    this.calls.push({ method: "session.context", args: { sessionID } });
    return this.messages ?? this.script.messages ?? [];
  }

  async storedAuthTypes(): Promise<Record<string, string>> {
    this.calls.push({ method: "integration.list", args: {} });
    this.failChecked("integration.list");
    return { ...this.script.authTypes };
  }

  async cancelInbox(sessionID: string, inboxID: string): Promise<void> {
    this.calls.push({ method: "session.inbox.cancel", args: { sessionID, inboxID } });
    if (this.script.undeliverableInbox?.includes("*") || this.script.undeliverableInbox?.includes(inboxID)) throw new Error("not queued");
    this.translator.translate({ type: "session.inbox.cancelled", data: { sessionID, inboxID } });
  }

  async listCommands(): Promise<ReadonlyArray<{ name: string; description: string | null; source: string | null; hints: readonly string[] }>> {
    this.calls.push({ method: "command.list", args: {} });
    return this.script.commands ?? [];
  }

  async listModels(): Promise<ReadonlyArray<OpencodeModelInfo>> {
    this.calls.push({ method: "model.list", args: {} });
    if (!this.script.models) throw new Error("model.list unavailable");
    return this.script.models;
  }

  async contextSettings(): Promise<OpencodeContextSettings> {
    this.calls.push({ method: "model.list+config.get", args: {} });
    this.failChecked("config.providers");
    return {
      limits: new Map(Object.entries(this.script.limits ?? {})),
      autoCompact: this.script.autoCompact ?? true,
      buffer: this.script.buffer ?? null,
    };
  }

  async prompt(input: {
    sessionID: string;
    messageID?: string;
    text: string;
    files?: ReadonlyArray<OpencodeFilePart>;
  }): Promise<{ messageID: string }> {
    this.failChecked("session.prompt");
    this.calls.push({ method: "session.prompt", args: input });
    // Like the real endpoint, the id is caller-assigned.
    return { messageID: input.messageID ?? "opencode-message-1" };
  }

  async switchModel(sessionID: string, model: OpencodeModelRef): Promise<void> {
    this.failChecked("session.switchModel");
    this.calls.push({ method: "session.switchModel", args: { sessionID, model } });
  }

  async switchAgent(sessionID: string, agent: string): Promise<void> {
    this.calls.push({ method: "session.switchAgent", args: { sessionID, agent } });
  }

  async setInstructions(sessionID: string, key: string, value: string | null): Promise<void> {
    this.calls.push({ method: "session.instructions", args: { sessionID, key, value } });
    this.failChecked("session.instructions");
  }

  async abortSession(sessionID: string): Promise<void> {
    this.calls.push({ method: "session.abort", args: { sessionID } });
    this.aborted.push(sessionID);
    // The server confirms an interrupt with `session.execution.interrupted`, which
    // the translator reports as `session.interrupted` a moment after the call returns.
    // Through the real translator, so a still-queued inbox item shows as `pendingInbox`.
    const [confirmed] = this.translator.translate({
      type: "session.execution.interrupted",
      data: { sessionID, reason: "user" },
    }) as [OpencodeSubscribedEvent];
    if (this.script.confirmInterrupts === "immediately") await this.push(confirmed);
    else if (this.script.confirmInterrupts !== false) setTimeout(() => void this.push(confirmed), 5);
  }

  async forkSession(sessionID: string, messageID?: string): Promise<OpencodeSessionState> {
    this.failChecked("session.fork");
    this.calls.push({ method: "session.fork", args: { sessionID, messageID } });
    this.forks += 1;
    return { sessionID: this.forks === 1 ? "opencode-session-fork" : `opencode-session-fork-${this.forks}` };
  }

  async summarizeSession(sessionID: string): Promise<void> {
    this.failChecked("session.summarize");
    this.calls.push({ method: "session.compact", args: { sessionID } });
  }

  async replyToPermission(sessionID: string, requestID: string, reply: "once" | "always" | "reject"): Promise<void> {
    this.calls.push({ method: "permission.reply", args: { sessionID, requestID, reply } });
  }

  async replyToQuestion(sessionID: string, requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): Promise<void> {
    const answer = answerForForm(this.translator.formFields(requestID) ?? [], answers);
    this.calls.push({ method: "session.form.reply", args: { sessionID, requestID, answers, answer } });
  }

  async rejectQuestion(sessionID: string, requestID: string): Promise<void> {
    this.calls.push({ method: "session.form.cancel", args: { sessionID, requestID } });
  }

  async subscribeEvents(input: { signal: AbortSignal }): Promise<{ stream: AsyncIterable<OpencodeSubscribedEvent> }> {
    this.calls.push({ method: "event.subscribe", args: {} });
    this.streamEnded = false;
    const subscribers = this.subscribers;
    const signal = input.signal;
    const ended = (): boolean => this.streamEnded;
    return {
      stream: {
        [Symbol.asyncIterator](): AsyncIterator<OpencodeSubscribedEvent> {
          const pending: OpencodeSubscribedEvent[] = [];
          let resolveNext: (() => void) | null = null;
          const subscriber = (event: OpencodeSubscribedEvent): void => {
            pending.push(event);
            resolveNext?.();
            resolveNext = null;
          };
          subscribers.push(subscriber);
          return {
            async next(): Promise<IteratorResult<OpencodeSubscribedEvent>> {
              for (;;) {
                if (signal.aborted) return { done: true, value: undefined };
                const next = pending.shift();
                if (next?.type === "stream.ended") return { done: true, value: undefined };
                if (next) return { done: false, value: next };
                if (ended()) return { done: true, value: undefined };
                await new Promise<void>((resolve) => {
                  resolveNext = resolve;
                  if (signal.aborted) resolve();
                });
              }
            },
          };
        },
      },
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  callsTo(method: string): Array<{ method: string; args: unknown }> {
    return this.calls.filter((call) => call.method === method);
  }
}

export class FakeOpencodeTransport implements OpencodeTransport {
  readonly servers: FakeOpencodeServerConnection[] = [];
  readonly ensureCalls: EnsureOpencodeServerInput[] = [];

  constructor(private readonly script: FakeOpencodeScript = {}) {}

  async ensureServer(input: EnsureOpencodeServerInput): Promise<OpencodeServerConnection> {
    this.ensureCalls.push(input);
    const failure = this.script.failMethods?.["ensureServer"];
    if (failure) throw new Error(failure);
    const server = new FakeOpencodeServerConnection(this.script);
    this.servers.push(server);
    return server;
  }
}
