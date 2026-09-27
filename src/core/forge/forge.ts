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

// -- status: the branch's request and CI ---------------------------------------

export type ForgeCheckState = "passed" | "failed" | "pending" | "skipped";

/** One CI check (a GitHub check run or status, a GitLab pipeline). */
export interface ForgeCheckRun {
  readonly name: string;
  readonly state: ForgeCheckState;
  readonly url: string | null;
}

/**
 * The request a branch has open (or had: a merged one still reads), with
 * what a reviewer looks at first — CI, whether it can merge, how big it
 * is. Fields a forge does not report are null, never guessed.
 */
export interface ForgeRequestStatus extends ForgeRequest {
  readonly runs: readonly ForgeCheckRun[];
  /** `mergeable`, `conflicting`, or null when the forge has not worked it out yet. */
  readonly mergeable: "mergeable" | "conflicting" | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly changedFiles: number | null;
}

function checkState(record: Record<string, unknown>): ForgeCheckState {
  const conclusion = (text(record.conclusion) ?? text(record.state) ?? "").toUpperCase();
  const status = (text(record.status) ?? "").toUpperCase();
  if (conclusion === "SKIPPED" || conclusion === "NEUTRAL") return "skipped";
  if (conclusion === "SUCCESS") return "passed";
  if (["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(conclusion)) return "failed";
  if (status === "COMPLETED") return "passed";
  return "pending";
}

/** GitHub's rollup as named runs: check runs carry `name`, commit statuses `context`. */
export function checkRuns(rollup: unknown): ForgeCheckRun[] {
  if (!Array.isArray(rollup)) return [];
  return rollup.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    return [
      {
        name: text(record.name) ?? text(record.context) ?? "check",
        state: checkState(record),
        url: text(record.detailsUrl) ?? text(record.targetUrl) ?? text(record.html_url) ?? text(record.details_url),
      },
    ];
  });
}

/** GitLab pipeline statuses in the shared vocabulary. */
function pipelineState(status: string | null): ForgeCheckState {
  const lower = (status ?? "").toLowerCase();
  if (lower === "success") return "passed";
  if (lower === "failed" || lower === "canceled") return "failed";
  if (lower === "skipped" || lower === "manual") return "skipped";
  return "pending";
}

function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

const GH_STATUS_FIELDS = `${GH_FIELDS},mergeable,additions,deletions,changedFiles`;

/**
 * The request for `branch` (the checked-out one when omitted): `gh pr view
 * <branch>` / `glab mr view <branch>` resolve it the way the user would.
 * Null when the branch has none.
 */
export async function requestStatus(cwd: string, detection: ForgeDetection, branch?: string): Promise<ForgeRequestStatus | null> {
  const { kind, cli } = requireReady(detection);
  const target = branch === undefined ? [] : [branch];
  if (kind === "github") {
    const result = await run(cli, ["pr", "view", ...target, "--json", GH_STATUS_FIELDS], cwd);
    if (!result.ok) return null;
    const record = asRecord(parseJson(result.stdout));
    const base = record ? githubRequest(record) : null;
    if (!record || !base) return null;
    const mergeable = text(record.mergeable)?.toUpperCase();
    return {
      ...base,
      runs: checkRuns(record.statusCheckRollup),
      mergeable: mergeable === "MERGEABLE" ? "mergeable" : mergeable === "CONFLICTING" ? "conflicting" : null,
      additions: count(record.additions),
      deletions: count(record.deletions),
      changedFiles: count(record.changedFiles),
    };
  }
  const result = await run(cli, ["mr", "view", ...target, "--output", "json"], cwd);
  if (!result.ok) return null;
  const record = asRecord(parseJson(result.stdout));
  const base = record ? gitlabRequest(record) : null;
  if (!record || !base) return null;
  const pipeline = asRecord(record.head_pipeline) ?? asRecord(record.pipeline);
  const runs: ForgeCheckRun[] =
    pipeline === null ? [] : [{ name: "pipeline", state: pipelineState(text(pipeline.status)), url: text(pipeline.web_url) }];
  return {
    ...base,
    checks: runs.length === 0 ? null : tally(runs),
    runs,
    mergeable: record.has_conflicts === true ? "conflicting" : record.has_conflicts === false ? "mergeable" : null,
    additions: null,
    deletions: null,
    changedFiles: count(record.changes_count),
  };
}

