import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ClientApi,
  ForgeCheckRun,
  ForgeChecks,
  ForgeDetection,
  ForgeRequest,
  ForgeRequestStatus,
  GitCommitDetail,
  GitOverview,
  MergeStrategy,
} from "../../../server/api.js";

/** The commit open in the tab: its full record, then its CI once the forge answers. */
export interface OpenCommit {
  readonly sha: string;
  readonly detail: GitCommitDetail | null;
  readonly loading: boolean;
  readonly runs: readonly ForgeCheckRun[] | null;
}

/**
 * The Git tab's state: local history on one side, the forge on the other.
 *
 * The two are read separately and on purpose. Local git is fast and always
 * answerable; a forge call shells out to `gh`/`glab` and reaches the
 * network, so it must never hold up the branches and commits. The panel
 * therefore paints history as soon as git answers and fills the requests
 * section in when (or if) the forge does.
 *
 * Writes — open, comment, merge — are outward-facing, so nothing here
 * fires one on its own. Each is a method the tab calls only after the user
 * has confirmed, and every one re-reads the list afterwards rather than
 * patching it locally, because the forge decides what actually happened.
 */
export interface GitPanelState {
  readonly overview: GitOverview | null;
  readonly forge: ForgeDetection | null;
  readonly requests: readonly ForgeRequest[];
  /** The checked-out branch's own request, with CI and mergeability; null when it has none. */
  readonly status: ForgeRequestStatus | null;
  /** CI tallies for the shown commits, by sha (GitHub only). */
  readonly commitChecks: Readonly<Record<string, ForgeChecks>>;
  /** The commit open in the tab, or null for the overview. */
  readonly commit: OpenCommit | null;
  readonly openCommit: (sha: string) => void;
  readonly closeCommit: () => void;
  readonly loadingGit: boolean;
  readonly loadingForge: boolean;
  readonly error: string | null;
  /** In-flight write, so the tab can disable its actions and say why. */
  readonly busy: string | null;
  /** Which branch history is shown for; null follows the checked-out one. */
  readonly branch: string | null;
  readonly selectBranch: (branch: string | null) => void;
  readonly refresh: () => void;
  readonly createRequest: (input: { title: string; body?: string; draft?: boolean }) => Promise<string | null>;
  readonly commentOn: (number: number, body: string) => Promise<void>;
  readonly merge: (number: number, strategy: MergeStrategy, deleteBranch: boolean) => Promise<void>;
}

