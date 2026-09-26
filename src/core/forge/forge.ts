/**
 * Pull and merge requests, through the forge's own CLI.
 *
 * We shell out to `gh` and `glab` rather than talking to the REST APIs
 * ourselves, for one reason: credentials. Those tools own their logins —
 * keychain entries, SSO handshakes, enterprise hosts, token refresh — and
 * `AGENTS.md` forbids us from printing or persisting any of it. Driving
 * the CLI means we observe *presence* ("gh is installed and says it is
 * logged in") and never hold a token. The cost is that a forge we have no
 * CLI for is simply unavailable, which is the honest answer anyway.
 *
 * GitHub and GitLab differ in more than vocabulary, so the shapes here are
 * the intersection plus explicitly-nullable extras: `reviewDecision` and
 * check rollups are GitHub-only and read as `null` on GitLab rather than
 * being faked from something that nearly matches.
 *
 * Every argument is passed as argv — never concatenated into a shell
 * string — so a branch name or PR body containing shell metacharacters is
 * inert.
 */
import { runProcess } from "../infra/process.js";
import { CliError } from "../errors.js";
import type { ForgeConfig } from "../types.js";

const FORGE_TIMEOUT_MS = 30_000;
/** Writes reach the network and can be slow behind required checks. */
const FORGE_WRITE_TIMEOUT_MS = 120_000;

export type ForgeKind = "github" | "gitlab";

export interface ForgeDetection {
  readonly kind: ForgeKind | null;
  readonly remoteUrl: string | null;
  readonly host: string | null;
  /** `owner/repo`, as parsed from the remote. */
  readonly slug: string | null;
  /** The executable that would be used, once one is known to exist. */
  readonly cli: string | null;
  readonly installed: boolean;
  readonly authenticated: boolean;
  /** Why the forge is unusable, in one line, when it is. */
  readonly reason: string | null;
}

export type ForgeRequestState = "open" | "draft" | "merged" | "closed";

/** One pull request or merge request, in the vocabulary both forges share. */
export interface ForgeRequest {
  readonly number: number;
  readonly title: string;
  readonly state: ForgeRequestState;
  readonly author: string | null;
  readonly sourceBranch: string | null;
  readonly targetBranch: string | null;
  readonly url: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** GitHub only (`APPROVED`, `CHANGES_REQUESTED`, …); null on GitLab. */
  readonly reviewDecision: string | null;
  /** GitHub only: the check rollup, counted by conclusion. */
  readonly checks: ForgeChecks | null;
}

export interface ForgeChecks {
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
}

export interface ForgeRequestDetail extends ForgeRequest {
  readonly body: string;
}

const DEFAULT_PATHS: Record<ForgeKind, string> = { github: "gh", gitlab: "glab" };

function executable(kind: ForgeKind, config: ForgeConfig | undefined): string {
  const configured = kind === "github" ? config?.ghPath : config?.glabPath;
  return configured?.trim() || DEFAULT_PATHS[kind];
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  options: { readonly input?: string; readonly write?: boolean } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await runProcess(command, args, {
      cwd,
      allowFailure: true,
      timeoutMs: options.write === true ? FORGE_WRITE_TIMEOUT_MS : FORGE_TIMEOUT_MS,
      ...(options.input !== undefined ? { input: options.input } : {}),
    });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    // A missing binary and a timeout both mean "no forge here" to the
    // caller; only a write surfaces the distinction, via `reason`.
    return { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

// -- detection ---------------------------------------------------------------

/**
 * `git@host:owner/repo.git`, `https://host/owner/repo.git` and
 * `ssh://git@host:2222/owner/repo` all reduce to the same host + slug.
 * GitLab nests subgroups (`group/sub/repo`), so the slug keeps every
 * path segment rather than only the last two.
 */
export function parseRemote(url: string): { host: string; slug: string } | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
  let host: string | undefined;
  let rawPath: string | undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
      rawPath = parsed.pathname;
    } catch {
      return null;
    }
  } else if (scp && !trimmed.includes("://")) {
    host = scp[1];
    rawPath = scp[2];
  }
  if (!host || rawPath === undefined) return null;
  const slug = rawPath.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (slug.length === 0 || !slug.includes("/")) return null;
  return { host, slug };
}

