import type { ProviderSummary, ProviderUsageLimits } from "../../core/catalog/summary.js";
import type { ForgeCheckRun, ForgeChecks, ForgeKind } from "../../server/api.js";

/**
 * The pure half of the Git tab: what an agent is asked when it opens a
 * pull request for the thread, who gets asked when the thread's own
 * provider is out of usage, and how CI reads in one glance.
 */

/** "PR" on GitHub, "MR" on GitLab — the word the forge itself uses. */
export function requestNoun(kind: ForgeKind | null): { short: string; long: string } {
  return kind === "gitlab" ? { short: "MR", long: "merge request" } : { short: "PR", long: "pull request" };
}

/**
 * The instructions an agent gets to open the request. The thread's own
 * agent knows the work; a handed-off one starts cold, so it is told to read
 * the branch (log and diff against the base) before writing anything.
 */
export function openRequestPrompt(input: {
  kind: ForgeKind | null;
  draft: boolean;
  branch: string | null;
  /** Another agent, from nothing: no conversation to draw on. */
  cold: boolean;
}): string {
  const noun = requestNoun(input.kind);
  const cli = input.kind === "gitlab" ? "glab mr create" : "gh pr create";
  const draftFlag = input.draft ? " --draft" : "";
  const branch = input.branch === null ? "the current branch" : `\`${input.branch}\``;
  const lines = [
    `Open a ${input.draft ? "draft " : ""}${noun.long} for ${branch}.`,
    "",
    input.cold
      ? "You are picking this up without the conversation that did the work. First read what the branch holds: `git status`, `git log` and `git diff` against the base branch it will merge into."
      : "Use what you know from this thread about what was done and why.",
    "1. If there are uncommitted changes that belong to this work, commit them with a clear message. Leave anything unrelated alone.",
    "2. Push the branch (set its upstream if it has none).",
    `3. Open it with \`${cli}${draftFlag}\`: a short, specific title, and a description covering what changed, why, and how it was verified.`,
    `4. Reply with the ${noun.short}'s URL.`,
    "",
    `If a ${noun.short} for this branch already exists, do not open another; say so and give its URL.`,
  ];
  return lines.join("\n");
}

/** A usage window at (or past) its limit. */
function exhausted(limits: ProviderUsageLimits | null | undefined): boolean {
  return (limits?.windows ?? []).some((window) => window.usedPercent >= 100);
}

/**
 * Who opens the request when the thread's own provider has hit its limit:
 * the first other enabled, installed provider with usage left, on its
 * default model. Null when there is none.
 */
export function handOffTarget(
  providers: readonly ProviderSummary[] | null,
  currentInstanceId: string | null,
  usage: Readonly<Record<string, ProviderUsageLimits>>,
): { instanceId: string; model: string; label: string } | null {
  for (const provider of providers ?? []) {
    if (!provider.enabled || !provider.installed || provider.instanceId === currentInstanceId) continue;
    if (exhausted(usage[provider.driver] ?? provider.usageLimits)) continue;
    const visible = provider.models.filter((model) => !model.isHidden);
    const model = visible.find((candidate) => candidate.isDefault === true) ?? visible[0];
    if (model === undefined) continue;
    return { instanceId: provider.instanceId, model: model.slug, label: model.name };
  }
  return null;
}

/** Named runs counted into the shared tally (skipped counts as passed, as the forges do). */
export function tally(runs: readonly ForgeCheckRun[]): ForgeChecks {
  return {
    passed: runs.filter((run) => run.state === "passed" || run.state === "skipped").length,
    failed: runs.filter((run) => run.state === "failed").length,
    pending: runs.filter((run) => run.state === "pending").length,
  };
}

/** "✓ 18/18", "✗ 2/18", "● 3/18": CI in one glance, and its tone. */
export function checksGlance(checks: ForgeChecks | null | undefined): { text: string; tone: "passed" | "failed" | "pending" } | null {
  if (checks == null) return null;
  const total = checks.passed + checks.failed + checks.pending;
  if (total === 0) return null;
  if (checks.failed > 0) return { text: `✗ ${checks.passed}/${total}`, tone: "failed" };
  if (checks.pending > 0) return { text: `● ${checks.passed}/${total}`, tone: "pending" };
  return { text: `✓ ${checks.passed}/${total}`, tone: "passed" };
}

/** "3 minutes ago", "yesterday", "2 months ago": how GitHub words a commit's age. */
export function ago(iso: string | null, now: number): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return unit(days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return unit(months, "month");
  return unit(Math.floor(days / 365), "year");
}
