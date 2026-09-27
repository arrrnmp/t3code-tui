import { useMemo, useState, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";

import { useHover } from "../../hooks/useHover.js";
import { COLOR, SURFACE, truncate } from "../../theme.js";
import { Heading, usePanelWidth } from "../sidepanel/sidepanel.js";
import { FileSection } from "../diffpanel/diffpanel.js";
import { splitPatchByFile } from "../../model/patch.js";
import { ago, checksGlance, requestNoun, tally } from "../../model/gitpanel.js";
import type { OpenCommit } from "./useGitPanel.js";
import type {
  ForgeCheckRun,
  ForgeChecks,
  ForgeDetection,
  ForgeRequest,
  ForgeRequestStatus,
  GitBranch,
  GitCommit,
  GitOverview,
  MergeStrategy,
} from "../../../server/api.js";

/**
 * The Git tab: what this thread's checkout looks like, and what is open
 * against it on the forge.
 *
 * Read-heavy by design. The three write actions (open, comment, merge) go
 * through a confirm step in the tab itself rather than firing on a
 * single click, because they are visible to other people the moment they
 * land and a side panel is an easy thing to misclick. Merge in particular
 * arms first and states the strategy, in the same spirit as the delete
 * and revert affordances elsewhere.
 */

function statusLine(overview: GitOverview): string {
  const status = overview.status;
  if (!status) return "";
  const parts: string[] = [];
  if (status.staged > 0) parts.push(`${status.staged} staged`);
  if (status.unstaged > 0) parts.push(`${status.unstaged} changed`);
  if (status.untracked > 0) parts.push(`${status.untracked} untracked`);
  if (status.conflicted > 0) parts.push(`${status.conflicted} conflicted`);
  return parts.length === 0 ? "clean" : parts.join(" · ");
}

/**
 * The Git tab's pinned footer: where the checkout lives (the forge slug, or
 * the folder), and under it the branch and what is uncommitted — status
 * that should stay in view however far the history scrolls.
 */
export function GitFooter({ overview, forge, width }: { overview: GitOverview | null; forge: ForgeDetection | null; width: number }) {
  const inner = Math.max(10, width - 5);
  const where = forge?.slug ?? overview?.root ?? "no remote";
  const status = overview === null || !overview.isRepository ? "" : statusLine(overview);
  const branch = overview === null || !overview.isRepository ? null : (overview.status?.branch ?? overview.branch ?? "(detached)");
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }} backgroundColor={SURFACE.panel}>
      <text fg={COLOR.dim} bg={SURFACE.panel} selectable={false}>{truncate(where, inner)}</text>
      {branch === null ? null : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
          <text fg={COLOR.bright} bg={SURFACE.panel} selectable={false}>{truncate(branch, Math.max(8, inner - status.length - 3))}</text>
          <text fg={status === "clean" ? COLOR.faint : COLOR.warn} bg={SURFACE.panel} selectable={false}>{status ? ` · ${status}` : ""}</text>
        </box>
      )}
    </box>
  );
}

function aheadBehind(branch: GitBranch): string {
  if (branch.ahead === null && branch.behind === null) return "";
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (ahead === 0 && behind === 0) return "in sync";
  return `${ahead > 0 ? `↑${ahead}` : ""}${ahead > 0 && behind > 0 ? " " : ""}${behind > 0 ? `↓${behind}` : ""}`;
}

function Row({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  active?: boolean;
}) {
  const { hovered, handlers } = useHover();
  const interactive = onClick !== undefined;
  const bg = active === true ? SURFACE.hover : interactive && hovered ? SURFACE.border : undefined;
  return (
    <box
      style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
      {...(bg === undefined ? {} : { backgroundColor: bg })}
      {...(interactive ? { onMouseDown: onClick, selectable: false, ...handlers } : {})}
    >
      {children}
    </box>
  );
}

/** Commits drawn before "Show more", so a long history never buries the rest of the tab. */
const COMMITS_SHOWN = 12;
/** CI runs listed under the current request before "+N more". */
const RUNS_SHOWN = 6;

