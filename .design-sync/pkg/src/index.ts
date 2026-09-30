/**
 * The design-sync package entry: Moxen's real TUI components, plus the
 * browser renderings of opentui's primitives (so designs can compose new
 * screens in the same cell-grid idiom) and the theme tokens.
 *
 * Built by `../build.ts`, which swaps `@opentui/react` and `@opentui/core`
 * for `../shim/`. Nothing here is a reimplementation of a Moxen component.
 */

// Root + primitives (opentui intrinsics as components, same prop names).
export { Terminal, useTerminalDimensions, useKeyboard } from "../shim/opentui-react.js";
export { Box, Text, ScrollBox, Markdown, Code, Diff, Input, Textarea } from "../shim/primitives.js";

// Theme tokens and the helpers components use to lay text out on the grid.
export {
  SURFACE,
  COLOR,
  CODE_SYNTAX_TOKENS,
  DIFF_BG,
  STATUS_COLOR,
  MARKER,
  SPINNER,
  SPINNER_FRAMES,
  providerColor,
  rule,
  truncate,
  spread,
  lerpColor,
  pulseColor,
  markdownSyntaxStyle,
} from "../../../src/tui/theme.js";
export { PICK_BG, PICK_FG } from "../../../src/tui/features/pickers/pickermodal.js";

// ui/ — generic chrome.
export { HoverButton } from "../../../src/tui/ui/hoverbutton.js";
export { ModalShell } from "../../../src/tui/ui/modalshell.js";
export { NoticeBanner, Pager } from "../../../src/tui/ui/noticebanner.js";
export { RenameModal } from "../../../src/tui/ui/renamemodal.js";
export { MonitoringBackdrop } from "../../../src/tui/ui/backdrop.js";
export { LoadingScreen } from "../../../src/tui/ui/loadingscreen.js";
export { MinSizeGate } from "../../../src/tui/ui/terminalgate.js";

// features/ — the app's panes, panels and modals.
export { Sidebar } from "../../../src/tui/features/sidebar/sidebar.js";
export { Timeline } from "../../../src/tui/features/timeline/timeline.js";
export { Composer } from "../../../src/tui/features/composer/composer.js";
export { DiffPanel, FileSection } from "../../../src/tui/features/diffpanel/diffpanel.js";
export { GitTab, GitFooter } from "../../../src/tui/features/gitpanel/gitpanel.js";
export {
  SideTabBar,
  SidePanelFrame,
  Heading,
  ActionText,
  DiffEmptyTab,
  AgentsTab,
  ContextTab,
  BackgroundTab,
} from "../../../src/tui/features/sidepanel/sidepanel.js";
export { TasksPanel } from "../../../src/tui/features/taskspanel/taskspanel.js";
export { BackgroundTasksModal } from "../../../src/tui/features/taskspanel/backgroundtasksmodal.js";
export { QueuedPanel } from "../../../src/tui/features/queuedpanel/queuedpanel.js";
export { AnswerPanel } from "../../../src/tui/features/answerpanel/answerpanel.js";
export { PickerModal } from "../../../src/tui/features/pickers/pickermodal.js";
export { SettingsModal } from "../../../src/tui/features/settings/settingsmodal.js";
export { SideQuestionModal } from "../../../src/tui/features/btw/sidequestionmodal.js";
export { SubagentBar } from "../../../src/tui/features/subagentview/subagentbar.js";

// Pure data builders the panes are fed from, so a design can hand them
// realistic data in the exact shapes the app produces.
export { buildSidebarSections } from "../../../src/tui/model/sidebar.js";
export { groupTurns } from "../../../src/tui/model/turns.js";
export { splitPatchByFile } from "../../../src/tui/model/patch.js";
export { contextShares } from "../../../src/tui/model/sidepanel.js";
export { formatTokenCount } from "../../../src/tui/model/turns.js";
// The settings table SettingsModal renders (core/configschema.ts), so a design
// can show real settings instead of an inlined copy.
export { describeSettings } from "../../../src/core/configschema.js";
export { DEFAULT_CONFIG } from "../../../src/core/config.js";
