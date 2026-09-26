/**
 * Git and forge CLI: `--json` envelopes over `ClientApi`.
 *
 * Keyed by thread, not by path, because that is what the server queries
 * take — a worktree thread has its own checkout and only the server knows
 * where. The shapes below are the envelope contract (pinned by
 * `../tests/envelopes/`), not the core types verbatim: `ok`/`reason` for
 * forge availability is a CLI-facing summary of a richer detection.
 */
import { CliError } from "../../core/errors.js";
import type { CliConfig } from "../../core/types.js";
import type { ClientApi, ForgeRequest, GitOverview, MergeStrategy } from "../../server/api.js";
import { cliClient } from "../infra/client.js";

export interface GitStatusEnvelope {
  readonly thread: string;
  readonly repository: boolean;
  readonly root: string | null;
  readonly branch: string | null;
  readonly status: GitOverview["status"];
  readonly branches: GitOverview["branches"];
  readonly commits: GitOverview["commits"];
}

export async function gitStatus(
  config: CliConfig,
  options: { threadId: string; branch?: string; limit?: number },
): Promise<GitStatusEnvelope> {
  const client = await cliClient(config);
  const overview = await client.query({
    type: "git.overview",
    threadId: options.threadId,
    ...(options.branch !== undefined ? { branch: options.branch } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  return {
    thread: options.threadId,
    repository: overview.isRepository,
    root: overview.root,
    branch: overview.branch,
    status: overview.status,
    branches: overview.branches,
    commits: overview.commits,
  };
}

export interface ForgeEnvelope {
  readonly thread: string;
  readonly forge: string | null;
  readonly host: string | null;
  readonly repository: string | null;
  readonly cli: string | null;
  readonly available: boolean;
  readonly reason: string | null;
}

async function detect(client: ClientApi, threadId: string): Promise<ForgeEnvelope> {
  const detection = await client.query({ type: "forge.detect", threadId });
  return {
    thread: threadId,
    forge: detection.kind,
    host: detection.host,
    repository: detection.slug,
    cli: detection.cli,
    available: detection.kind !== null && detection.installed && detection.authenticated,
    reason: detection.reason,
  };
}

export async function forgeStatus(config: CliConfig, threadId: string): Promise<ForgeEnvelope> {
  return await detect(await cliClient(config), threadId);
}

/** Refuse early, with the detection's own reason, rather than on the CLI's error. */
async function requireForge(client: ClientApi, threadId: string): Promise<void> {
  const envelope = await detect(client, threadId);
  if (!envelope.available) {
    throw new CliError("FORGE_UNAVAILABLE", envelope.reason ?? "No forge CLI is available for this thread's checkout.");
  }
}

export interface RequestListEnvelope {
  readonly thread: string;
  readonly forge: string | null;
  readonly requests: readonly ForgeRequest[];
}

export async function listForgeRequests(
  config: CliConfig,
  options: { threadId: string; state?: "open" | "closed" | "merged" | "all"; limit?: number },
): Promise<RequestListEnvelope> {
  const client = await cliClient(config);
  const envelope = await detect(client, options.threadId);
  if (!envelope.available) return { thread: options.threadId, forge: envelope.forge, requests: [] };
  const listed = await client.query({
    type: "forge.requests.list",
    threadId: options.threadId,
    ...(options.state !== undefined ? { state: options.state } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  return { thread: options.threadId, forge: envelope.forge, requests: listed.requests };
}

export async function viewForgeRequest(
  config: CliConfig,
  options: { threadId: string; number: number },
): Promise<{ thread: string; request: unknown }> {
  const client = await cliClient(config);
  await requireForge(client, options.threadId);
  const result = await client.query({ type: "forge.request.view", threadId: options.threadId, number: options.number });
  if (result.request === null) {
    throw new CliError("FORGE_REQUEST_NOT_FOUND", `No request #${options.number} on this thread's remote.`, {
      exitCode: 2,
    });
  }
  return { thread: options.threadId, request: result.request };
}

export async function createForgeRequest(
  config: CliConfig,
  options: { threadId: string; title: string; body?: string; targetBranch?: string; sourceBranch?: string; draft?: boolean },
): Promise<{ thread: string; url: string | null }> {
  const client = await cliClient(config);
  await requireForge(client, options.threadId);
  const result = await client.dispatch({
    type: "forge.request.create",
    threadId: options.threadId,
    title: options.title,
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.targetBranch !== undefined ? { targetBranch: options.targetBranch } : {}),
    ...(options.sourceBranch !== undefined ? { sourceBranch: options.sourceBranch } : {}),
    ...(options.draft !== undefined ? { draft: options.draft } : {}),
  });
  return { thread: options.threadId, url: result.url };
}

export async function commentOnForgeRequest(
  config: CliConfig,
  options: { threadId: string; number: number; body: string },
): Promise<{ thread: string; number: number; commented: true }> {
  const client = await cliClient(config);
  await requireForge(client, options.threadId);
  await client.dispatch({
    type: "forge.request.comment",
    threadId: options.threadId,
    number: options.number,
    body: options.body,
  });
  return { thread: options.threadId, number: options.number, commented: true };
}

export async function mergeForgeRequest(
  config: CliConfig,
  options: { threadId: string; number: number; strategy?: MergeStrategy; deleteBranch?: boolean },
): Promise<{ thread: string; number: number; merged: true; strategy: MergeStrategy }> {
  const client = await cliClient(config);
  await requireForge(client, options.threadId);
  const strategy = options.strategy ?? "merge";
  await client.dispatch({
    type: "forge.request.merge",
    threadId: options.threadId,
    number: options.number,
    strategy,
    ...(options.deleteBranch !== undefined ? { deleteBranch: options.deleteBranch } : {}),
  });
  return { thread: options.threadId, number: options.number, merged: true, strategy };
}
