/**
 * Push-driven OpenCode doubles: the fake server answers session calls from
 * a script and lets tests push SSE events on demand, so turn lifecycles
 * are deterministic (no real binaries, ports, or network).
 */
import type {
  EnsureOpencodeServerInput,
  OpencodeServerConnection,
  OpencodeSubscribedEvent,
  OpencodeTextPart,
  OpencodeTransport,
} from "../transport.js";

export interface FakeOpencodeScript {
  readonly version?: string;
  readonly sessionID?: string;
  readonly messages?: ReadonlyArray<{ info: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>;
  readonly failMethods?: Record<string, string>;
}

export class FakeOpencodeServerConnection implements OpencodeServerConnection {
  readonly url = "http://127.0.0.1:4096";
  readonly version: string;
  readonly external = false;
  readonly calls: Array<{ method: string; args: unknown }> = [];
  readonly subscribers: Array<(event: OpencodeSubscribedEvent) => void> = [];
  readonly aborted: string[] = [];
  disposed = false;

  constructor(private readonly script: FakeOpencodeScript = {}) {
    this.version = script.version ?? "1.18.30";
  }

  /** Push one SSE event to every subscriber (resolves when delivered). */
  async push(event: OpencodeSubscribedEvent): Promise<void> {
    for (const subscriber of [...this.subscribers]) subscriber(event);
    await Promise.resolve();
  }

  private failChecked(method: string): void {
    const failure = this.script.failMethods?.[method];
    if (failure) throw new Error(failure);
  }

  async createSession(input: { title: string }): Promise<{ sessionID: string }> {
    this.failChecked("session.create");
    this.calls.push({ method: "session.create", args: input });
    return { sessionID: this.script.sessionID ?? "opencode-session-1" };
  }

  async getSession(sessionID: string): Promise<{ id: string } | null> {
    this.calls.push({ method: "session.get", args: { sessionID } });
    return { id: sessionID };
  }

  async sessionMessages(sessionID: string): Promise<ReadonlyArray<{ info: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>> {
    this.calls.push({ method: "session.messages", args: { sessionID } });
    return this.script.messages ?? [];
  }

  async promptAsync(input: {
    sessionID: string;
    model?: { providerID: string; modelID: string };
    messageID?: string;
    parts: ReadonlyArray<OpencodeTextPart>;
  }): Promise<{ messageID: string }> {
    this.failChecked("session.promptAsync");
    this.calls.push({ method: "session.promptAsync", args: input });
    // Like the real 204 endpoint, the id is caller-assigned.
    return { messageID: input.messageID ?? "opencode-message-1" };
  }

  async abortSession(sessionID: string): Promise<void> {
    this.calls.push({ method: "session.abort", args: { sessionID } });
    this.aborted.push(sessionID);
  }

  async forkSession(sessionID: string, messageID?: string): Promise<{ sessionID: string }> {
    this.failChecked("session.fork");
    this.calls.push({ method: "session.fork", args: { sessionID, messageID } });
    return { sessionID: "opencode-session-fork" };
  }

  async summarizeSession(sessionID: string): Promise<void> {
    this.failChecked("session.summarize");
    this.calls.push({ method: "session.summarize", args: { sessionID } });
  }

  async replyToPermission(requestID: string, reply: "once" | "always" | "reject"): Promise<void> {
    this.calls.push({ method: "permission.reply", args: { requestID, reply } });
  }

  async replyToQuestion(requestID: string, answers: ReadonlyArray<ReadonlyArray<string>>): Promise<void> {
    this.calls.push({ method: "question.reply", args: { requestID, answers } });
  }

  async rejectQuestion(requestID: string): Promise<void> {
    this.calls.push({ method: "question.reject", args: { requestID } });
  }

  async subscribeEvents(input: { signal: AbortSignal }): Promise<{ stream: AsyncIterable<OpencodeSubscribedEvent> }> {
    this.calls.push({ method: "event.subscribe", args: {} });
    const subscribers = this.subscribers;
    const signal = input.signal;
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
                if (next) return { done: false, value: next };
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