const TONE: Record<"passed" | "failed" | "pending", string> = { passed: COLOR.added, failed: COLOR.danger, pending: COLOR.warn };

function runGlyph(state: ForgeCheckRun["state"]): { glyph: string; color: string } {
  if (state === "failed") return { glyph: "✗", color: COLOR.danger };
  if (state === "pending") return { glyph: "●", color: COLOR.warn };
  if (state === "skipped") return { glyph: "◌", color: COLOR.faint };
  return { glyph: "✓", color: COLOR.added };
}

function stateLabel(state: ForgeRequest["state"]): { text: string; color: string } {
  if (state === "draft") return { text: "Draft", color: COLOR.dim };
  if (state === "merged") return { text: "Merged", color: COLOR.diff };
  if (state === "closed") return { text: "Closed", color: COLOR.danger };
  return { text: "Open", color: COLOR.added };
}

function reviewLabel(decision: string | null): { text: string; color: string } | null {
  if (decision === "APPROVED") return { text: "approved", color: COLOR.added };
  if (decision === "CHANGES_REQUESTED") return { text: "changes requested", color: COLOR.danger };
  if (decision === "REVIEW_REQUIRED") return { text: "review required", color: COLOR.warn };
  return null;
}

/** CI runs, failures first so the reason a PR is red is the first thing read. */
function RunList({ runs, width }: { runs: readonly ForgeCheckRun[]; width: number }) {
  const [all, setAll] = useState(false);
  const order: Record<ForgeCheckRun["state"], number> = { failed: 0, pending: 1, passed: 2, skipped: 3 };
  const sorted = [...runs].sort((left, right) => order[left.state] - order[right.state]);
  const shown = all ? sorted : sorted.slice(0, RUNS_SHOWN);
  return (
    <>
      {shown.map((run, index) => {
        const mark = runGlyph(run.state);
        return (
          <Row key={`${run.name}:${index}`}>
            <text fg={mark.color} selectable={false}>{`  ${mark.glyph} `}</text>
            <text fg={run.state === "failed" ? COLOR.text : COLOR.dim} selectable={false}>{truncate(run.name, Math.max(4, width - 4))}</text>
          </Row>
        );
      })}
      {sorted.length > RUNS_SHOWN ? (
        <Row onClick={() => setAll((shownAll) => !shownAll)}>
          <text fg={COLOR.dim} selectable={false}>{all ? "    Show fewer" : `    +${sorted.length - RUNS_SHOWN} more`}</text>
        </Row>
      ) : null}
    </>
  );
}

/** Who opens a request when the agent is asked: the thread's own, or another while it is at its limit. */
export interface RequestOpener {
  /** "the agent", or e.g. "Codex (Claude is at its limit)"; null when nobody can. */
  readonly label: string | null;
}

