/**
 * The contract this path never had: what core writes for a parked question
 * is what the answer panel reads back.
 *
 * Both halves existed and neither was wrong on its own — the reader looked
 * for `user-input.requested`, the writer (the old server path) was deleted,
 * and the render-check fixture hand-rolled the activity that server
 * used to send. So the panel's own scenarios stayed green while a real
 * question rendered as nothing and parked the turn forever.
 *
 * It lives on the client side deliberately: it is the reader asserting it
 * can read, which keeps `core/` free of any import of a client.
 */
import { describe, expect, it } from "vitest";

import { pendingUserInputRequests, type ThreadState } from "../thread.js";
import { describeActivity } from "../activity.js";
import type { ActivityEnvelope } from "../../../core/types.js";
import { userInputActivityRow, type UserInputRuntimeEvent } from "../../../core/threads/requestactivity.js";

function activityFor(event: UserInputRuntimeEvent): ActivityEnvelope {
  const row = userInputActivityRow(event);
  expect(row).not.toBeNull();
  return {
    id: `a-${row!.kind}`,
    tone: "info",
    kind: row!.kind,
    summary: row!.summary,
    turnId: "turn-1",
    createdAt: "2026-09-22T00:00:00.000Z",
    payload: row!.payload,
  };
}

function stateOf(activities: ActivityEnvelope[]): ThreadState {
  return {
    snapshotSequence: 0,
    thread: null,
    messages: [],
    activities,
    checkpoints: [],
    proposedPlans: [],
    session: null,
    contextUsage: null,
    contextWindowUpdatedAt: null,
    contextResume: null,
  } as unknown as ThreadState;
}

/** The question that actually parked thread 287a3ea2 for eleven minutes. */
const ASKED: UserInputRuntimeEvent = {
  type: "user-input.request.opened",
  provider: "claude",
  threadId: "thread-1",
  requestId: "req-1",
  raw: {
    toolName: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "How strict should the downward rule be for the CLI?",
          header: "Rule strictness",
          multiSelect: false,
          options: [
            { label: "Layered", description: "core <- server <- clients" },
            { label: "Strict", description: "clients only touch server" },
          ],
        },
      ],
    },
  },
} as UserInputRuntimeEvent;

describe("parked question rows", () => {
  it("decodes into an answerable request the panel can mount", () => {
    const [request] = pendingUserInputRequests(stateOf([activityFor(ASKED)]));
    expect(request).toMatchObject({
      requestId: "req-1",
      questions: [
        {
          header: "Rule strictness",
          question: "How strict should the downward rule be for the CLI?",
          multiSelect: false,
          allowCustomAnswer: true,
          options: [{ label: "Layered" }, { label: "Strict" }],
        },
      ],
    });
    // The panel answers by option value, falling back to the label — and
    // that key is what the provider gets its answers under.
    const question = request!.questions[0]!;
    expect(question.options.map((option) => option.value ?? option.label)).toEqual(["Layered", "Strict"]);
  });

  it("renders as a question row rather than the raw tool echo", () => {
    expect(describeActivity(activityFor(ASKED))).toMatchObject({
      kind: "question",
      detail: "How strict should the downward rule be for the CLI?",
    });
  });

  it("stops being pending once the resolution row lands", () => {
    const resolved = activityFor({
      type: "user-input.request.resolved",
      provider: "claude",
      threadId: "thread-1",
      requestId: "req-1",
    } as UserInputRuntimeEvent);
    expect(pendingUserInputRequests(stateOf([activityFor(ASKED), resolved]))).toHaveLength(0);
  });
});