function kindForHost(host: string): ForgeKind | null {
  const lower = host.toLowerCase();
  if (lower === "github.com" || lower.endsWith(".github.com") || lower.startsWith("github.")) return "github";
  if (lower === "gitlab.com" || lower.endsWith(".gitlab.com") || lower.startsWith("gitlab.")) return "gitlab";
  return null;
}

const UNDETECTED: ForgeDetection = {
  kind: null,
  remoteUrl: null,
  host: null,
  slug: null,
  cli: null,
  installed: false,
  authenticated: false,
  reason: null,
};

/**
 * Which forge this checkout belongs to, and whether we can reach it.
 *
 * A self-hosted GitLab (or GitHub Enterprise) will not match on hostname.
 * Rather than guess, we ask each installed CLI whether it recognises the
 * repository — `gh repo view` and `glab repo view` both fail fast against
 * a host they are not configured for — but only when the hostname was
 * inconclusive, so the common case stays one `git` call plus one probe.
 */
export async function detectForge(cwd: string, config?: ForgeConfig): Promise<ForgeDetection> {
  if (config?.enabled === false) return { ...UNDETECTED, reason: "Forge integration is turned off in settings." };
  const remote = await run("git", ["remote", "get-url", "origin"], cwd);
  const remoteUrl = remote.ok ? remote.stdout.trim() : "";
  if (remoteUrl.length === 0) return { ...UNDETECTED, reason: "This checkout has no origin remote." };
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return { ...UNDETECTED, remoteUrl, reason: "The origin remote is not a recognisable git URL." };
  const byHost = kindForHost(parsed.host);
  const candidates: readonly ForgeKind[] = byHost ? [byHost] : ["github", "gitlab"];
  let lastReason = `No gh or glab could read ${parsed.slug} on ${parsed.host}.`;
  for (const kind of candidates) {
    const cli = executable(kind, config);
    const probe = await run(cli, ["auth", "status"], cwd);
    if (!probe.ok && probe.stdout.length === 0 && probe.stderr.length === 0) {
      lastReason = `${cli} is not installed.`;
      continue;
    }
    const base = { kind, remoteUrl, host: parsed.host, slug: parsed.slug, cli, installed: true } as const;
    if (!probe.ok) {
      return { ...base, authenticated: false, reason: `${cli} is installed but not logged in. Run \`${cli} auth login\`.` };
    }
    // Hostname said which forge this is; trust it rather than spending a
    // network round trip confirming what the remote already stated.
    if (byHost) return { ...base, authenticated: true, reason: null };
    const recognises = await run(cli, ["repo", "view", parsed.slug], cwd);
    if (recognises.ok) return { ...base, authenticated: true, reason: null };
    lastReason = `${cli} is logged in but does not recognise ${parsed.slug}.`;
  }
  return { ...UNDETECTED, remoteUrl, host: parsed.host, slug: parsed.slug, reason: lastReason };
}

function requireReady(detection: ForgeDetection): { kind: ForgeKind; cli: string } {
  if (detection.kind === null || detection.cli === null || !detection.installed || !detection.authenticated) {
    throw new CliError("FORGE_UNAVAILABLE", detection.reason ?? "No forge CLI is available for this checkout.");
  }
  return { kind: detection.kind, cli: detection.cli };
}

// -- reading -----------------------------------------------------------------

const GH_FIELDS = [
  "number",
  "title",
  "state",
  "isDraft",
  "author",
  "headRefName",
  "baseRefName",
  "url",
  "createdAt",
  "updatedAt",
  "reviewDecision",
  "statusCheckRollup",
].join(",");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function countChecks(rollup: unknown): ForgeChecks | null {
  if (!Array.isArray(rollup)) return null;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const entry of rollup) {
    const record = asRecord(entry);
    if (!record) continue;
    // Checks carry `conclusion` + `status`; commit statuses carry `state`.
    const conclusion = (text(record.conclusion) ?? text(record.state) ?? "").toUpperCase();
    const status = (text(record.status) ?? "").toUpperCase();
    if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") passed += 1;
    else if (conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED" || conclusion === "ERROR") failed += 1;
    else if (status === "COMPLETED") passed += 1;
    else pending += 1;
  }
  return { passed, failed, pending };
}

