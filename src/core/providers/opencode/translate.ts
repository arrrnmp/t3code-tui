/**
 * Anti-corruption layer between OpenCode v2's server API and the vocabulary
 * the rest of moxen already reads.
 *
 * v2 is an intentional break from v1 (`@opencode-ai/sdk`): the event envelope
 * is `data` (not `properties`), text arrives as true deltas (v1 sent
 * cumulative snapshots), tools are `session.tool.*` events (v1: one
 * `message.part.updated` per tool part), questions are forms, a turn ends on
 * `session.execution.*`, and history is a flat timeline with no `info` /
 * `parts`. Everything here is pure (no SDK, no I/O) so it is tested against
 * real samples captured from a live v2.0.19 server; `transport.ts` is the only
 * caller. The internal vocabulary is v1's, which `driver.ts`, `context.ts`,
 * `threads/toolactivity.ts` (`fromOpencode`) and the TUI already understand.
 */

/** An event in the internal (v1-shaped) vocabulary the driver demuxes. */
export type OpencodeSubscribedEvent = {
  readonly type: string;
  readonly properties: Record<string, unknown>;
};

/** One history entry in the internal `{info, parts}` shape. */
export type OpencodeMessage = {
  readonly info: Record<string, unknown>;
  readonly parts: ReadonlyArray<Record<string, unknown>>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Tool output as text: the text items of a v2 tool `content` array, joined. */
export function toolContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => {
      const record = asRecord(item);
      return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("");
}

// -- forms (questions) -------------------------------------------------------

/** What a reply needs to remember about one form field. */
export interface OpencodeFormField {
  readonly key: string;
  readonly type: string;
}

/**
 * A `question`-kind form as the internal `question.asked` payload. Field →
 * question: `title` is the header, `description` the question text, options
 * carry their label/description, `multiselect` is the multiple-choice flag and
 * `custom` allows a typed answer. Both the v1 names (`multiple`, `custom`) and
 * the ones the request panel reads (`multiSelect`, `allowCustomAnswer`) are set.
 */
export function formToQuestionEvent(form: Record<string, unknown>): {
  event: OpencodeSubscribedEvent;
  fields: OpencodeFormField[];
} | null {
  const id = asString(form.id);
  const sessionID = asString(form.sessionID);
  const metadata = asRecord(form.metadata);
  if (!id || !sessionID || metadata?.kind !== "question") return null;
  const rawFields = Array.isArray(form.fields) ? form.fields : [];
  const fields: OpencodeFormField[] = [];
  const questions: Array<Record<string, unknown>> = [];
  rawFields.forEach((entry, index) => {
    const field = asRecord(entry);
    if (!field) return;
    const key = asString(field.key) ?? `q${index}`;
    const type = asString(field.type) ?? "string";
    fields.push({ key, type });
    const options = (Array.isArray(field.options) ? field.options : []).flatMap((option) => {
      const record = asRecord(option);
      const label = asString(record?.label) ?? asString(record?.value);
      if (!record || !label) return [];
      const description = asString(record.description);
      return [{ label, ...(description ? { description } : {}), value: asString(record.value) ?? label }];
    });
    const multiple = type === "multiselect";
    // Options-less fields (free text, numbers) are always typed answers.
    const custom = options.length === 0 || field.custom === true;
    questions.push({
      header: asString(field.title) ?? key,
      question: asString(field.description) ?? asString(field.title) ?? key,
      options,
      multiple,
      multiSelect: multiple,
      custom,
      allowCustomAnswer: custom,
    });
  });
  return {
    event: { type: "question.asked", properties: { id, sessionID, questions } },
    fields,
  };
}

/**
 * The `answer` object a form reply takes, from per-question answers (one
 * `string[]` per question, in order): `{<field key>: value}`, an array for
 * `multiselect`, a string otherwise. Unanswered questions are omitted.
 */
export function answerForForm(
  fields: ReadonlyArray<OpencodeFormField>,
  answers: ReadonlyArray<ReadonlyArray<string>>,
): Record<string, string | number | boolean | string[]> {
  const answer: Record<string, string | number | boolean | string[]> = {};
  answers.forEach((values, index) => {
    if (values.length === 0) return;
    const field = fields[index] ?? { key: `q${index}`, type: "string" };
    if (field.type === "multiselect") answer[field.key] = [...values];
    else if (field.type === "number" || field.type === "integer") {
      const parsed = Number(values[0]);
      answer[field.key] = Number.isFinite(parsed) ? parsed : (values[0] ?? "");
    } else if (field.type === "boolean") answer[field.key] = values[0] === "true";
    else answer[field.key] = values[0] ?? "";
  });
  return answer;
}

// -- live events -------------------------------------------------------------

interface ToolState {
  readonly sessionID: string;
  readonly messageID: string | null;
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  input: Record<string, unknown>;
  output: string | undefined;
  error: string | undefined;
  metadata: Record<string, unknown>;
  start: number | undefined;
  end: number | undefined;
}

/** Events that carry no signal for the driver; dropped without a trace. */
const NOISE_EVENTS: ReadonlySet<string> = new Set([
  "server.connected",
  "project.updated",
  "provider.updated",
  "model.updated",
  "skill.updated",
  "agent.updated",
  "command.updated",
  "plugin.updated",
  "integration.updated",
  "reference.updated",
  "websearch.updated",
  "config.updated",
]);

/**
 * Stateful translator for one server's event stream. It remembers what the
 * cumulative-text and tool-lifecycle mappings need (accumulated text per part,
 * tool state per call), which forms are open, and — per session — which user
 * inbox items are still waiting to be delivered.
 */
export class OpencodeEventTranslator {
  private readonly texts = new Map<string, string>();
  private readonly tools = new Map<string, ToolState>();
  /** Open forms: form id → the fields a reply must key its answers by. */
  private readonly forms = new Map<string, { sessionID: string; fields: OpencodeFormField[] }>();
  /** Per session: user inbox items enqueued and not yet delivered. */
  private readonly pendingInbox = new Map<string, Set<string>>();

  /**
   * Forget in-flight stream state (partial text, running tools, undelivered
   * inbox items) when the stream is (re)subscribed: events between two
   * subscriptions are lost, so state built from them would be wrong. Open
   * forms stay: they are still open on the server.
   */
  resetLive(): void {
    this.texts.clear();
    this.tools.clear();
    this.pendingInbox.clear();
  }

  /** The fields of an open form, for building its reply. */
  formFields(formID: string): ReadonlyArray<OpencodeFormField> | null {
    return this.forms.get(formID)?.fields ?? null;
  }

  /** Translate one raw v2 event into zero or more internal events. */
  translate(raw: unknown): OpencodeSubscribedEvent[] {
    const event = asRecord(raw);
    const type = asString(event?.type);
    if (!event || !type || NOISE_EVENTS.has(type)) return [];
    const data = asRecord(event.data) ?? {};
    const created = asNumber(event.created);
    switch (type) {
      case "session.text.started":
        this.texts.set(this.textKey(data), this.texts.get(this.textKey(data)) ?? "");
        return [];
      case "session.text.delta": {
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (delta.length === 0) return [];
        const key = this.textKey(data);
        const text = (this.texts.get(key) ?? "") + delta;
        this.texts.set(key, text);
        return [this.textPart(data, key, text)];
      }
      case "session.text.ended": {
        const key = this.textKey(data);
        const final = typeof data.text === "string" ? data.text : (this.texts.get(key) ?? "");
        const previous = this.texts.get(key) ?? "";
        this.texts.delete(key);
        // The deltas already said it all: nothing to reconcile.
        if (final === previous || final.length === 0) return [];
        return [this.textPart(data, key, final)];
      }
      case "session.tool.input.started": {
        const call = this.tool(data, created);
        if (!call) return [];
        const name = asString(data.name);
        if (name) call.tool = name;
        call.status = "pending";
        return [this.toolPart(data, call)];
      }
      case "session.tool.called": {
        const call = this.tool(data, created);
        if (!call) return [];
        call.status = "running";
        call.input = asRecord(data.input) ?? call.input;
        return [this.toolPart(data, call)];
      }
      case "session.tool.progress": {
        const call = this.tool(data, created);
        if (!call) return [];
        call.status = call.status === "pending" ? "running" : call.status;
        call.metadata = { ...call.metadata, ...(asRecord(data.metadata) ?? {}) };
        return [this.toolPart(data, call)];
      }
      case "session.tool.success": {
        const call = this.tool(data, created);
        if (!call) return [];
        call.status = "completed";
        call.output = toolContentText(data.content);
        call.metadata = { ...call.metadata, ...(asRecord(data.metadata) ?? {}) };
        call.end = created ?? call.end;
        this.tools.delete(this.toolKey(data));
        return [this.toolPart(data, call)];
      }
      case "session.tool.failed": {
        const call = this.tool(data, created);
        if (!call) return [];
        call.status = "error";
        call.error = asString(asRecord(data.error)?.message) ?? "Tool failed.";
        call.end = created ?? call.end;
        this.tools.delete(this.toolKey(data));
        return [this.toolPart(data, call)];
      }
      case "permission.asked": {
        const id = asString(data.id);
        const sessionID = asString(data.sessionID);
        if (!id || !sessionID) return [];
        const resources = Array.isArray(data.resources) ? data.resources : [];
        return [{
          type: "permission.asked",
          properties: {
            ...data,
            id,
            sessionID,
            permission: asString(data.action) ?? "tool",
            patterns: resources,
            always: Array.isArray(data.save) ? data.save : [],
          },
        }];
      }
      case "permission.replied":
        return [{ type: "permission.replied", properties: data }];
      case "form.created": {
        const form = asRecord(data.form);
        const question = form ? formToQuestionEvent(form) : null;
        if (!form || !question) return [];
        this.forms.set(asString(form.id) ?? "", {
          sessionID: asString(form.sessionID) ?? "",
          fields: question.fields,
        });
        return [question.event];
      }
      case "form.replied":
      case "form.cancelled": {
        const id = asString(data.id);
        const known = id ? this.forms.get(id) : undefined;
        // Non-question forms were never announced, so are not settled either.
        if (!id || !known) return [];
        this.forms.delete(id);
        return [{
          type: type === "form.replied" ? "question.replied" : "question.rejected",
          properties: { sessionID: asString(data.sessionID) ?? known.sessionID, requestID: id },
        }];
      }
      case "session.inbox.enqueued": {
        const sessionID = asString(data.sessionID);
        const inboxID = asString(data.inboxID);
        // Only user input is a turn's business; synthetic reminders and
        // compaction ride along with the next execution.
        if (sessionID && inboxID && asRecord(data.item)?.type === "user") {
          const pending = this.pendingInbox.get(sessionID) ?? new Set<string>();
          pending.add(inboxID);
          this.pendingInbox.set(sessionID, pending);
        }
        return [];
      }
      case "session.inbox.delivered": {
        const sessionID = asString(data.sessionID);
        const inboxID = asString(data.inboxID);
        if (sessionID && inboxID) this.pendingInbox.get(sessionID)?.delete(inboxID);
        return [];
      }
      case "session.inbox.cancelled": {
        const sessionID = asString(data.sessionID);
        const inboxID = asString(data.inboxID);
        if (sessionID && inboxID) this.pendingInbox.get(sessionID)?.delete(inboxID);
        return [];
      }
      case "session.execution.succeeded": {
        const sessionID = asString(data.sessionID);
        if (!sessionID) return [];
        // One moxen turn can span several executions: a steer sent as the run
        // finished, or a question dismissed mid-run (its cancel interrupts the
        // execution, then the queued steer starts a new one). The turn is only
        // over once nothing is left waiting to be delivered.
        if (this.hasPendingInbox(sessionID)) return [];
        return [{ type: "session.idle", properties: { sessionID } }];
      }
      case "session.execution.interrupted": {
        const sessionID = asString(data.sessionID);
        if (!sessionID) return [];
        // Always reported, never held back: an interrupt the driver asked for
        // is acknowledged by this event whatever is still queued. `pendingInbox`
        // tells the driver whether the turn may go on (a steer still to run).
        return [{
          type: "session.interrupted",
          properties: {
            sessionID,
            reason: asString(data.reason) ?? "unknown",
            pendingInbox: this.hasPendingInbox(sessionID),
          },
        }];
      }
      case "session.execution.failed": {
        const sessionID = asString(data.sessionID);
        if (!sessionID) return [];
        return [{ type: "session.error", properties: { sessionID, error: errorOf(data.error) } }];
      }
      case "location.shutdown":
        // The server dropped the location our turns run in: no session to name.
        return [{ type: "session.error", properties: { error: { message: "The OpenCode server shut down.", name: "location.shutdown" } } }];
      default:
        return [];
    }
  }

  private hasPendingInbox(sessionID: string): boolean {
    return (this.pendingInbox.get(sessionID)?.size ?? 0) > 0;
  }

  private textKey(data: Record<string, unknown>): string {
    return `${asString(data.assistantMessageID) ?? ""}:${asNumber(data.ordinal) ?? 0}`;
  }

  private textPart(data: Record<string, unknown>, key: string, text: string): OpencodeSubscribedEvent {
    return {
      type: "message.part.updated",
      properties: {
        sessionID: asString(data.sessionID) ?? "",
        part: { id: `text:${key}`, messageID: asString(data.assistantMessageID) ?? "", type: "text", text },
      },
    };
  }

  private toolKey(data: Record<string, unknown>): string {
    return asString(data.id) ?? "";
  }

  /** The tracked state of the call named by `data.id`, created on first sight. */
  private tool(data: Record<string, unknown>, created: number | undefined): ToolState | null {
    const key = this.toolKey(data);
    const sessionID = asString(data.sessionID);
    if (!key || !sessionID) return null;
    let call = this.tools.get(key);
    if (!call) {
      call = {
        sessionID,
        messageID: asString(data.assistantMessageID),
        tool: "tool",
        status: "pending",
        input: {},
        output: undefined,
        error: undefined,
        metadata: {},
        start: created,
        end: undefined,
      };
      this.tools.set(key, call);
    }
    return call;
  }

  private toolPart(data: Record<string, unknown>, call: ToolState): OpencodeSubscribedEvent {
    return {
      type: "message.part.updated",
      properties: {
        sessionID: call.sessionID,
        part: {
          id: this.toolKey(data),
          callID: this.toolKey(data),
          messageID: call.messageID ?? "",
          type: "tool",
          tool: call.tool,
          state: toolState(call),
        },
      },
    };
  }
}

function toolState(call: ToolState): Record<string, unknown> {
  return {
    status: call.status,
    input: call.input,
    ...(call.output !== undefined ? { output: call.output } : {}),
    ...(call.error !== undefined ? { error: call.error } : {}),
    metadata: call.metadata,
    time: { ...(call.start !== undefined ? { start: call.start } : {}), ...(call.end !== undefined ? { end: call.end } : {}) },
  };
}

/** v2's `{type, message, status?}` as the internal `error` (`name` = the type). */
function errorOf(raw: unknown): Record<string, unknown> {
  const error = asRecord(raw);
  return {
    message: asString(error?.message) ?? "OpenCode turn failed.",
    ...(asString(error?.type) ? { name: asString(error?.type) } : {}),
    ...(asNumber(error?.status) !== undefined ? { status: asNumber(error?.status) } : {}),
  };
}

// -- history ------------------------------------------------------------------

/** A tool as the internal tool part, from a v2 assistant `content` entry. */
function historyToolPart(content: Record<string, unknown>, messageID: string): Record<string, unknown> {
  const state = asRecord(content.state) ?? {};
  const time = asRecord(content.time) ?? {};
  const raw = asString(state.status);
  const status = raw === "completed" ? "completed" : raw === "error" ? "error" : raw === "running" ? "running" : "pending";
  const input = asRecord(state.input) ?? {};
  const output = toolContentText(state.content);
  const error = asString(asRecord(state.error)?.message);
  const start = asNumber(time.ran) ?? asNumber(time.created);
  const end = asNumber(time.completed);
  const id = asString(content.id) ?? "";
  return {
    id,
    callID: id,
    messageID,
    type: "tool",
    tool: asString(content.name) ?? "tool",
    state: {
      status,
      input,
      ...(output ? { output } : {}),
      ...(error ? { error } : {}),
      metadata: asRecord(state.metadata) ?? {},
      time: { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) },
    },
  };
}