export function GitTab({
  overview,
  forge,
  requests,
  status,
  commitChecks,
  commit,
  loadingGit,
  loadingForge,
  error,
  busy,
  selectedBranch,
  now,
  opener,
  onSelectBranch,
  onRefresh,
  onAgentOpen,
  onCreate,
  onComment,
  onMerge,
  onOpenCommit,
  onCloseCommit,
  onOpenUrl,
}: {
  overview: GitOverview | null;
  forge: ForgeDetection | null;
  requests: readonly ForgeRequest[];
  status: ForgeRequestStatus | null;
  commitChecks: Readonly<Record<string, ForgeChecks>>;
  commit: OpenCommit | null;
  loadingGit: boolean;
  loadingForge: boolean;
  error: string | null;
  busy: string | null;
  selectedBranch: string | null;
  now: number;
  opener: RequestOpener;
  onSelectBranch: (branch: string | null) => void;
  onRefresh: () => void;
  /** Ask an agent to open the request (a draft, or ready for review). */
  onAgentOpen: (draft: boolean) => void;
  /** Open it by hand: asks for a title. */
  onCreate: (draft: boolean) => void;
  onComment: (request: ForgeRequest) => void;
  onMerge: (request: ForgeRequest, strategy: MergeStrategy) => void;
  onOpenCommit: (sha: string) => void;
  onCloseCommit: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const width = usePanelWidth();
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [armedMerge, setArmedMerge] = useState<number | null>(null);

  if (commit !== null) return <CommitView commit={commit} width={width} now={now} onBack={onCloseCommit} onOpenUrl={onOpenUrl} />;

  if (overview === null) {
    return (
      <box style={{ flexDirection: "column" }}>
        <text fg={COLOR.dim} selectable={false}>{loadingGit ? "Reading git…" : (error ?? "No git information.")}</text>
      </box>
    );
  }
  if (!overview.isRepository) {
    return (
      <box style={{ flexDirection: "column" }}>
        <text fg={COLOR.dim} selectable={false}>{"This thread's folder is not a git repository."}</text>
      </box>
    );
  }

  const noun = requestNoun(forge?.kind ?? null);
  const checkedOut = overview.status?.branch ?? null;
  const localBranches = overview.branches.filter((branch) => !branch.remote);
  const shown = showAllBranches ? overview.branches : localBranches.slice(0, 6);
  const hiddenCount = (showAllBranches ? 0 : overview.branches.length - shown.length);
  const others = requests.filter((request) => request.number !== status?.number);

  const commits = showAllCommits ? overview.commits : overview.commits.slice(0, COMMITS_SHOWN);
  const hiddenCommits = overview.commits.length - commits.length;

  const mergeActions = (request: ForgeRequest) =>
    armedMerge === request.number ? (
      <>
        <ActionLink
          label="squash"
          tone={COLOR.warn}
          onClick={() => {
            setArmedMerge(null);
            onMerge(request, "squash");
          }}
          disabled={busy !== null}
        />
        <text fg={COLOR.faint} selectable={false}>{" · "}</text>
        <ActionLink
          label="merge commit"
          tone={COLOR.warn}
          onClick={() => {
            setArmedMerge(null);
            onMerge(request, "merge");
          }}
          disabled={busy !== null}
        />
        <text fg={COLOR.faint} selectable={false}>{" · "}</text>
        <ActionLink label="cancel" onClick={() => setArmedMerge(null)} disabled={false} />
      </>
    ) : (
      <ActionLink label="merge…" onClick={() => setArmedMerge(request.number)} disabled={busy !== null || request.state === "draft"} />
    );

  return (
    <box style={{ flexDirection: "column" }}>
      {error === null ? null : (
        <Row>
          <text fg={COLOR.danger} selectable={false}>{truncate(error, width)}</text>
        </Row>
      )}
      {busy === null ? null : (
        <Row>
          <text fg={COLOR.warn} selectable={false}>{busy}</text>
        </Row>
      )}

      <Heading text={forge?.kind === "gitlab" ? "Merge request" : "Pull request"} {...(checkedOut === null ? {} : { meta: truncate(checkedOut, Math.max(4, width - 18)) })} />
      {forge === null || forge.kind === null ? (
        <Row>
          <text fg={COLOR.dim} selectable={false}>
            {truncate(`  ${loadingForge ? "Checking…" : (forge?.reason ?? "No forge for this remote.")}`, width)}
          </text>
        </Row>
      ) : status !== null ? (
        <RequestCard
          request={status}
          width={width}
          actions={
            <>
              {status.url === null ? null : (
                <>
                  <ActionLink label="open ↗" onClick={() => onOpenUrl(status.url!)} disabled={false} />
                  <text fg={COLOR.faint} selectable={false}>{" · "}</text>
                </>
              )}
              {status.state === "open" || status.state === "draft" ? (
                <>
                  <ActionLink label="comment" onClick={() => onComment(status)} disabled={busy !== null} />
                  <text fg={COLOR.faint} selectable={false}>{" · "}</text>
                  {mergeActions(status)}
                </>
              ) : null}
            </>
          }
        />
      ) : loadingForge ? (
        <Row>
          <text fg={COLOR.dim} selectable={false}>{"  Reading…"}</text>
        </Row>
      ) : (
        <>
          <Row>
            <text fg={COLOR.dim} selectable={false}>{truncate(`  No ${noun.short} for ${checkedOut ?? "this checkout"} yet.`, width)}</text>
          </Row>
          {opener.label === null ? (
            <Row>
              <text fg={COLOR.faint} selectable={false}>{truncate("  No agent has usage left to open one.", width)}</text>
            </Row>
          ) : (
            <>
              <Row onClick={busy === null ? () => onAgentOpen(true) : undefined}>
                <text fg={COLOR.accent} selectable={false}>{truncate(`  ✦ Have ${opener.label} open a draft ${noun.short}`, width)}</text>
              </Row>
              <Row onClick={busy === null ? () => onAgentOpen(false) : undefined}>
                <text fg={COLOR.text} selectable={false}>{truncate(`  ✦ Have ${opener.label} open it ready for review`, width)}</text>
              </Row>
            </>
          )}
          <Row onClick={busy === null ? () => onCreate(true) : undefined}>
            <text fg={COLOR.dim} selectable={false}>{truncate(`    or open a draft ${noun.short} yourself…`, width)}</text>
          </Row>
        </>
      )}
      {forge?.kind == null || others.length === 0 ? null : (
        <>
          <Heading text={`Other open ${noun.short}s`} meta={String(others.length)} />
          {others.map((request) => {
            const glance = checksGlance(request.checks);
            const tail = glance === null ? "" : ` ${glance.text}`;
            const titleWidth = Math.max(4, width - String(request.number).length - 2 - tail.length);
            return (
              <Row key={request.number} {...(request.url === null ? {} : { onClick: () => onOpenUrl(request.url!) })}>
                <text fg={request.state === "draft" ? COLOR.faint : COLOR.accent} selectable={false}>{`#${request.number} `}</text>
                <text fg={COLOR.text} selectable={false}>{truncate(request.title, titleWidth).padEnd(titleWidth)}</text>
                {glance === null ? null : <text fg={TONE[glance.tone]} selectable={false}>{tail}</text>}
              </Row>
            );
          })}
        </>
      )}

      <Heading text="Branches" meta={`${localBranches.length} local`} />
      {shown.map((branch) => {
        const track = aheadBehind(branch);
        const nameWidth = Math.max(4, width - (track ? track.length + 1 : 0));
        const active = (selectedBranch ?? overview.branch) === branch.name;
        return (
          <Row key={branch.name} onClick={() => onSelectBranch(branch.name === overview.branch ? null : branch.name)} active={active}>
            <text fg={branch.current ? COLOR.bright : branch.remote ? COLOR.dim : COLOR.text} selectable={false}>
              {truncate(`${branch.current ? "* " : "  "}${branch.name}`, nameWidth).padEnd(nameWidth)}
            </text>
            <text fg={track === "in sync" ? COLOR.faint : COLOR.warn} selectable={false}>{track ? ` ${track}` : ""}</text>
          </Row>
        );
      })}
      {hiddenCount > 0 || showAllBranches ? (
        <Row onClick={() => setShowAllBranches((shownAll) => !shownAll)}>
          <text fg={COLOR.dim} selectable={false}>
            {showAllBranches ? "  Show fewer branches" : `  Show ${hiddenCount} more (remotes included)`}
          </text>
        </Row>
      ) : null}

      <Heading text="Commits" meta={truncate(selectedBranch ?? overview.branch ?? "detached", Math.max(4, width - 12))} />
      {overview.commits.length === 0 ? (
        <Row>
          <text fg={COLOR.dim} selectable={false}>{loadingGit ? "  Reading…" : "  No commits."}</text>
        </Row>
      ) : (
        commits.map((entry: GitCommit) => (
          <CommitRow key={entry.sha} commit={entry} checks={commitChecks[entry.sha] ?? null} width={width} now={now} onOpen={() => onOpenCommit(entry.sha)} />
        ))
      )}
      {hiddenCommits > 0 || (showAllCommits && overview.commits.length > COMMITS_SHOWN) ? (
        <Row onClick={() => setShowAllCommits((shownAll) => !shownAll)}>
          <text fg={COLOR.dim} selectable={false}>
            {showAllCommits ? "  Show fewer commits" : `  Show ${hiddenCommits} more`}
          </text>
        </Row>
      ) : null}

      <Row onClick={onRefresh}>
        <text fg={COLOR.dim} selectable={false}>{"  Refresh"}</text>
      </Row>
    </box>
  );
}

/** The branch's own request: title, where it stands, its CI, its size, and what can be done with it. */
function RequestCard({ request, width, actions }: { request: ForgeRequestStatus; width: number; actions: ReactNode }) {
  const state = stateLabel(request.state);
  const review = reviewLabel(request.reviewDecision);
  const glance = checksGlance(request.checks ?? (request.runs.length > 0 ? tally(request.runs) : null));
  const hasSize = request.additions !== null || request.deletions !== null || request.changedFiles !== null;
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={COLOR.accent} selectable={false}>{`#${request.number} `}</text>
        <text fg={COLOR.bright} wrapMode="word">{request.title}</text>
      </box>
      <Row>
        <text fg={state.color} selectable={false}>{state.text}</text>
        {review === null ? null : (
          <>
            <text fg={COLOR.faint} selectable={false}>{" · "}</text>
            <text fg={review.color} selectable={false}>{review.text}</text>
          </>
        )}
        {request.mergeable === "conflicting" ? <text fg={COLOR.danger} selectable={false}>{" · conflicts"}</text> : null}
        {request.targetBranch === null ? null : <text fg={COLOR.faint} selectable={false}>{truncate(` · into ${request.targetBranch}`, Math.max(0, width - 30))}</text>}
      </Row>
      {hasSize ? (
        <Row>
          {request.additions === null ? null : <text fg={COLOR.added} selectable={false}>{`+${request.additions} `}</text>}
          {request.deletions === null ? null : <text fg={COLOR.removed} selectable={false}>{`−${request.deletions} `}</text>}
          {request.changedFiles === null ? null : (
            <text fg={COLOR.dim} selectable={false}>{`${request.additions === null && request.deletions === null ? "" : "· "}${request.changedFiles} file${request.changedFiles === 1 ? "" : "s"}`}</text>
          )}
        </Row>
      ) : null}
      {glance === null ? (
        <Row>
          <text fg={COLOR.faint} selectable={false}>{"No CI checks"}</text>
        </Row>
      ) : (
        <>
          <Row>
            <text fg={TONE[glance.tone]} selectable={false}>{glance.text}</text>
            <text fg={COLOR.dim} selectable={false}>{glance.tone === "passed" ? " checks passed" : glance.tone === "failed" ? " checks, some failing" : " checks, some running"}</text>
          </Row>
          <RunList runs={request.runs} width={width} />
        </>
      )}
      <Row>{actions}</Row>
    </box>
  );
}

