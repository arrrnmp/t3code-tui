import { Terminal, Box, Code, COLOR, SURFACE, markdownSyntaxStyle } from "@moxen/tui";

/** A command block in the code palette. */
export function Commands() {
  return (
    <Terminal width={56} height={6}>
      <Box backgroundColor={SURFACE.raised} style={{ flexGrow: 1, paddingLeft: 2, paddingTop: 1 }}>
        <Code content={"bun install\nbun run check\nmoxen --json doctor"} filetype="bash" syntaxStyle={markdownSyntaxStyle()} fg={COLOR.command} />
      </Box>
    </Terminal>
  );
}

/** Source text, not wrapped. */
export function Source() {
  const src = ["export function truncate(value: string, width: number): string {", "  if (width <= 0) return \"\";", "  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;", "}"].join("\n");
  return (
    <Terminal width={80} height={6}>
      <Box backgroundColor={SURFACE.panel} style={{ flexGrow: 1, paddingLeft: 2, paddingTop: 1 }}>
        <Code content={src} filetype="typescript" syntaxStyle={markdownSyntaxStyle()} fg={COLOR.text} wrapMode="none" />
      </Box>
    </Terminal>
  );
}
