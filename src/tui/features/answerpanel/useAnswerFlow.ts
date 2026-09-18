import { useEffect, useMemo, useRef, useState } from "react";

import { dispatchErrorMessage } from "../../../errors.js";
import { pendingUserInputRequests, type PendingUserInputQuestion, type ThreadState } from "../../model/thread.js";
import type { useToasts } from "../../hooks/useToasts.js";
import { COPY_TOAST_MS } from "../../app/constants.js";
import type { TuiClient } from "../../app/app.js";

/**
 * Draft answers for the open agent question, keyed by question id: picked
 * option values plus free text (which wins when present, mirroring the
 * desktop resolver). `index` walks multi-question requests in order.
 */
export interface AnswerDraft {
  requestId: string;
  index: number;
  selected: Record<string, string[]>;
  custom: Record<string, string>;
}

export function useAnswerFlow(
  client: TuiClient,
  threadState: ThreadState,
  threadStateRef: { current: ThreadState },
  openThreadId: string | null,
  picker: unknown,
  toasts: ReturnType<typeof useToasts>,
  setError: (message: string) => void,
) {
  const [answerDraft, setAnswerDraft] = useState<AnswerDraft | null>(null);
  /** Request ids already shown or settled — auto-open fires once each. */
  const seenAnswerRequestsRef = useRef<Set<string>>(new Set());
  /** Agent questions awaiting answers, oldest first. */
  const pendingAnswerRequests = useMemo(() => pendingUserInputRequests(threadState), [threadState]);
  /** Request ids submitted or dismissed locally: hidden optimistically
      until the server's resolved event confirms (errors unhide). */
  const [settledAnswerRequestIds, setSettledAnswerRequestIds] = useState<string[]>([]);
  /** The request currently answered inline (null once settled or resolved elsewhere). */
  const activeAnswerRequest =
    answerDraft === null
      ? null
      : (pendingAnswerRequests.find(
          (candidate) =>
            candidate.requestId === answerDraft.requestId && !settledAnswerRequestIds.includes(candidate.requestId),
        ) ?? null);
  const activeAnswerQuestion = activeAnswerRequest?.questions[answerDraft?.index ?? -1] ?? null;
  /** The inline answer panel replaces the composer while a request is live. */
  const answerVisible = activeAnswerRequest !== null && activeAnswerQuestion !== null;

  /**
   * Opens the answer state for a fresh pending request (once each — the
   * seen set survives resyncs). Focus is deliberately untouched: the inline
   * panel replaces the composer in place, and submit/dismiss return to
   * exactly where the user was.
   */
  useEffect(() => {
    if (openThreadId === null || picker !== null) return;
    const fresh = pendingAnswerRequests.find((request) => !seenAnswerRequestsRef.current.has(request.requestId));
    if (fresh === undefined) return;
    seenAnswerRequestsRef.current.add(fresh.requestId);
    setAnswerDraft({ requestId: fresh.requestId, index: 0, selected: {}, custom: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAnswerRequests, picker, openThreadId]);

  /**
   * Resolves one question the way the desktop does (sans attachments):
   * free text wins when present, otherwise the picked option values
   * validated against the question (multi-select needs at least one).
   */
  const resolveAnswerQuestion = (
    question: PendingUserInputQuestion,
    draft: { selected: Record<string, string[]>; custom: Record<string, string> },
  ): string | string[] | null => {
    const custom = draft.custom[question.id]?.trim() ?? "";
    if (question.allowCustomAnswer !== false && custom.length > 0) return custom;
    const valid = new Set(question.options.map((option) => option.value ?? option.label));
    const picked = (draft.selected[question.id] ?? []).filter((value) => valid.has(value));
    if (question.multiSelect) return picked.length > 0 ? picked : null;
    return picked[0] ?? null;
  };

  /**
   * Records one question's answer, then advances to the next question or
   * dispatches the whole record. Every question resolves through the same
   * function, so a stored answer can never disagree with what dispatch sends.
   */
  const answerCurrentQuestion = (questionId: string, update: { selected?: string[]; custom?: string }) => {
    if (answerDraft === null) return;
    const draft: AnswerDraft = {
      ...answerDraft,
      selected: update.selected === undefined ? answerDraft.selected : { ...answerDraft.selected, [questionId]: update.selected },
      custom: update.custom === undefined ? answerDraft.custom : { ...answerDraft.custom, [questionId]: update.custom },
    };
    const request = pendingAnswerRequests.find((candidate) => candidate.requestId === draft.requestId);
    if (request === undefined) {
      return;
    }
    if (draft.index + 1 < request.questions.length) {
      setAnswerDraft({ ...draft, index: draft.index + 1 });
      return;
    }
    const answers: Record<string, string | string[]> = {};
    for (const question of request.questions) {
      const resolved = resolveAnswerQuestion(question, draft);
      if (resolved === null) {
        setError("answer every question before submitting");
        return;
      }
      answers[question.id] = resolved;
    }
    const id = openThreadId;
    if (id === null) {
      return;
    }
    void client
      .dispatch({
        type: "thread.user-input.respond",
        commandId: crypto.randomUUID(),
        threadId: id,
        requestId: draft.requestId,
        answers,
        createdAt: new Date().toISOString(),
      })
      .then(() => {
        toasts.push("answer-submitted", "info", "Answer submitted", COPY_TOAST_MS);
        setSettledAnswerRequestIds((settled) =>
          settled.includes(draft.requestId) ? settled : [...settled, draft.requestId],
        );
      })
      .catch((cause: unknown) => {
        // A rejection right after answering in another client means the
        // request is already gone — re-check once settled instead of crying
        // error over a race the user already resolved.
        setTimeout(() => {
          const stillPending = pendingUserInputRequests(threadStateRef.current).some(
            (request) => request.requestId === draft.requestId,
          );
          if (stillPending) {
            setSettledAnswerRequestIds((settled) => settled.filter((entry) => entry !== draft.requestId));
            setError(dispatchErrorMessage(cause));
          } else {
            toasts.push("answer-elsewhere", "info", "Already answered elsewhere", COPY_TOAST_MS);
            setSettledAnswerRequestIds((settled) =>
              settled.includes(draft.requestId) ? settled : [...settled, draft.requestId],
            );
          }
        }, 800);
      });
  };

  /** Toggles one multi-select option without leaving the modal. */
  const toggleAnswerOption = (draft: NonNullable<typeof answerDraft>, questionId: string, value: string) => {
    const current = draft.selected[questionId] ?? [];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    setAnswerDraft({ ...draft, selected: { ...draft.selected, [questionId]: next } });
  };

  /**
   * Closes the request without answering (the agent is not messaged).
   * Rejected for native callback questions, which stay visible with the
   * error — toasts paint above everything, so it stays readable.
   */
  const dismissAnswerRequest = () => {
    const draft = answerDraft;
    const id = openThreadId;
    if (draft === null || id === null) {
      return;
    }
    void client
      .dispatch({
        type: "thread.user-input.dismiss",
        commandId: crypto.randomUUID(),
        threadId: id,
        requestId: draft.requestId,
        createdAt: new Date().toISOString(),
      })
      .then(() => {
        toasts.push("answer-dismissed", "info", "Question dismissed", COPY_TOAST_MS);
        setSettledAnswerRequestIds((settled) =>
          settled.includes(draft.requestId) ? settled : [...settled, draft.requestId],
        );
      })
      .catch((cause: unknown) => {
        setSettledAnswerRequestIds((settled) => settled.filter((entry) => entry !== draft.requestId));
        setError(dispatchErrorMessage(cause));
      });
  };

  return {
    answerDraft,
    pendingAnswerRequests,
    activeAnswerRequest,
    activeAnswerQuestion,
    answerVisible,
    resolveAnswerQuestion,
    answerCurrentQuestion,
    toggleAnswerOption,
    dismissAnswerRequest,
  };
}