/** A commit as GitHub lists one: the subject, then who and when, CI, and the short sha on the right. */
function CommitRow({
  commit,
  checks,
  width,
  now,
  onOpen,
}: {
  commit: GitCommit;
  checks: ForgeChecks | null;
  width: number;
  now: number;
  onOpen: () => void;
}) {
  const { hovered, handlers } = useHover();
  const bg = hovered ? SURFACE.border : SURFACE.panel;
  const glance = checksGlance(checks);
  const when = ago(commit.date, now);
  const meta = `${commit.author}${when ? ` · ${when}` : ""}`;
  const tail = glance === null ? "" : ` · ${glance.text}`;
  const shaWidth = commit.shortSha.length + 1;
  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }} backgroundColor={bg} onMouseDown={onOpen} selectable={false} {...handlers}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={bg}>
        <text fg={hovered ? COLOR.bright : COLOR.text} bg={bg} selectable={false}>{truncate(commit.subject, Math.max(4, width - shaWidth)).padEnd(Math.max(4, width - shaWidth))}</text>
        <text fg={COLOR.faint} bg={bg} selectable={false}>{` ${commit.shortSha}`}</text>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={bg}>
        <text fg={COLOR.dim} bg={bg} selectable={false}>{truncate(meta, Math.max(4, width - tail.length))}</text>
        {glance === null ? null : (
          <>
            <text fg={COLOR.faint} bg={bg} selectable={false}>{" · "}</text>
            <text fg={TONE[glance.tone]} bg={bg} selectable={false}>{glance.text}</text>
          </>
        )}
      </box>
    </box>
  );
}

