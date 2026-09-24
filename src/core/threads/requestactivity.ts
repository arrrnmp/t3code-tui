/**
 * Parked user-input requests → activity ledger rows.
 *
 * The TUI's answer panel reads open questions from `user-input.requested`
 * activities (`tui/model/thread.ts` `decodeUserInputRequest`) and closes
 * them on `user-input.resolved`. Those rows used to be written by the old
 * server path; deleting it removed the writer and left the reader, so a parked
 * `AskUserQuestion` rendered as *nothing at all* — the sibling question
 * *tool* row that does carry the questions is deliberately filtered out of
 * the transcript as noise (`isQuestionToolActivity`) on the grounds that
 * this row would carry them instead. The turn then blocked inside
 * `canUseTool` with no surface to answer it and no way back out.
 *
 * Each provider parks a different native shape, so questions are
 * normalized here the way `toolactivity.ts` normalizes tool calls. Never
 * throws: an unreadable shape must cost a row, not the turn.
 *
 * `id` is the question's own text, because that is the key the provider
 * wants its answers under — deriving it means a round trip through the
 * panel cannot mis-key an answer.
 */
import type { ProviderRuntimeEvent } from "../providers/spi.js";

/** A `user-input.request.*` event — the only kind this module maps. */
export type UserInputRuntimeEvent = Extract<
  ProviderRuntimeEvent,
  { readonly type: "user-input.request.opened" | "user-input.request.resolved" }
>;

export interface RequestActivityRow {
  /** Dedupe key: a provider may republish the same parked request. */
  readonly key: string;
  readonly kind: string;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The questions array, wherever this provider parked it: Claude sends
 * `{ toolName, input }`, Codex and Grok `{ method, params }`, OpenCode the
 * event properties verbatim.
 */
function questionsFrom(raw: Record<string, unknown>): readonly unknown[] | null {
  const candidates = [
    raw.questions,
    asRecord(raw.input)?.questions,
    asRecord(raw.params)?.questions,
    asRecord(raw.properties)?.questions,
    asRecord(asRecord(raw.params)?.input)?.questions,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return null;
}

/**
 * `value` is omitted rather than defaulted to the label: the panel already
 * falls back to the label, and writing it twice would make a future
 * value-carrying provider indistinguishable from this fallback.
 */
function normalizeOptions(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const options: Array<Record<string, unknown>> = [];
  for (const entry of raw) {
    const option = asRecord(entry);
    const label = option === null ? null : asString(option.label) ?? asString(option.name);
    if (label === null) continue;
    const description = option === null ? null : asString(option.description);
    const value = option === null ? null : asString(option.value);
    options.push({
      label,
      ...(description === null ? {} : { description }),
      ...(value === null ? {} : { value }),
    });
  }
  return options;
}

function normalizeQuestions(raw: readonly unknown[]): Array<Record<string, unknown>> {
  const questions: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    if (record === null) return;
    const question = asString(record.question) ?? asString(record.prompt) ?? asString(record.text);
    if (question === null) return;
    // Duplicate question text would collide on the answers key; the panel
    // keys drafts by id too, so a collision would answer both at once.
    const id = seen.has(question) ? `${question} (${index + 1})` : question;
    seen.add(question);
    questions.push({
      id,
      question,
      header: asString(record.header) ?? asString(record.title) ?? "Question",
      multiSelect: record.multiSelect === true,
      allowCustomAnswer: record.allowCustomAnswer !== false,
      options: normalizeOptions(record.options ?? record.choices),
    });
  });
  return questions;
}

/**
 * Returns null when the event names no question we can render — an
 * unrecognized `raw` shape, or a request whose questions never arrived.
 * A request we cannot render must not produce a half-row the panel would
 * then refuse to decode, leaving the turn parked with a silent row.
 */
export function userInputActivityRow(event: UserInputRuntimeEvent): RequestActivityRow | null {
  if (event.type === "user-input.request.resolved") {
    return {
      key: `${event.requestId}:resolved`,
      kind: "user-input.resolved",
      summary: "Question answered",
      payload: { requestId: event.requestId, provider: event.provider },
    };
  }
  const raw = asRecord(event.raw);
  const rawQuestions = raw === null ? null : questionsFrom(raw);
  if (rawQuestions === null) return null;
  const questions = normalizeQuestions(rawQuestions);
  if (questions.length === 0) return null;
  const first = asString(questions[0]?.question);
  return {
    key: `${event.requestId}:requested`,
    kind: "user-input.requested",
    summary: first ?? `Asked ${questions.length} question${questions.length === 1 ? "" : "s"}`,
    payload: { requestId: event.requestId, provider: event.provider, questions },
  };
}