function githubRequest(record: Record<string, unknown>): ForgeRequest | null {
  const number = typeof record.number === "number" ? record.number : null;
  if (number === null) return null;
  const rawState = (text(record.state) ?? "OPEN").toUpperCase();
  const draft = record.isDraft === true;
  const state: ForgeRequestState =
    rawState === "MERGED" ? "merged" : rawState === "CLOSED" ? "closed" : draft ? "draft" : "open";
  return {
    number,
    title: text(record.title) ?? "",
    state,
    author: text(asRecord(record.author)?.login),
    sourceBranch: text(record.headRefName),
    targetBranch: text(record.baseRefName),
    url: text(record.url),
    createdAt: text(record.createdAt),
    updatedAt: text(record.updatedAt),
    reviewDecision: text(record.reviewDecision),
    checks: countChecks(record.statusCheckRollup),
  };
}

function gitlabRequest(record: Record<string, unknown>): ForgeRequest | null {
  const number = typeof record.iid === "number" ? record.iid : Number(text(record.iid) ?? "");
  if (!Number.isInteger(number)) return null;
  const rawState = (text(record.state) ?? "opened").toLowerCase();
  const draft = record.draft === true || record.work_in_progress === true;
  const state: ForgeRequestState =
    rawState === "merged" ? "merged" : rawState === "closed" || rawState === "locked" ? "closed" : draft ? "draft" : "open";
  return {
    number,
    title: text(record.title) ?? "",
    state,
    author: text(asRecord(record.author)?.username),
    sourceBranch: text(record.source_branch),
    targetBranch: text(record.target_branch),
    url: text(record.web_url),
    createdAt: text(record.created_at),
    updatedAt: text(record.updated_at),
    // GitLab's approvals live behind a separate endpoint and its
    // pipelines are not a check rollup; neither is invented here.
    reviewDecision: null,
    checks: null,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export interface ListRequestsOptions {
  readonly state?: "open" | "closed" | "merged" | "all";
  readonly limit?: number;
}

export async function listRequests(
  cwd: string,
  detection: ForgeDetection,
  options: ListRequestsOptions = {},
): Promise<readonly ForgeRequest[]> {
  const { kind, cli } = requireReady(detection);
  // GitLab's API rejects a page size above 100; GitHub's CLI paginates
  // for us and takes more. Clamp per forge rather than to the lower of
  // the two, so a GitHub repo can still ask for a long list.
  const limit = Math.max(1, Math.min(options.limit ?? 30, kind === "github" ? 200 : 100));
  const state = options.state ?? "open";
  if (kind === "github") {
    const result = await run(cli, ["pr", "list", "--json", GH_FIELDS, "--limit", String(limit), "--state", state], cwd);
    if (!result.ok) throw forgeFailure(cli, "list pull requests", result.stderr);
    const parsed = parseJson(result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const record = asRecord(entry);
      const request = record ? githubRequest(record) : null;
      return request ? [request] : [];
    });
  }
  // glab takes the state as its own flag rather than a value.
  const stateFlag = state === "all" ? ["--all"] : state === "merged" ? ["--merged"] : state === "closed" ? ["--closed"] : [];
  const result = await run(cli, ["mr", "list", "--output", "json", "--per-page", String(limit), ...stateFlag], cwd);
  if (!result.ok) throw forgeFailure(cli, "list merge requests", result.stderr);
  const parsed = parseJson(result.stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const record = asRecord(entry);
    const request = record ? gitlabRequest(record) : null;
    return request ? [request] : [];
  });
}

export async function viewRequest(cwd: string, detection: ForgeDetection, number: number): Promise<ForgeRequestDetail | null> {
  const { kind, cli } = requireReady(detection);
  if (kind === "github") {
    const result = await run(cli, ["pr", "view", String(number), "--json", `${GH_FIELDS},body`], cwd);
    if (!result.ok) return null;
    const record = asRecord(parseJson(result.stdout));
    const base = record ? githubRequest(record) : null;
    return base ? { ...base, body: text(record?.body) ?? "" } : null;
  }
  const result = await run(cli, ["mr", "view", String(number), "--output", "json"], cwd);
  if (!result.ok) return null;
  const record = asRecord(parseJson(result.stdout));
  const base = record ? gitlabRequest(record) : null;
  return base ? { ...base, body: text(record?.description) ?? "" } : null;
}