export function tally(runs: readonly ForgeCheckRun[]): ForgeChecks {
  return {
    passed: runs.filter((entry) => entry.state === "passed" || entry.state === "skipped").length,
    failed: runs.filter((entry) => entry.state === "failed").length,
    pending: runs.filter((entry) => entry.state === "pending").length,
  };
}

/** The GraphQL for a branch's recent commits and their CI counts, in one round trip. */
const COMMIT_CHECKS_QUERY = `query($owner: String!, $name: String!, $ref: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit {
          history(first: $first) {
            nodes {
              oid
              statusCheckRollup {
                contexts(first: 0) {
                  checkRunCountsByState { state count }
                  statusContextCountsByState { state count }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const PASSED_STATES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** GraphQL `{state, count}` pairs into the shared tally. */
export function tallyCounts(pairs: unknown): ForgeChecks {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const entry of Array.isArray(pairs) ? pairs : []) {
    const record = asRecord(entry);
    const state = (text(record?.state) ?? "").toUpperCase();
    const amount = count(record?.count) ?? 0;
    if (PASSED_STATES.has(state)) passed += amount;
    else if (FAILED_STATES.has(state)) failed += amount;
    else pending += amount;
  }
  return { passed, failed, pending };
}

/**
 * CI for a branch's most recent commits, keyed by full sha: what the
 * commit list shows as "✓ 18/18". GitHub only (one GraphQL call); GitLab
 * and a branch the forge has never seen read as no checks at all.
 */
export async function commitChecks(
  cwd: string,
  detection: ForgeDetection,
  branch: string,
  limit = 30,
): Promise<Readonly<Record<string, ForgeChecks>>> {
  const { kind, cli } = requireReady(detection);
  const [owner, ...rest] = (detection.slug ?? "").split("/");
  if (kind !== "github" || !owner || rest.length === 0) return {};
  const result = await run(
    cli,
    [
      "api",
      "graphql",
      "-f", `query=${COMMIT_CHECKS_QUERY}`,
      "-f", `owner=${owner}`,
      "-f", `name=${rest.join("/")}`,
      "-f", `ref=refs/heads/${branch}`,
      "-F", `first=${Math.max(1, Math.min(limit, 100))}`,
    ],
    cwd,
  );
  if (!result.ok) return {};
  const nodes = asRecord(asRecord(asRecord(asRecord(asRecord(asRecord(parseJson(result.stdout))?.data)?.repository)?.ref)?.target)?.history)?.nodes;
  const out: Record<string, ForgeChecks> = {};
  for (const entry of Array.isArray(nodes) ? nodes : []) {
    const node = asRecord(entry);
    const oid = text(node?.oid);
    const contexts = asRecord(asRecord(node?.statusCheckRollup)?.contexts);
    if (oid === null || contexts === null) continue;
    const runs = tallyCounts(contexts.checkRunCountsByState);
    const statuses = tallyCounts(contexts.statusContextCountsByState);
    const total = { passed: runs.passed + statuses.passed, failed: runs.failed + statuses.failed, pending: runs.pending + statuses.pending };
    if (total.passed + total.failed + total.pending > 0) out[oid] = total;
  }
  return out;
}

/** One commit's CI runs, by name: the commit view's checks list. */
export async function commitRuns(cwd: string, detection: ForgeDetection, sha: string): Promise<readonly ForgeCheckRun[]> {
  const { kind, cli } = requireReady(detection);
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return [];
  if (kind === "github") {
    const result = await run(cli, ["api", `repos/{owner}/{repo}/commits/${sha}/check-runs`, "--jq", ".check_runs"], cwd);
    if (!result.ok) return [];
    return checkRuns(parseJson(result.stdout));
  }
  const result = await run(cli, ["api", `projects/:id/repository/commits/${sha}/statuses`], cwd);
  if (!result.ok) return [];
  const parsed = parseJson(result.stdout);
  return (Array.isArray(parsed) ? parsed : []).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    return [{ name: text(record.name) ?? "status", state: pipelineState(text(record.status)), url: text(record.target_url) }];
  });
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
