import { Terminal, Box, FileSection, SURFACE, splitPatchByFile } from "@moxen/tui";

const [usage, logo, deep] = splitPatchByFile(
  [
    "diff --git a/src/core/usage/limits.ts b/src/core/usage/limits.ts",
    "--- a/src/core/usage/limits.ts",
    "+++ b/src/core/usage/limits.ts",
    "@@ -41,3 +41,5 @@ export function headroom(window: UsageWindow): number {",
    "   const used = window.usedTokens + window.reservedTokens;",
    "-  return Math.max(0, window.limit - used);",
    "+  // Leave the compaction buffer out of what a turn may spend.",
    "+  const budget = window.limit - window.compactionBuffer;",
    "+  return Math.max(0, budget - used);",
    " }",
    "diff --git a/assets/moxen-logo.png b/assets/moxen-logo.png",
    "Binary files a/assets/moxen-logo.png and b/assets/moxen-logo.png differ",
    "diff --git a/src/tui/features/sidepanel/tests/contexttab.test.ts b/src/tui/features/sidepanel/tests/contexttab.test.ts",
    "--- a/src/tui/features/sidepanel/tests/contexttab.test.ts",
    "+++ b/src/tui/features/sidepanel/tests/contexttab.test.ts",
    "@@ -12,1 +12,2 @@",
    "   expect(bar.segments).toHaveLength(4);",
    "+  expect(bar.buffer).toBe(12_000);",
  ].join("\n"),
);

const noop = () => {};

/** The row width the diff panel gives a file (panel width minus its border), on the panel surface. */
function Pane({ children }: { children: unknown }) {
  return <Box style={{ width: 58, flexDirection: "column", flexGrow: 1 }} backgroundColor={SURFACE.panel}>{children as never}</Box>;
}

/** An open TypeScript file, selected: marker, header counts, then the unified hunk with line numbers. */
export function Open() {
  return (
    <Terminal width={58} height={10}>
      <Pane>
        <FileSection file={usage!} width={58} selected collapsed={false} onToggle={noop} />
      </Pane>
    </Terminal>
  );
}

/** Folded to its header; a path too long for the row is shortened from the left. */
export function Folded() {
  return (
    <Terminal width={58} height={4}>
      <Pane>
        <FileSection file={usage!} width={58} selected={false} collapsed onToggle={noop} />
        <FileSection file={deep!} width={58} selected={false} collapsed onToggle={noop} />
      </Pane>
    </Terminal>
  );
}

/** A binary file has no hunks to show. */
export function Binary() {
  return (
    <Terminal width={58} height={3}>
      <Pane>
        <FileSection file={logo!} width={58} selected={false} collapsed={false} onToggle={noop} />
      </Pane>
    </Terminal>
  );
}
