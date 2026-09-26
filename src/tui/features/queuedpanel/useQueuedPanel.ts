import { useMemo } from "react";

import type { ClientApi } from "../../../server/api.js";
import { queuedMessages, type QueuedMessage, type ThreadState } from "../../model/thread.js";

/**
 * The Queued panel's state: what has not reached the agent yet, and a way
 * to take one back. Cancelling goes through the same command that stops a
 * running turn — given a queued turn's id, it drops that message instead.
 */
export function useQueuedPanel(params: {
  client: ClientApi;
  threadState: ThreadState;
  threadId: string | null;
  setError: (message: string) => void;
}): { items: readonly QueuedMessage[]; cancel: (turnId: string) => void } {
  const { client, threadState, threadId, setError } = params;
  const items = useMemo(() => queuedMessages(threadState), [threadState]);
  const cancel = (turnId: string): void => {
    if (threadId === null) return;
    void client
      .dispatch({ type: "thread.turn.interrupt", threadId, turnId })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  return { items, cancel };
}
