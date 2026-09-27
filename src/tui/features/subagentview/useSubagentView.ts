import { useEffect, useMemo, useState } from "react";

import type { ClientApi, QueryResult } from "../../../server/api.js";
import { emptyThreadState, timeline } from "../../model/thread.js";
import { formatDuration, groupTurns, type TurnGroup } from "../../model/turns.js";

export type SubagentTranscript = QueryResult<"thread.subagent">;

/** Re-read while the subagent works, so its transcript fills in live. */
const POLL_MS = 3000;

/**
 * A native subagent opened in the chat pane: its own conversation (prompt,
 * tool calls, reply) read from the transcript the provider keeps, shown in
 * place of the thread's until closed. It belongs to one thread — opening
 * another thread closes it.
 */
export function useSubagentView(
  client: ClientApi,
  openThreadId: string | null,
): {
  /** The subagent on screen, when it belongs to the open thread. */
  target: { threadId: string; agentId: string } | null;
  transcript: SubagentTranscript | null;
  groups: TurnGroup[];
  open: (threadId: string, agentId: string) => void;
  close: () => void;
} {
  const [target, setTarget] = useState<{ threadId: string; agentId: string } | null>(null);
  const [transcript, setTranscript] = useState<SubagentTranscript | null>(null);
  const visible = target !== null && target.threadId === openThreadId ? target : null;

  useEffect(() => {
    if (target !== null && target.threadId !== openThreadId) setTarget(null);
  }, [openThreadId, target]);

  const running = transcript === null || transcript.agent === null || transcript.agent.status === "running";
  useEffect(() => {
    if (visible === null) {
      setTranscript(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      client
        .query({ type: "thread.subagent", threadId: visible.threadId, agentId: visible.agentId })
        .then((result) => {
          if (!cancelled) setTranscript(result);
        })
        .catch(() => undefined);
    void load();
    const timer = running ? setInterval(() => void load(), POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
    // Keyed on the ids, not the object: a re-render must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, visible?.threadId, visible?.agentId, running]);

  const groups = useMemo(
    () => (transcript === null ? [] : groupTurns(timeline({ ...emptyThreadState(), messages: transcript.messages, activities: transcript.activities }))),
    [transcript],
  );

  return {
    target: visible,
    transcript: visible === null ? null : transcript,
    groups: visible === null ? [] : groups,
    open: (threadId, agentId) => {
      setTranscript(null);
      setTarget({ threadId, agentId });
    },
    close: () => setTarget(null),
  };
}

/** "Explore · Count TODO comments", or the bare type while the record has no description. */
export function subagentTitle(transcript: SubagentTranscript | null, fallback: string | null): string {
  const agent = transcript?.agent ?? null;
  if (agent === null) return fallback ?? "subagent";
  return agent.description === null ? agent.agentType : `${agent.agentType} · ${agent.description}`;
}

/** Where the subagent stands, for the bar under its conversation. */
export function subagentState(transcript: SubagentTranscript | null, now: number): string {
  if (transcript === null) return "loading…";
  if (!transcript.available || (transcript.messages.length === 0 && transcript.activities.length === 0)) return "no transcript to show";
  const agent = transcript.agent;
  if (agent === null) return "finished";
  if (agent.status === "running") return `running ${formatDuration(Math.max(1000, now - Date.parse(agent.startedAt)))}`;
  const took = agent.stoppedAt === null ? null : Date.parse(agent.stoppedAt) - Date.parse(agent.startedAt);
  const verb = agent.status === "completed" ? "finished" : agent.status;
  return took === null || !Number.isFinite(took) ? verb : `${verb} in ${formatDuration(Math.max(1000, took))}`;
}