function forgeFailure(cli: string, what: string, stderr: string): CliError {
  const detail = stderr.trim().split("\n").slice(0, 3).join(" ").slice(0, 300);
  return new CliError("FORGE_COMMAND_FAILED", `\`${cli}\` could not ${what}.${detail ? ` ${detail}` : ""}`);
}

// -- writing -----------------------------------------------------------------

export interface CreateRequestInput {
  readonly title: string;
  readonly body?: string;
  /** The branch being merged into; each CLI's own default when omitted. */
  readonly targetBranch?: string;
  readonly sourceBranch?: string;
  readonly draft?: boolean;
}

/**
 * Open a pull or merge request. Outward-facing: a client must confirm
 * with the user before calling this, which is why nothing here prompts —
 * both CLIs are driven with their non-interactive flags so they can never
 * block on a TTY we do not have.
 */
export async function createRequest(
  cwd: string,
  detection: ForgeDetection,
  input: CreateRequestInput,
): Promise<{ readonly url: string | null }> {
  const { kind, cli } = requireReady(detection);
  const title = input.title.trim();
  if (title.length === 0) throw new CliError("FORGE_TITLE_REQUIRED", "A pull request needs a title.");
  const body = input.body ?? "";
  if (kind === "github") {
    const args = ["pr", "create", "--title", title, "--body-file", "-"];
    if (input.targetBranch) args.push("--base", input.targetBranch);
    if (input.sourceBranch) args.push("--head", input.sourceBranch);
    if (input.draft === true) args.push("--draft");
    // Body over stdin, so a description with newlines or leading dashes
    // cannot be read as further arguments.
    const result = await run(cli, args, cwd, { input: body, write: true });
    if (!result.ok) throw forgeFailure(cli, "create the pull request", result.stderr);
    return { url: firstUrl(result.stdout) };
  }
  const args = ["mr", "create", "--title", title, "--description", body, "--yes", "--no-editor"];
  if (input.targetBranch) args.push("--target-branch", input.targetBranch);
  if (input.sourceBranch) args.push("--source-branch", input.sourceBranch);
  if (input.draft === true) args.push("--draft");
  const result = await run(cli, args, cwd, { write: true });
  if (!result.ok) throw forgeFailure(cli, "create the merge request", result.stderr);
  return { url: firstUrl(result.stdout) };
}

export async function commentOnRequest(
  cwd: string,
  detection: ForgeDetection,
  number: number,
  body: string,
): Promise<void> {
  const { kind, cli } = requireReady(detection);
  const message = body.trim();
  if (message.length === 0) throw new CliError("FORGE_COMMENT_EMPTY", "A comment needs some text.");
  const result =
    kind === "github"
      ? await run(cli, ["pr", "comment", String(number), "--body-file", "-"], cwd, { input: message, write: true })
      : await run(cli, ["mr", "note", String(number), "--message", message], cwd, { write: true });
  if (!result.ok) throw forgeFailure(cli, `comment on #${number}`, result.stderr);
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export interface MergeRequestInput {
  readonly strategy?: MergeStrategy;
  readonly deleteBranch?: boolean;
}

export async function mergeRequest(
  cwd: string,
  detection: ForgeDetection,
  number: number,
  input: MergeRequestInput = {},
): Promise<void> {
  const { kind, cli } = requireReady(detection);
  const strategy = input.strategy ?? "merge";
  if (kind === "github") {
    const flag = strategy === "squash" ? "--squash" : strategy === "rebase" ? "--rebase" : "--merge";
    const args = ["pr", "merge", String(number), flag];
    if (input.deleteBranch === true) args.push("--delete-branch");
    const result = await run(cli, args, cwd, { write: true });
    if (!result.ok) throw forgeFailure(cli, `merge #${number}`, result.stderr);
    return;
  }
  // glab's plain merge takes no strategy flag; squash and rebase do.
  const args = ["mr", "merge", String(number), "--yes"];
  if (strategy === "squash") args.push("--squash");
  if (strategy === "rebase") args.push("--rebase");
  if (input.deleteBranch === true) args.push("--remove-source-branch");
  const result = await run(cli, args, cwd, { write: true });
  if (!result.ok) throw forgeFailure(cli, `merge !${number}`, result.stderr);
}

/** Both CLIs print the created request's URL; that is all we need back. */
function firstUrl(stdout: string): string | null {
  const match = /https?:\/\/\S+/.exec(stdout);
  return match ? match[0].replace(/[).,]+$/, "") : null;
}