/**
 * The flat v2 timeline as internal `{info, parts}` messages, oldest first.
 *
 * - `user` → `{info:{id, role:"user"}, parts:[text, file…]}` (file bytes are
 *   dropped: history readers only need to know an attachment existed).
 * - `assistant` → `{info:{id, role:"assistant", providerID, modelID, tokens,
 *   time, parentID}, parts}`, `parentID` being the user message it answers.
 * - An `idle` item ends the run: assistant messages of that run still missing
 *   `time.completed` get the idle's timestamp, and the user message is marked
 *   `settled` — so "the last user message has a finished reply" stays
 *   answerable even for a run that produced no assistant message (a failure).
 * - Everything else (`synthetic`, `system`, `skill`, `shell`, `compaction`,
 *   `*-switched`) is not conversation and is dropped.
 */
export function translateTimeline(items: ReadonlyArray<unknown>): OpencodeMessage[] {
  const out: Array<{ info: Record<string, unknown>; parts: Array<Record<string, unknown>> }> = [];
  let lastUser: (typeof out)[number] | null = null;
  let run: Array<(typeof out)[number]> = [];
  for (const raw of items) {
    const item = asRecord(raw);
    const type = asString(item?.type);
    const id = asString(item?.id);
    if (!item || !type || !id) continue;
    const time = asRecord(item.time) ?? {};
    if (type === "user") {
      const parts: Array<Record<string, unknown>> = [{ id: `${id}:text`, messageID: id, type: "text", text: typeof item.text === "string" ? item.text : "" }];
      (Array.isArray(item.files) ? item.files : []).forEach((file, index) => {
        const record = asRecord(file);
        if (!record) return;
        parts.push({
          id: `${id}:file:${index}`,
          messageID: id,
          type: "file",
          mime: asString(record.mime) ?? "application/octet-stream",
          filename: asString(record.name) ?? "attachment",
        });
      });
      const message = { info: { id, role: "user", time: { ...time } } as Record<string, unknown>, parts };
      out.push(message);
      lastUser = message;
      run = [];
    } else if (type === "assistant") {
      const model = asRecord(item.model) ?? {};
      const info: Record<string, unknown> = {
        id,
        role: "assistant",
        ...(asString(model.providerID) ? { providerID: asString(model.providerID) } : {}),
        ...(asString(model.id) ? { modelID: asString(model.id) } : {}),
        ...(asRecord(item.tokens) ? { tokens: item.tokens } : {}),
        ...(asString(item.agent) ? { agent: asString(item.agent) } : {}),
        ...(asString(item.finish) ? { finish: item.finish } : {}),
        ...(asRecord(item.error) ? { error: item.error } : {}),
        time: { ...time },
        ...(lastUser ? { parentID: lastUser.info.id } : {}),
      };
      const parts: Array<Record<string, unknown>> = [];
      (Array.isArray(item.content) ? item.content : []).forEach((entry, index) => {
        const content = asRecord(entry);
        const kind = asString(content?.type);
        if (!content || !kind) return;
        if (kind === "text" || kind === "reasoning") {
          parts.push({ id: `${id}:${index}`, messageID: id, type: kind, text: typeof content.text === "string" ? content.text : "" });
        } else if (kind === "tool") {
          parts.push(historyToolPart(content, id));
        }
      });
      const message = { info, parts };
      out.push(message);
      run.push(message);
    } else if (type === "idle") {
      const settledAt = asNumber(time.created) ?? 0;
      for (const message of run) {
        const messageTime = message.info.time as Record<string, unknown>;
        if (messageTime.completed === undefined) messageTime.completed = settledAt;
      }
      if (lastUser) lastUser.info.settled = true;
      run = [];
    }
  }
  return out;
}