export function useGitPanel(client: ClientApi, threadId: string | null, active: boolean): GitPanelState {
  const [overview, setOverview] = useState<GitOverview | null>(null);
  const [forge, setForge] = useState<ForgeDetection | null>(null);
  const [requests, setRequests] = useState<readonly ForgeRequest[]>([]);
  const [loadingGit, setLoadingGit] = useState(false);
  const [loadingForge, setLoadingForge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [status, setStatus] = useState<ForgeRequestStatus | null>(null);
  const [commitChecks, setCommitChecks] = useState<Readonly<Record<string, ForgeChecks>>>({});
  const [commit, setCommit] = useState<OpenCommit | null>(null);
  const generation = useRef(0);
  const commitGeneration = useRef(0);

  // A different thread is a different checkout: drop everything rather
  // than showing the previous thread's branches while the new read runs.
  useEffect(() => {
    setOverview(null);
    setForge(null);
    setRequests([]);
    setStatus(null);
    setCommitChecks({});
    setCommit(null);
    setBranch(null);
    setError(null);
  }, [threadId]);

  const read = useCallback(() => {
    if (threadId === null) return;
    const mine = (generation.current += 1);
    setLoadingGit(true);
    setLoadingForge(true);
    void client
      .query({ type: "git.overview", threadId, ...(branch !== null ? { branch } : {}) })
      .then((next) => {
        if (generation.current !== mine) return;
        setOverview(next);
        // CI per commit rides on the forge and the network: after history
        // has painted, never before it.
        const shown = next.branch;
        if (!next.isRepository || shown === null) return;
        void client
          .query({ type: "forge.commits.checks", threadId, branch: shown, limit: next.commits.length })
          .then((result) => {
            if (generation.current === mine) setCommitChecks(result.checks);
          })
          .catch(() => undefined);
      })
      .catch((cause: unknown) => {
        if (generation.current === mine) setError(messageOf(cause));
      })
      .finally(() => {
        if (generation.current === mine) setLoadingGit(false);
      });
    void client
      .query({ type: "forge.detect", threadId })
      .then(async (detection) => {
        if (generation.current !== mine) return;
        setForge(detection);
        if (detection.kind === null) {
          setRequests([]);
          setStatus(null);
          return;
        }
        const [listed, own] = await Promise.all([
          client.query({ type: "forge.requests.list", threadId, state: "open" }),
          client.query({ type: "forge.request.status", threadId }).catch(() => ({ request: null })),
        ]);
        if (generation.current !== mine) return;
        setRequests(listed.requests);
        setStatus(own.request);
      })
      .catch((cause: unknown) => {
        // A forge failure is not a panel failure: history still stands.
        if (generation.current === mine) setForge({ ...EMPTY_FORGE, reason: messageOf(cause) });
      })
      .finally(() => {
        if (generation.current === mine) setLoadingForge(false);
      });
  }, [client, threadId, branch]);

  useEffect(() => {
    if (!active || threadId === null) return;
    read();
  }, [active, threadId, read]);

  const selectBranch = useCallback((next: string | null) => setBranch(next), []);

  const openCommit = useCallback(
    (sha: string) => {
      if (threadId === null) return;
      const mine = (commitGeneration.current += 1);
      setCommit({ sha, detail: null, loading: true, runs: null });
      void client
        .query({ type: "git.commit.detail", threadId, sha })
        .then((result) => {
          if (commitGeneration.current === mine) setCommit((current) => (current === null ? null : { ...current, detail: result.commit, loading: false }));
        })
        .catch((cause: unknown) => {
          if (commitGeneration.current !== mine) return;
          setError(messageOf(cause));
          setCommit((current) => (current === null ? null : { ...current, loading: false }));
        });
      void client
        .query({ type: "forge.commit.runs", threadId, sha })
        .then((result) => {
          if (commitGeneration.current === mine) setCommit((current) => (current === null ? null : { ...current, runs: result.runs }));
        })
        .catch(() => undefined);
    },
    [client, threadId],
  );
  const closeCommit = useCallback(() => {
    commitGeneration.current += 1;
    setCommit(null);
  }, []);

  const write = useCallback(
    async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
      setBusy(label);
      setError(null);
      try {
        return await run();
      } catch (cause) {
        setError(messageOf(cause));
        throw cause;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const createRequest = useCallback(
    async (input: { title: string; body?: string; draft?: boolean }): Promise<string | null> => {
      if (threadId === null) return null;
      const result = await write("Opening…", () =>
        client.dispatch({
          type: "forge.request.create",
          threadId,
          title: input.title,
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        }),
      );
      read();
      return result.url;
    },
    [client, threadId, write, read],
  );

  const commentOn = useCallback(
    async (number: number, body: string): Promise<void> => {
      if (threadId === null) return;
      await write("Commenting…", () => client.dispatch({ type: "forge.request.comment", threadId, number, body }));
    },
    [client, threadId, write],
  );

  const merge = useCallback(
    async (number: number, strategy: MergeStrategy, deleteBranch: boolean): Promise<void> => {
      if (threadId === null) return;
      await write("Merging…", () =>
        client.dispatch({ type: "forge.request.merge", threadId, number, strategy, deleteBranch }),
      );
      read();
    },
    [client, threadId, write, read],
  );

  return {
    overview,
    forge,
    requests,
    status,
    commitChecks,
    commit,
    openCommit,
    closeCommit,
    loadingGit,
    loadingForge,
    error,
    busy,
    branch,
    selectBranch,
    refresh: read,
    createRequest,
    commentOn,
    merge,
  };
}

const EMPTY_FORGE: ForgeDetection = {
  kind: null,
  remoteUrl: null,
  host: null,
  slug: null,
  cli: null,
  installed: false,
  authenticated: false,
  reason: null,
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
