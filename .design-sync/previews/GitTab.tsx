import { Terminal, Box, GitTab, GitFooter, SidePanelFrame, SideTabBar } from "@moxen/tui";

const now = Date.parse("2026-09-25T10:00:00.000Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const commit = (shortSha: string, subject: string, author: string, minutes: number) => ({
  // A full-length sha that reads like one: the short sha plus a deterministic hex tail.
  sha: (shortSha + [...(shortSha + "moxen-git-panel").repeat(3)].map((c) => (c.charCodeAt(0) * 7 % 16).toString(16)).join("")).slice(0, 40),
  shortSha,
  author,
  authorEmail: `${author.toLowerCase()}@moxen.dev`,
  date: ago(minutes),
  subject,
  refs: [] as string[],
});

const commits = [
  commit("9f3c2a1", "Git tab: cap history behind Show more", "Aaron", 25),
  commit("41be07d", "Pin the branch and status in the tab footer", "Aaron", 180),
  commit("c7d19e4", "forge: read PR checks through gh pr checks", "Claude", 1_500),
  commit("2a8f6b0", "Add read-only git history under core/git", "Claude", 2_900),
  commit("e05d3c9", "Merge pull request #38 from arrrnmp/ctx-tab", "Aaron", 4_400),
];

const branch = (name: string, extra: Record<string, unknown>) => ({
  name,
  current: false,
  remote: false,
  upstream: `origin/${name}`,
  ahead: 0,
  behind: 0,
  lastCommitDate: ago(60),
  lastCommitSubject: "",
  ...extra,
});

const overview = {
  isRepository: true,
  root: "/home/dev/Documents/moxen",
  branch: "feature/git-panel",
  status: { branch: "feature/git-panel", detached: false, staged: 1, unstaged: 3, untracked: 2, conflicted: 0 },
  branches: [
    branch("feature/git-panel", { current: true, ahead: 2 }),
    branch("main", { behind: 4 }),
    branch("fix/compaction-buffer", { ahead: 1, behind: 3 }),
    branch("spike/opencode-v2", { upstream: null, ahead: null, behind: null }),
    branch("origin/main", { remote: true, upstream: null, ahead: null, behind: null }),
  ],
  commits,
};

const github = {
  kind: "github",
  remoteUrl: "https://github.com/arrrnmp/moxen.git",
  host: "github.com",
  slug: "arrrnmp/moxen",
  cli: "gh",
  installed: true,
  authenticated: true,
  reason: null,
};

const request = (number: number, title: string, sourceBranch: string, extra: Record<string, unknown> = {}) => ({
  number,
  title,
  state: "open",
  author: "arrrnmp",
  sourceBranch,
  targetBranch: "main",
  url: `https://github.com/arrrnmp/moxen/pull/${number}`,
  createdAt: ago(600),
  updatedAt: ago(30),
  reviewDecision: null,
  checks: null,
  ...extra,
});

const requests = [
  request(41, "Add the Git side panel", "feature/git-panel", { reviewDecision: "APPROVED" }),
  request(43, "Leave the compaction buffer out of turn headroom", "fix/compaction-buffer", { checks: { passed: 7, failed: 0, pending: 0 } }),
  request(44, "opencode v2 driver behind a flag", "spike/opencode-v2", { state: "draft", checks: { passed: 3, failed: 0, pending: 4 } }),
];

const status = {
  ...requests[0]!,
  checks: { passed: 6, failed: 1, pending: 1 },
  runs: [
    { name: "build (ubuntu-latest)", state: "passed", url: null },
    { name: "typecheck", state: "passed", url: null },
    { name: "lint", state: "failed", url: "https://github.com/arrrnmp/moxen/actions/runs/1" },
    { name: "render-check", state: "pending", url: null },
    { name: "test (macos-latest)", state: "passed", url: null },
    { name: "test (windows-latest)", state: "passed", url: null },
    { name: "envelopes", state: "passed", url: null },
    { name: "codeql", state: "skipped", url: null },
  ],
  mergeable: "mergeable",
  additions: 412,
  deletions: 58,
  changedFiles: 9,
};

