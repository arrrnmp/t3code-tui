import { Terminal, Box, Markdown, COLOR, SURFACE, markdownSyntaxStyle } from "@moxen/tui";

/** An assistant reply: headings, emphasis, inline code, lists. */
export function Reply() {
  const content = [
    "## Why CI fails",
    "",
    "The render-check snapshot pins a **120-column** terminal, but CI runs at `80`.",
    "",
    "1. Pass `{ width: 120 }` to `testRender`",
    "2. Re-run `bun run check`",
    "",
    "- [x] typecheck passes",
    "- [ ] snapshot updated",
  ].join("\n");
  return (
    <Terminal width={64} height={13}>
      <Box backgroundColor={SURFACE.panel} style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <Markdown content={content} syntaxStyle={markdownSyntaxStyle()} fg={COLOR.text} />
      </Box>
    </Terminal>
  );
}

/** A proposed plan with a quote and a fenced command. */
export function Plan() {
  const content = [
    "# Plan: split the diff panel",
    "",
    "> Keep `FileSection` reusable by the Git tab.",
    "",
    "```sh",
    "bun src/tui/render-check.tsx",
    "```",
  ].join("\n");
  return (
    <Terminal width={64} height={10}>
      <Box backgroundColor={SURFACE.panel} style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <Markdown content={content} syntaxStyle={markdownSyntaxStyle()} fg={COLOR.text} />
      </Box>
    </Terminal>
  );
}
