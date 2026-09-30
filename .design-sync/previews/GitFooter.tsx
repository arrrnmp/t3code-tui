import { Terminal, Box, GitFooter, SURFACE } from "@moxen/tui";

const overview = (branch: string | null, counts: Partial<Record<"staged" | "unstaged" | "untracked" | "conflicted", number>>, root = "/home/dev/Documents/moxen") => ({
  isRepository: true,
  root,
  branch,
  status: { branch, detached: branch === null, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...counts },
  branches: [],
  commits: [],
});

const forge = (kind: "github" | "gitlab", slug: string) => ({
  kind,
  remoteUrl: `https://${kind}.com/${slug}.git`,
  host: `${kind}.com`,
  slug,
  cli: kind === "github" ? "gh" : "glab",
  installed: true,
  authenticated: true,
  reason: null,
});

/** The footer strip as the side panel pins it: inside the frame's borders, one cell of left padding, on the panel surface. */
function Strip({ width, children }: { width: number; children: unknown }) {
  return (
    <Box style={{ width: width - 2, flexDirection: "column", flexShrink: 0, paddingLeft: 1 }} backgroundColor={SURFACE.panel}>
      {children as never}
    </Box>
  );
}

/** A GitHub checkout with uncommitted work: slug, then branch and the counts in warning colour. */
export function Dirty() {
  return (
    <Terminal width={58} height={2}>
      <Strip width={60}>
        <GitFooter overview={overview("feature/git-panel", { staged: 1, unstaged: 3, untracked: 2 }) as never} forge={forge("github", "arrrnmp/moxen") as never} width={60} />
      </Strip>
    </Terminal>
  );
}

/** A clean GitLab checkout. */
export function Clean() {
  return (
    <Terminal width={58} height={2}>
      <Strip width={60}>
        <GitFooter overview={overview("main", {}) as never} forge={forge("gitlab", "moxen/tui-website") as never} width={60} />
      </Strip>
    </Terminal>
  );
}

/** No remote: the folder stands in for the slug; mid-merge with conflicts. */
export function NoRemote() {
  return (
    <Terminal width={58} height={2}>
      <Strip width={60}>
        <GitFooter overview={overview("fix/compaction-buffer", { conflicted: 2, unstaged: 1 }, "/home/dev/scratch/moxen-spike") as never} forge={null} width={60} />
      </Strip>
    </Terminal>
  );
}

/** A narrow panel: the long branch name truncates so the status keeps its place. */
export function Narrow() {
  return (
    <Terminal width={38} height={2}>
      <Strip width={40}>
        <GitFooter overview={overview("feature/opencode-v2-driver-behind-flag", { unstaged: 4 }) as never} forge={forge("github", "arrrnmp/moxen") as never} width={40} />
      </Strip>
    </Terminal>
  );
}