/** One commit, in full: message, people, CI, and the patch file by file. */
function CommitView({
  commit,
  width,
  now,
  onBack,
  onOpenUrl,
}: {
  commit: OpenCommit;
  width: number;
  now: number;
  onBack: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const detail = commit.detail;
  const files = useMemo(() => (detail?.diff == null ? [] : splitPatchByFile(detail.diff)), [detail]);
  const added = detail?.files.reduce((sum, file) => sum + (file.added ?? 0), 0) ?? 0;
  const removed = detail?.files.reduce((sum, file) => sum + (file.removed ?? 0), 0) ?? 0;
  return (
    <box style={{ flexDirection: "column" }}>
      <Row onClick={onBack}>
        <text fg={COLOR.accent} selectable={false}>{"‹ Commits"}</text>
      </Row>
      {detail === null ? (
        <Row>
          <text fg={COLOR.dim} selectable={false}>{commit.loading ? "  Reading the commit…" : "  Git could not read this commit."}</text>
        </Row>
      ) : (
        <>
          <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
            <text fg={COLOR.bright} attributes={TextAttributes.BOLD} wrapMode="word">{detail.subject}</text>
            {detail.body.length === 0 ? null : <text fg={COLOR.text} wrapMode="word">{`\n${detail.body}`}</text>}
          </box>
          <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
            <Row>
              <text fg={COLOR.text} selectable={false}>{detail.author}</text>
              <text fg={COLOR.dim} selectable={false}>{` authored ${ago(detail.date, now)}`}</text>
            </Row>
            {detail.committer === detail.author ? null : (
              <Row>
                <text fg={COLOR.text} selectable={false}>{detail.committer}</text>
                <text fg={COLOR.dim} selectable={false}>{` committed ${ago(detail.committerDate, now)}`}</text>
              </Row>
            )}
            <text fg={COLOR.faint}>{detail.sha}</text>
            {detail.parents.length === 0 ? null : (
              <text fg={COLOR.faint} selectable={false}>{truncate(`${detail.parents.length > 1 ? "parents" : "parent"} ${detail.parents.map((parent) => parent.slice(0, 7)).join(" ")}`, width)}</text>
            )}
            {detail.refs.length === 0 ? null : <text fg={COLOR.diff} selectable={false}>{truncate(detail.refs.join(", "), width)}</text>}
          </box>
          {commit.runs === null || commit.runs.length === 0 ? null : (
            <>
              <Heading text="Checks" meta={checksGlance(tally(commit.runs))?.text ?? ""} />
              <RunList runs={commit.runs} width={width} />
              {commit.runs.find((run) => run.state === "failed" && run.url !== null) === undefined ? null : (
                <Row>
                  <ActionLink label="  open the failing run ↗" onClick={() => onOpenUrl(commit.runs!.find((run) => run.state === "failed" && run.url !== null)!.url!)} disabled={false} />
                </Row>
              )}
            </>
          )}
          <Heading text="Files" meta={`${detail.files.length} · +${added} −${removed}`} />
          {files.length === 0 ? (
            <Row>
              <text fg={COLOR.dim} selectable={false}>{"  No changes to show."}</text>
            </Row>
          ) : (
            files.map((file) => (
              <FileSection
                key={file.path}
                file={file}
                width={width}
                selected={false}
                collapsed={collapsed.has(file.path)}
                onToggle={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  })
                }
              />
            ))
          )}
        </>
      )}
    </box>
  );
}

function ActionLink({
  label,
  onClick,
  disabled,
  tone = COLOR.dim,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: string;
}) {
  const { hovered, handlers } = useHover();
  if (disabled) return <text fg={COLOR.faint} selectable={false}>{label}</text>;
  return (
    <text fg={hovered ? COLOR.bright : tone} selectable={false} onMouseDown={onClick} {...handlers}>
      {label}
    </text>
  );
}