const openCommit = {
  sha: commits[1]!.sha,
  loading: false,
  runs: [
    { name: "build (ubuntu-latest)", state: "passed", url: null },
    { name: "lint", state: "failed", url: "https://github.com/arrrnmp/moxen/actions/runs/2" },
    { name: "typecheck", state: "passed", url: null },
  ],
  detail: {
    ...commits[1]!,
    body: "The branch and uncommitted counts stay in view however far the history scrolls.",
    committer: "GitHub",
    committerEmail: "noreply@github.com",
    committerDate: ago(170),
    parents: [commits[2]!.sha],
    refs: ["origin/feature/git-panel"],
    files: [{ path: "src/tui/features/gitpanel/gitpanel.tsx", added: 3, removed: 1 }],
    diff: [
      "diff --git a/src/tui/features/gitpanel/gitpanel.tsx b/src/tui/features/gitpanel/gitpanel.tsx",
      "--- a/src/tui/features/gitpanel/gitpanel.tsx",
      "+++ b/src/tui/features/gitpanel/gitpanel.tsx",
      "@@ -52,2 +52,4 @@ export function GitFooter({ overview, forge, width }) {",
      "   const inner = Math.max(10, width - 5);",
      "-  const where = overview?.root ?? \"no remote\";",
      "+  const where = forge?.slug ?? overview?.root ?? \"no remote\";",
      "+  const status = statusLine(overview);",
      "+  const branch = overview.status?.branch ?? \"(detached)\";",
      "",
    ].join("\n"),
  },
};

const noop = () => {};
const base = {
  overview,
  forge: github,
  requests,
  status,
  commitChecks: {
    [commits[0]!.sha]: { passed: 6, failed: 1, pending: 1 },
    [commits[1]!.sha]: { passed: 7, failed: 1, pending: 0 },
    [commits[2]!.sha]: { passed: 8, failed: 0, pending: 0 },
  },
  commit: null,
  loadingGit: false,
  loadingForge: false,
  error: null,
  busy: null,
  selectedBranch: null,
  now,
  opener: { label: "the agent" },
  onSelectBranch: noop,
  onRefresh: noop,
  onAgentOpen: noop,
  onCreate: noop,
  onComment: noop,
  onMerge: noop,
  onOpenCommit: noop,
  onCloseCommit: noop,
  onOpenUrl: noop,
};

/** The app's side column: the tab strip seated in the frame's top line, the Git footer pinned under the scrolling tab. */
function Panel({ height, forge = github, tab }: { height: number; forge?: unknown; tab: unknown }) {
  return (
    <Box style={{ flexDirection: "row", flexGrow: 1 }}>
      <Box style={{ width: 60, flexDirection: "column", flexShrink: 0 }}>
        <SideTabBar tab="git" badges={{ diff: "3" }} onTab={noop} onClose={noop} focused left={2} width={56} />
        <SidePanelFrame width={60} height={height} focused scrollRef={{ current: null }} onFocus={noop} footer={<GitFooter overview={overview as never} forge={forge as never} width={60} />}>
          {tab as never}
        </SidePanelFrame>
      </Box>
    </Box>
  );
}

/** The branch's PR: review state, size, CI with the failing run first, then other PRs, branches and history. */
export function PullRequest() {
  return (
    <Terminal width={60} height={36}>
      <Panel height={36} tab={<GitTab {...(base as any)} />} />
    </Terminal>
  );
}

/** No PR for the branch yet: have the agent open one, or open it yourself. */
export function NoRequest() {
  return (
    <Terminal width={60} height={20}>
      <Panel height={20} tab={<GitTab {...(base as any)} status={null} requests={[]} />} />
    </Terminal>
  );
}

/** One commit opened from the history: message, people, its CI, and the patch file by file. */
export function CommitView() {
  return (
    <Terminal width={60} height={30}>
      <Panel height={30} tab={<GitTab {...(base as any)} commit={openCommit} />} />
    </Terminal>
  );
}

/** No forge CLI: local branches and history still show, with the reason. */
export function NoForge() {
  const forge = { ...github, kind: null, installed: false, authenticated: false, reason: "gh is not installed — install GitHub CLI to see PRs." };
  return (
    <Terminal width={60} height={20}>
      <Panel height={20} forge={forge} tab={<GitTab {...(base as any)} forge={forge} status={null} requests={[]} commitChecks={{}} />} />
    </Terminal>
  );
}
