import { useState } from "react";

import { useHover } from "../../hooks/useHover.js";
import { COLOR, SURFACE, truncate } from "../../theme.js";
import { Heading, usePanelWidth } from "../sidepanel/sidepanel.js";
import type { ForgeDetection, ForgeRequest, GitBranch, GitCommit, GitOverview, MergeStrategy } from "../../../server/api.js";

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

function relative(iso: string | null, now: number): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

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

function aheadBehind(branch: GitBranch): string {
  if (branch.ahead === null && branch.behind === null) return "";
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (ahead === 0 && behind === 0) return "in sync";
  return `${ahead > 0 ? `↑${ahead}` : ""}${ahead > 0 && behind > 0 ? " " : ""}${behind > 0 ? `↓${behind}` : ""}`;
}

function checksLabel(request: ForgeRequest): { text: string; color: string } | null {
  const checks = request.checks;
  if (!checks) return null;
  if (checks.failed > 0) return { text: `${checks.failed} failing`, color: COLOR.danger };
  if (checks.pending > 0) return { text: `${checks.pending} running`, color: COLOR.warn };
  if (checks.passed > 0) return { text: `${checks.passed} passed`, color: COLOR.diff };
  return null;
}

function Row({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
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

/** Commits drawn before "Show more", so a long history never buries the requests below it. */
const COMMITS_SHOWN = 12;

export function GitTab({
  overview,
  forge,
  requests,
  loadingGit,
  loadingForge,
  error,
  busy,
  selectedBranch,
  now,
  onSelectBranch,
  onRefresh,
  onCreate,
  onComment,
  onMerge,
}: {
  overview: GitOverview | null;
  forge: ForgeDetection | null;
  requests: readonly ForgeRequest[];
  loadingGit: boolean;
  loadingForge: boolean;
  error: string | null;
  busy: string | null;
  selectedBranch: string | null;
  now: number;
  onSelectBranch: (branch: string | null) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onComment: (request: ForgeRequest) => void;
  onMerge: (request: ForgeRequest, strategy: MergeStrategy) => void;
}) {
  const width = usePanelWidth();
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [armedMerge, setArmedMerge] = useState<number | null>(null);

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

  const localBranches = overview.branches.filter((branch) => !branch.remote);
  const shown = showAllBranches ? overview.branches : localBranches.slice(0, 6);
  const hiddenCount = (showAllBranches ? 0 : overview.branches.length - shown.length);
  const status = statusLine(overview);

  // Commits are three columns — sha, subject, age — sized so they sum to
  // the panel width exactly. Anything wider lets flex shrink a column and
  // eat the gap after the sha; ages flush right keep the subjects ragged
  // only on the right, where the eye expects it.
  const commits = showAllCommits ? overview.commits : overview.commits.slice(0, COMMITS_SHOWN);
  const hiddenCommits = overview.commits.length - commits.length;
  const shaWidth = Math.max(0, ...commits.map((commit) => commit.shortSha.length));
  const ages = commits.map((commit) => relative(commit.date, now));
  const ageWidth = Math.max(0, ...ages.map((age) => age.length));
  const subjectWidth = Math.max(4, width - shaWidth - 1 - (ageWidth > 0 ? ageWidth + 1 : 0));

  return (
    <box style={{ flexDirection: "column" }}>
      <Row>
        <text fg={COLOR.bright} selectable={false}>{truncate(overview.branch ?? "(detached)", Math.max(8, width - status.length - 2))}</text>
        <text fg={status === "clean" ? COLOR.faint : COLOR.warn} selectable={false}>{status ? `  ${status}` : ""}</text>
      </Row>
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
        commits.map((commit: GitCommit, index) => (
          <Row key={commit.sha}>
            <text fg={COLOR.faint} selectable={false}>{`${commit.shortSha.padEnd(shaWidth)} `}</text>
            <text fg={COLOR.text} selectable={false}>{truncate(commit.subject, subjectWidth).padEnd(subjectWidth)}</text>
            <text fg={COLOR.faint} selectable={false}>{ageWidth > 0 ? ` ${ages[index]!.padStart(ageWidth)}` : ""}</text>
          </Row>
        ))
      )}
      {hiddenCommits > 0 || (showAllCommits && overview.commits.length > COMMITS_SHOWN) ? (
        <Row onClick={() => setShowAllCommits((shownAll) => !shownAll)}>
          <text fg={COLOR.dim} selectable={false}>
            {showAllCommits ? "  Show fewer commits" : `  Show ${hiddenCommits} more`}
          </text>
        </Row>
      ) : null}

      <Heading
        text={forge?.kind === "gitlab" ? "Merge requests" : "Pull requests"}
        {...(forge?.kind == null ? {} : { meta: requests.length === 0 ? "none open" : `${requests.length} open` })}
      />
      {forge === null || forge.kind === null ? (
        <Row>
          <text fg={COLOR.dim} selectable={false}>
            {truncate(`  ${loadingForge ? "Checking…" : (forge?.reason ?? "No forge for this remote.")}`, width)}
          </text>
        </Row>
      ) : (
        <>
          {requests.length === 0 ? (
            <Row>
              <text fg={COLOR.dim} selectable={false}>{loadingForge ? "  Reading…" : "  Nothing open."}</text>
            </Row>
          ) : (
            requests.map((request) => {
              const checks = checksLabel(request);
              const armed = armedMerge === request.number;
              return (
                <box key={request.number} style={{ flexDirection: "column", flexShrink: 0 }}>
                  <Row>
                    <text fg={request.state === "draft" ? COLOR.faint : COLOR.accent} selectable={false}>
                      {`#${request.number} `}
                    </text>
                    <text fg={COLOR.text} selectable={false}>{truncate(request.title, Math.max(4, width - String(request.number).length - 2))}</text>
                  </Row>
                  <Row>
                    <text fg={COLOR.faint} selectable={false}>
                      {truncate(
                        `    ${request.author ?? "someone"} · ${request.sourceBranch ?? "?"} → ${request.targetBranch ?? "?"}`,
                        Math.max(4, width - (checks ? checks.text.length + 1 : 0)),
                      ).padEnd(Math.max(4, width - (checks ? checks.text.length + 1 : 0)))}
                    </text>
                    {checks === null ? null : <text fg={checks.color} selectable={false}>{` ${checks.text}`}</text>}
                  </Row>
                  <Row>
                    <text fg={COLOR.faint} selectable={false}>{"    "}</text>
                    <ActionLink label="comment" onClick={() => onComment(request)} disabled={busy !== null} />
                    <text fg={COLOR.faint} selectable={false}>{" · "}</text>
                    {armed ? (
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
                      <ActionLink label="merge…" onClick={() => setArmedMerge(request.number)} disabled={busy !== null} />
                    )}
                  </Row>
                </box>
              );
            })
          )}
          <Row onClick={busy === null ? onCreate : undefined}>
            <text fg={busy === null ? COLOR.accent : COLOR.faint} selectable={false}>
              {forge.kind === "gitlab" ? "  Open a merge request" : "  Open a pull request"}
            </text>
          </Row>
        </>
      )}

      <Row onClick={onRefresh}>
        <text fg={COLOR.dim} selectable={false}>{"  Refresh"}</text>
      </Row>
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
