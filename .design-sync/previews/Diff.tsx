import { Terminal, Box, Diff, COLOR, SURFACE, DIFF_BG, markdownSyntaxStyle } from "@moxen/tui";

const patch = [
  "--- a/src/tui/theme.ts",
  "+++ b/src/tui/theme.ts",
  "@@ -118,5 +118,6 @@ export function rule(width: number): string {",
  " export function truncate(value: string, width: number): string {",
  "-  if (width < 0) return \"\";",
  "-  return value.slice(0, width);",
  "+  if (width <= 0) return \"\";",
  "+  if (value.length <= width) return value;",
  "+  return `${value.slice(0, Math.max(0, width - 1))}…`;",
  " }",
  " ",
].join("\n");


/** A unified diff coloured from DIFF_BG, as the diff panel shows it. */
export function Unified() {
  return (
    <Terminal width={72} height={10}>
      <Box backgroundColor={SURFACE.panel} style={{ flexGrow: 1, paddingTop: 1 }}>
        <Diff
          diff={patch}
          view="unified"
          filetype="typescript"
          syntaxStyle={markdownSyntaxStyle()}
          fg={COLOR.text}
          showLineNumbers
          wrapMode="none"
          addedBg={DIFF_BG.added}
          removedBg={DIFF_BG.removed}
          addedContentBg={DIFF_BG.added}
          removedContentBg={DIFF_BG.removed}
          addedLineNumberBg={DIFF_BG.addedLineNumber}
          removedLineNumberBg={DIFF_BG.removedLineNumber}
          lineNumberFg={COLOR.dim}
        />
      </Box>
    </Terminal>
  );
}
