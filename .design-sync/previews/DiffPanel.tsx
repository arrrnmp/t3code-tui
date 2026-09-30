import { Terminal, Box, DiffPanel, SideTabBar, splitPatchByFile } from "@moxen/tui";

const patch = [
  "diff --git a/src/core/git/branches.ts b/src/core/git/branches.ts",
  "--- a/src/core/git/branches.ts",
  "+++ b/src/core/git/branches.ts",
  "@@ -18,4 +18,8 @@ export async function listBranches(root: string) {",
  "   const lines = await git(root, [\"for-each-ref\", FORMAT, \"refs/heads\"]);",
  "-  return lines.map(parseBranch);",
  "+  const branches = lines.map(parseBranch);",
  "+  // Current first, then most recently committed.",
  "+  return branches.sort(byRecency);",
  " }",
  " ",
  "+const byRecency = (a: GitBranch, b: GitBranch) =>",
  "+  Number(b.current) - Number(a.current);",
  "diff --git a/src/tui/features/gitpanel/gitpanel.tsx b/src/tui/features/gitpanel/gitpanel.tsx",
  "--- a/src/tui/features/gitpanel/gitpanel.tsx",
  "+++ b/src/tui/features/gitpanel/gitpanel.tsx",
  "@@ -96,7 +96,7 @@",
  "-const COMMITS_SHOWN = 20;",
  "+const COMMITS_SHOWN = 12;",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -40,1 +40,2 @@",
  " ## Side panel",
  "+The Git tab lists branches, history and the branch's PR.",
  "",
].join("\n");

const files = splitPatchByFile(patch);
const noop = () => {};
const handlers = { onToggleFile: noop, onFocus: noop, onHeaderClick: noop };

/** Wraps the panel the way the app does: the tab strip seated in the frame's top line, the pane stretched to full height by a row. */
function Seat({ children }: { children: unknown }) {
  return (
    <Box style={{ width: 60, flexDirection: "column", flexShrink: 0, flexGrow: 1 }}>
      <SideTabBar tab="diff" badges={{ diff: "3", background: "1" }} onTab={noop} onClose={noop} focused left={2} width={56} />
      <Box style={{ flexDirection: "row", flexGrow: 1 }}>{children as never}</Box>
    </Box>
  );
}

/** A turn's patch, file by file: the selected file marked, a folded one, and the +/− footer. */
export function TurnDiff() {
  return (
    <Terminal width={60} height={28}>
      <Seat>
        <DiffPanel files={files} loading={false} fileIndex={0} collapsed={new Set(["src/tui/features/gitpanel/gitpanel.tsx"])} width={60} height={28} turnCount={7} turnTotal={3} focused scrollRef={{ current: null }} {...handlers} />
      </Seat>
    </Terminal>
  );
}

/** Every file folded to its header, unfocused. */
export function AllFolded() {
  return (
    <Terminal width={60} height={12}>
      <Seat>
        <DiffPanel files={files} loading={false} fileIndex={2} collapsed={new Set(files.map((file) => file.path))} width={60} height={12} turnCount={7} turnTotal={3} focused={false} scrollRef={{ current: null }} {...handlers} />
      </Seat>
    </Terminal>
  );
}

/** A turn that touched no files. */
export function NoChanges() {
  return (
    <Terminal width={60} height={8}>
      <Seat>
        <DiffPanel files={[]} loading={false} fileIndex={0} collapsed={new Set()} width={60} height={8} turnCount={2} turnTotal={1} focused={false} scrollRef={{ current: null }} {...handlers} />
      </Seat>
    </Terminal>
  );
}
