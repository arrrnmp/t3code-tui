import { Terminal, Box, Text, ScrollBox, COLOR, SURFACE } from "@moxen/tui";

const files = [
  "src/tui/app/app.tsx", "src/tui/features/sidebar/sidebar.tsx", "src/tui/features/timeline/timeline.tsx",
  "src/tui/features/composer/composer.tsx", "src/tui/features/diffpanel/diffpanel.tsx", "src/tui/features/gitpanel/gitpanel.tsx",
  "src/tui/model/turns.ts", "src/tui/model/sidebar.ts", "src/tui/theme.ts", "src/core/threads/store.ts",
  "src/core/providers/spi.ts", "src/server/api.ts",
];

/** A bounded list that scrolls, with Moxen's thin arrowless track. */
export function FileList() {
  return (
    <Terminal width={52} height={10}>
      <Box border borderStyle="rounded" borderColor={SURFACE.border} title=" Changed files " titleColor={COLOR.dim} backgroundColor={SURFACE.panel} style={{ flexGrow: 1 }}>
        <ScrollBox style={{ flexGrow: 1 }} contentOptions={{ paddingLeft: 1, paddingRight: 1 }} stickyStart="top" verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: COLOR.dim, backgroundColor: SURFACE.border } }}>
          {files.map((f) => (
            <Box key={f} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
              <Text fg={COLOR.text}>{f}</Text>
              <Box style={{ flexGrow: 1 }} />
              <Text fg={COLOR.added}>+{f.length % 9}</Text>
            </Box>
          ))}
        </ScrollBox>
      </Box>
    </Terminal>
  );
}
