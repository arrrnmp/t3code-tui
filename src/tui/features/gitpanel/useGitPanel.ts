import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ClientApi,
  ForgeDetection,
  ForgeRequest,
  GitOverview,
  MergeStrategy,
} from "../../../server/api.js";

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
  const generation = useRef(0);

  // A different thread is a different checkout: drop everything rather
  // than showing the previous thread's branches while the new read runs.
  useEffect(() => {
    setOverview(null);
    setForge(null);
    setRequests([]);
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
        if (generation.current === mine) setOverview(next);
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
          return;
        }
        const listed = await client.query({ type: "forge.requests.list", threadId, state: "open" });
        if (generation.current === mine) setRequests(listed.requests);
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
