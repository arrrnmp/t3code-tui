import os from "node:os";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";

import { applyShellFrame, emptyShellState, threadStatus, visibleThreads, type ShellState } from "../model/shell.js";
import { Timeline } from "../features/timeline/timeline.js";
import { DiffPanel } from "../features/diffpanel/diffpanel.js";
import { Composer } from "../features/composer/composer.js";
import { useSkillInventory } from "../features/composer/useSkillInventory.js";
import { TasksPanel } from "../features/taskspanel/taskspanel.js";
import { BackgroundTasksModal } from "../features/taskspanel/backgroundtasksmodal.js";
import { SettingsModal } from "../features/settings/settingsmodal.js";
import { GitFooter, GitTab } from "../features/gitpanel/gitpanel.js";
import { SubagentBar } from "../features/subagentview/subagentbar.js";
import { describeScheduled, formatScheduleInput, parseScheduleInput } from "../model/schedule.js";
import { subagentState, subagentTitle, useSubagentView } from "../features/subagentview/useSubagentView.js";
import { useGitPanel } from "../features/gitpanel/useGitPanel.js";
import { uiFromSnapshot, useSettings } from "../features/settings/useSettings.js";
import { PickerModal, type PickerBody } from "../features/pickers/pickermodal.js";
import { ModalShell } from "../ui/modalshell.js";
import { RenameModal } from "../ui/renamemodal.js";
import { AnswerPanel } from "../features/answerpanel/answerpanel.js";
import { dispatchErrorMessage } from "../../core/errors.js";
import type { ModelSelection, RuntimeMode, UiConfig } from "../../core/types.js";
import { compatibleRuntimeMode } from "../../core/catalog/permissions.js";
import { offerableModels, offerableProviders } from "../../core/catalog/summary.js";
import {
  attachmentFromBytes,
  buildImageAttachments,
  extractMentions,
  imageSetError,
  MAX_PENDING_ATTACHMENTS,
  imageMimeForPath,
} from "../../core/attachments.js";
import type { ImageAttachmentUpload } from "../../core/attachments.js";
import { clipboardFileName } from "../model/hostClipboard.js";
import { turnModelSelection } from "../model/display.js";
import { formatContextUsage, formatTokenCount, groupTurns } from "../model/turns.js";
import { waitSpans } from "../model/waits.js";
import { markModalDismissed } from "../model/modalDismiss.js";
import { setPathRoots } from "../model/activity.js";
import { Sidebar } from "../features/sidebar/sidebar.js";
import { MonitoringBackdrop } from "../ui/backdrop.js";
import { LoadingScreen } from "../ui/loadingscreen.js";
import { bootLoadingStage, isBootReady } from "../model/readiness.js";
import { HoverButton } from "../ui/hoverbutton.js";
import { openExternal } from "../../core/infra/platformOpen.js";
import { formatDuration } from "../model/turns.js";
import { handOffTarget, openRequestPrompt, requestNoun } from "../model/gitpanel.js";
import { renderMessage } from "../model/message.js";
import { copiedAttachments, copiedToast, copyPrompt, matchCopy, uniqueName } from "../model/copystash.js";
import { COLOR, MARKER, pulseColor, SPINNER, SURFACE, truncate } from "../theme.js";
import { useToasts, type ToastTone } from "../hooks/useToasts.js";
import { useClipboard } from "../hooks/useClipboard.js";
import { useTerminalNotify } from "../hooks/useTerminalNotify.js";
import { readPastedImage, type TerminalClipboardDeps } from "../model/terminalClipboard.js";
import { useHover } from "../hooks/useHover.js";
import {
  applyThreadFrame,
  backgroundSummaryLabel,
  backgroundTaskTitle,
  emptyThreadState,
  latestPlan,
  pendingUserInputRequests,
  promptSuggestion,
  timeline,
  untilLabel,
  resumeCompactionKey,
  shouldOfferResumeCompaction,
  type BackgroundTaskRow,
  type ThreadState,
  type TimelineEntry,
} from "../model/thread.js";
import {
  CHAT_GUTTER,
  COPY_TOAST_MS,
  CTRL_C_WINDOW_MS,
  ERROR_DISPLAY_MS,
  SIDEBAR_WIDTH,
  TOAST_COLOR,
  TOAST_INSET,
  TOAST_STEP,
} from "./constants.js";
import { clock, scrollPane } from "./utils.js";
import { useTasksPanel } from "../features/taskspanel/useTasksPanel.js";
import { useQuitConfirm } from "./hooks/useQuitConfirm.js";
import { useUsageLimitBanner } from "./hooks/useUsageLimitBanner.js";
import { useNoticePager } from "./hooks/useNoticePager.js";
import { NoticeBanner, Pager, type Notice } from "../ui/noticebanner.js";
import { QueuedPanel } from "../features/queuedpanel/queuedpanel.js";
import { SideQuestionModal } from "../features/btw/sidequestionmodal.js";
import { parseSideQuestion, useSideQuestion } from "../features/btw/useSideQuestion.js";
import { useQueuedPanel } from "../features/queuedpanel/useQueuedPanel.js";
import { useThreadNotifications } from "./hooks/useThreadNotifications.js";
import { useAnswerFlow } from "../features/answerpanel/useAnswerFlow.js";
import { useSidebar } from "../features/sidebar/useSidebar.js";
import { useDiffPanel } from "../features/diffpanel/useDiffPanel.js";
import { ActionText, AgentsTab, BackgroundTab, ContextTab, DiffEmptyTab, SidePanelFrame, SideTabBar, TAB_LABEL as SIDE_TAB_LABEL } from "../features/sidepanel/sidepanel.js";
import { useContextBreakdown, usePlanUsage, useSidePanel } from "../features/sidepanel/useSidePanel.js";
import { agentThreads, effectiveContextBreakdown, nativeSubagents, planUsageGauges, type SideTab } from "../model/sidepanel.js";
import { useComposer } from "../features/composer/useComposer.js";
import { useProviderCatalog } from "../features/pickers/useProviderCatalog.js";
import { useThreadCreation } from "./hooks/useThreadCreation.js";
import { useThreadExport } from "./hooks/useThreadExport.js";
import { useThreadOps, type RevertKind } from "./hooks/useThreadOps.js";
import type { PickerName } from "../features/pickers/pickerTypes.js";
import type { ClientApi } from "../../server/api.js";


export function App({
  client,
  onQuit,
  homeDir,
  cwd,
  launchView,
  setTerminalTitle,
  ui: launchUi,
}: {
  client: ClientApi;
  onQuit: () => void;
  homeDir?: string;
  /** Resolves relative `@path` mentions. Defaults to the launch directory. */
  cwd?: string;
  /**
   * Production always launches into the new-thread view; the render check
   * passes `"thread"` so its frames keep covering the transcript.
   */
  launchView?: "create" | "thread";
  /** Wired to the renderer's own terminal-title API; omitted in tests. */
  setTerminalTitle?: (title: string) => void;
  /**
   * Presentation settings (`ui.*`), read once at launch. These change how
   * the app draws rather than what it does, so unlike the rest of the
   * config they are not re-read per operation — a restart applies them.
   */
  ui?: UiConfig;
}) {
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(emptyShellState);
  const [threadState, setThreadState] = useState<ThreadState>(emptyThreadState);
  const { plan, background, tasksVisibleNow, toggleTasksVisible } = useTasksPanel(threadState);
  const [focus, setFocus] = useState<"chat" | "composer" | "diff">("chat");
  const toasts = useToasts();
  /** Kept as the one call every existing error path already used; now routes
      through `toasts` instead of its own state + timeout effect. */
  const setError = (message: string) => toasts.push("error", "danger", `error: ${message}`, ERROR_DISPLAY_MS);
  /** Composer is drafting the first message of a new thread, not a reply. */
  const [creating, setCreating] = useState(launchView !== "thread");
  /** Overrides the model the new thread inherits from its source once the
      user picks a different one while creating — `null` means "still
      inheriting". Picking a model/effort during `creating` must land here,
      never dispatch `thread.model-selection.set` against the still-open
      source thread. */
  const [creatingModelSelection, setCreatingModelSelection] = useState<ModelSelection | null>(null);
  /**
   * Overrides the permission level the new thread starts with once the user
   * picks one while creating — `null` means "still inheriting" from the
   * source thread. Same rule as `creatingModelSelection`: picking during
   * `creating` lands here, never dispatches against the source thread.
   */
  const [creatingRuntimeMode, setCreatingRuntimeMode] = useState<RuntimeMode | null>(null);
  /**
   * Overrides the project the new thread lands in once the user picks a
   * different one while creating — `null` means "still inheriting" from the
   * source thread. Picked via the project picker (command palette or `[`/`]`
   * in the creating view); `createThread` reads it back on send.
   */
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const {
    sections,
    settledExpanded,
    toggleSettledExpanded,
    showMoreSettled,
    sidebarMode,
    setSidebarMode,
    cycleSidebarMode,
    toggleSidebarProject,
    cycleSidebarProject,
  } = useSidebar(shell, openThreadId, now);
  const {
    quitConfirmOpen,
    quitCancelHover,
    quitConfirmHover,
    openQuitConfirm,
    closeQuitConfirm,
    registerCtrlCPress,
  } = useQuitConfirm(setFocus);
  const [picker, setPicker] = useState<PickerName>(null);
  // Reads on open and writes through the server; see `useSettings`. The
  // snapshot outlives the page, so once it exists the app draws from it:
  // a `ui.*` edit applies on the spot instead of after a restart.
  const settings = useSettings(client, picker === "settings");
  const ui = uiFromSnapshot(settings.snapshot) ?? launchUi;
  const [pickerFilter, setPickerFilter] = useState("");
  /** Where esc/backdrop returns focus after the command palette closes. */
  const [paletteReturnFocus, setPaletteReturnFocus] = useState<"chat" | "composer" | "diff">("chat");
  /** Delete-thread two-step confirm: first pick arms, second pick dispatches. */
  const [deleteArmed, setDeleteArmed] = useState(false);
  /**
   * Whether the server accepts a general `thread.delete`. Starts assumed and
   * flips permanently off for the session on the first rejection — the row
   * then renders disabled like the other unsupported actions.
   */
  const [deleteSupported, setDeleteSupported] = useState(true);
  /** The user turn the message-actions modal acts on (a PromptBlock click). */
  const [messageActionEntry, setMessageActionEntry] = useState<TimelineEntry | null>(null);
  /** Revert two-step confirm inside the message-actions modal. */
  const [revertArmed, setRevertArmed] = useState<RevertKind | false>(false);
  /** Bumped to tear down and re-establish the thread subscription for a
      fresh snapshot (our projector can't consume removal events). */
  const [threadResync, setThreadResync] = useState(0);
  /** Live thread state for delayed re-checks (answer race detection). */
  const threadStateRef = useRef(threadState);
  threadStateRef.current = threadState;
  const {
    answerDraft,
    pendingAnswerRequests,
    activeAnswerRequest,
    activeAnswerQuestion,
    answerVisible,
    resolveAnswerQuestion,
    answerCurrentQuestion,
    toggleAnswerOption,
    dismissAnswerRequest,
  } = useAnswerFlow(client, threadState, threadStateRef, openThreadId, picker, toasts, setError);
  /** Dismissal key of the last-dismissed resume-compaction banner — a new
      context snapshot reopens it even if an earlier one was dismissed. */
  const [dismissedResumeKey, setDismissedResumeKey] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  /** Stops dispatch through one global path, but keep a dedupe window so a
      repeated stop click never double-dispatches interrupts. */
  const lastInterruptRef = useRef(0);
  /** Live read of `sessionRunning` (computed below) for picker-row callbacks,
      whose memo snapshot goes stale while the modal is open (same pattern as
      editingExternallyRef). */
  const sessionRunningRef = useRef(false);
  const clipboard = useClipboard();
  const renderer = useRenderer() as CliRenderer | null;
  const {
    drafts,
    pendings,
    draft,
    pending,
    editingExternally,
    editingExternallyRef,
    markedThreadIds,
    composerResetKey,
    copyDraft,
    setDraft,
    resetDraft,
    writePending,
    setPending,
    editDraftExternally,
  } = useComposer(openThreadId, clipboard, toasts, setError, setFocus);
  /** Dedupes the "selection" event, which keeps firing while dragging and
      once more on release — only the settled, non-empty, changed text
      triggers a copy+toast. */
  const lastCopiedRef = useRef<string | null>(null);
  useSelectionHandler((selection) => {
    if (selection.isDragging) return;
    const text = selection.getSelectedText();
    if (text.trim().length === 0) {
      lastCopiedRef.current = null;
      return;
    }
    if (text === lastCopiedRef.current) return;
    lastCopiedRef.current = text;
    void clipboard.copyText(text).then((ok) => {
      if (ok) toasts.push("copy-selection", "info", "Copied to clipboard", COPY_TOAST_MS);
    });
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return client.subscribeShell(
      {},
      (item) => setShell((current) => applyShellFrame(current, item)),
      (cause) => setError(String(cause).slice(0, 120)),
    );
  }, [client]);

  // Launch always selects the latest thread; production additionally lands in
  // its new-thread view (the thread only lends its project, model, and modes
  // to the composer), while the render check's `launchView="thread"` needs
  // that same thread selected but opened on its transcript instead. This runs
  // once, so an explicit open or a sent first message always wins afterwards.
  useEffect(() => {
    if (openThreadId !== null) return;
    // Prefer the latest active thread, but fall back to the latest visible
    // thread of any status: an all-settled workspace otherwise leaves nothing
    // selected and `startNewThread` errors with "no open thread to inherit
    // the project from". (`sections.settled` is pagination-gated, so it
    // can't serve as the fallback.) The fallback thread only lends its
    // project/model/modes to the composer.
    const first = sections.active[0]?.thread.id ?? visibleThreads(shell)[0]?.id ?? null;
    if (first === null) return;
    setOpenThreadId(first);
    if (launchView === "thread") return;
    setCreating(true);
    setFocus("composer");
  }, [openThreadId, sections, launchView]);

  const selected = useMemo(
    () => shell.threads.find((thread) => thread.id === openThreadId) ?? null,
    [shell.threads, openThreadId],
  );
  // Rows show paths relative to where this thread's files live. Set during
  // render (it is idempotent) so the first frame of a thread already has it.
  setPathRoots(
    [selected?.worktreePath, shell.projects.find((project) => project.id === selected?.projectId)?.workspaceRoot],
    homeDir ?? os.homedir(),
  );
  /**
   * Boot gate: the app chrome stays hidden behind `<LoadingScreen>` until the
   * shell snapshot (thread list) and the picked thread's own snapshot have
   * both landed. Latched — once true it never drops: thread switches and
   * resyncs reset `threadState.synchronized` (which correctly re-holds the
   * *transcript* placeholder below), but must never flash the whole app back
   * to the loading screen. Declared up here so the keyboard handler below
   * can swallow app bindings while booting — only the ctrl+c quit flow
   * stays live.
   */
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (!booted && isBootReady(shell, openThreadId, threadState)) setBooted(true);
  }, [booted, shell, openThreadId, threadState]);
  const bootReady = booted;
  /** The model selection every picker/footer reads: while drafting a new
      thread this is the local override (once picked) or the source thread's
      own model, never a dispatch target. */
  const effectiveModelSelection = creating ? (creatingModelSelection ?? selected?.modelSelection) : selected?.modelSelection;
  /** The permission level a turn would run with — the local override while
      drafting, else the open thread's own mode. */
  const effectiveRuntimeMode = creating
    ? (creatingRuntimeMode ?? selected?.runtimeMode ?? null)
    : (selected?.runtimeMode ?? null);
  /**
   * The project the next thread lands in: while drafting, the local override
   * (once picked) or the source thread's own project — never dispatched
   * against anything until `createThread` sends `thread.create`.
   */
  const effectiveProjectId = creating ? (creatingProjectId ?? selected?.projectId ?? null) : (selected?.projectId ?? null);
  /** Where the skill picker asks the provider to look: the thread's worktree, else its project. */
  const skillDirectory =
    (creating ? null : (selected?.worktreePath ?? null)) ??
    shell.projects.find((project) => project.id === effectiveProjectId)?.workspaceRoot ??
    null;
  const skillInventory = useSkillInventory(client, effectiveModelSelection?.instanceId, skillDirectory);

  /** One palette copy action: missing data toasts instead of dispatching. */
  const copyPaletteText = (text: string | null, emptyMessage: string) => {
    if (text === null || text.length === 0) {
      setError(emptyMessage);
      return;
    }
    void clipboard.copyText(text).then((ok) => {
      if (ok) toasts.push("palette-copy", "info", "Copied to clipboard", COPY_TOAST_MS);
      else if (clipboard.isRemote()) setError("copy failed — terminal may block OSC 52");
    });
  };
  /**
   * A message, with the images it carried: the text goes to the clipboard
   * last (after each image, for clipboard histories), and pasting it back
   * into moxen attaches the images again onto its `[Image #N]` tokens.
   */
  const copyMessage = (entry: TimelineEntry) => {
    const rendered = entry.message === null ? { text: entry.text, images: [] } : renderMessage(entry.message, homeDir);
    const sources = rendered.images.flatMap((image) =>
      image.filePath === null ? [] : [{ name: image.label, mimeType: imageMimeForPath(image.filePath), path: image.filePath }],
    );
    if (rendered.text.trim().length === 0) {
      setError("nothing to copy");
      return;
    }
    void copyPrompt(clipboard, rendered.text, sources).then(({ ok, images }) => {
      if (ok) toasts.push("palette-copy", "info", copiedToast(sources.length, images), COPY_TOAST_MS);
      else if (clipboard.isRemote()) setError("copy failed — terminal may block OSC 52");
    });
  };
  /**
   * A paste that is moxen's own copy of a prompt with images: attach those
   * images again, under names no pending image already has. The composer
   * puts the text in and pins each `[Image #N]` token to its image.
   */
  const claimPaste = (text: string): string[] | null => {
    const copied = matchCopy(text);
    if (copied === null || copied.images.length === 0) return null;
    if (pending.length + copied.images.length > MAX_PENDING_ATTACHMENTS) {
      toasts.push("attach-limit", "warn", `A message can carry ${MAX_PENDING_ATTACHMENTS} images — the pasted text came without its ${copied.images.length}`, COPY_TOAST_MS);
      return null;
    }
    const taken = new Set(pending.map((attachment) => attachment.name));
    const names = copied.images.map((image) => uniqueName(image.name, taken));
    const uploads = copiedAttachments(copied, names);
    if (uploads.length === 0) return null;
    setPending((current) => [...current, ...uploads]);
    return uploads.map((upload) => upload.name);
  };
  /** Latest assistant reply text, for the palette's copy action. */
  const lastAssistantMessage = [...threadState.messages].reverse().find(
    (message) => message.role === "assistant" && message.text.length > 0,
  )?.text ?? null;
  /** Opens a fetched URL in the browser (clickable web-row links). */
  const openFetchedUrl = (url: string) => {
    void openExternal(url).catch((cause: unknown) =>
      toasts.push("open-url", "danger", dispatchErrorMessage(cause), COPY_TOAST_MS),
    );
  };
  /**
   * Commits the custom-answer prompt back into the options modal (esc goes
   * back without recording). Empty submits toast and return too.
   */
  const submitCustomAnswer = (text: string) => {
    const draft = answerDraft;
    const request =
      draft === null ? undefined : pendingAnswerRequests.find((candidate) => candidate.requestId === draft.requestId);
    const question = request?.questions[draft?.index ?? -1];
    setPicker(null);
    if (draft === null || question === undefined) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError("answer is empty");
      return;
    }
    answerCurrentQuestion(question.id, { custom: trimmed });
  };

  const closePicker = (returnFocus: "composer" | "chat" | "diff" = "composer") => {
    setPicker(null);
    setPickerFilter("");
    setDeleteArmed(false);
    setRevertArmed(false);
    markModalDismissed();
    setFocus(returnFocus);
  };

  const entries = useMemo(() => timeline(threadState), [threadState]);
  /** Turn groups own the scroll math: the diff-turn picker resolves a picked
      turn to a group index and jumps the chat pane to it. */
  // Waits on the user (questions, permission prompts) come off the raw
  // activities: their closing rows are bookkeeping the transcript hides.
  const turnWaits = useMemo(() => waitSpans(threadState.activities), [threadState.activities]);
  const groups = useMemo(() => groupTurns(entries, turnWaits), [entries, turnWaits]);
  const diffPanel = useDiffPanel({
    client,
    width,
    openThreadId,
    selected,
    shellProjects: shell.projects,
    threadState,
    threadStateRef,
    groups,
    selectedIdRef,
    chatScrollRef,
    setThreadState,
    setFocus,
    setError,
  });
  /** The right-hand panel: the Diff tab follows the diff panel, the others open here. */
  const sidePanel = useSidePanel(diffPanel.expandedTurn !== null);
  /** A native subagent's own conversation, open in the chat pane in place of its thread's. */
  const subagentView = useSubagentView(client, openThreadId);
  const {
    deleteThread,
    toggleSettleThread,
    regenerateThreadTitle,
    archiveThread,
    compactSession,
    openMessageActions,
    revertMessageTurn,
    submitRename,
  } = useThreadOps({
    client,
    renderer,
    openThreadId,
    selected,
    creating,
    shellThreads: shell.threads,
    // Settled headers of live families sit in `active` too; never fall back onto one.
    activeThreadIds: sections.active.filter((row) => row.status !== "settled").map((row) => row.thread.id),
    toasts,
    paletteReturnFocus,
    deleteArmed,
    revertArmed,
    sessionRunningRef,
    closePicker,
    closeDiff: diffPanel.closeDiff,
    setError,
    setOpenThreadId,
    setDeleteArmed,
    setDeleteSupported,
    setRevertArmed,
    setMessageActionEntry,
    setPickerFilter,
    setPicker,
    setCreatingModelSelection,
    setCreatingRuntimeMode,
    setCreatingProjectId,
    setCreating,
    setFocus,
    setThreadState,
    setThreadResync,
  });

  /**
   * Command-palette "Export thread" source data: the live plan checklist,
   * unanswered agent questions, and context usage feed the handover file's
   * "State to continue" section; the file lands in the thread project's
   * workspace root (else the launch directory).
   */
  const exportPlan = useMemo(() => latestPlan(threadState), [threadState]);
  const exportPending = useMemo(() => pendingUserInputRequests(threadState), [threadState]);
  const suggestedPrompt = useMemo(() => promptSuggestion(threadState), [threadState]);
  const notify = useTerminalNotify(renderer);
  useThreadNotifications({
    threads: shell.threads,
    openThreadId,
    openThreadTitle: selected?.title ?? null,
    pendingQuestions: exportPending.length,
    pushToast: toasts.push,
    notify,
  });
  const exportProject = useMemo(() => {
    const project = shell.projects.find((candidate) => candidate.id === selected?.projectId) ?? null;
    if (project === null) return null;
    return {
      title: String(project.title ?? project.id),
      workspaceRoot: typeof project.workspaceRoot === "string" ? project.workspaceRoot : null,
    };
  }, [shell.projects, selected]);
  const { exportThread } = useThreadExport({
    thread: selected,
    openThreadId,
    project: exportProject,
    groups,
    plan: exportPlan,
    pending: exportPending,
    contextUsage: threadState.contextUsage,
    exportDir: exportProject?.workspaceRoot ?? null,
    fallbackDir: cwd,
    clipboard,
    toasts,
    paletteReturnFocus,
    closePicker,
    setError,
  });

  useEffect(() => {
    if (openThreadId === null) return;
    selectedIdRef.current = openThreadId;
    setThreadState(emptyThreadState());
    diffPanel.resetCaches();
    return client.subscribeThread(
      openThreadId,
      {},
      (item) => {
        if (selectedIdRef.current !== openThreadId) return;
        setThreadState((current) => applyThreadFrame(current, item));
      },
      (cause) => setError(String(cause).slice(0, 120)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, openThreadId, threadResync]);

  /** Opens the diff-turn picker from the diff panel's header row. */
  const openDiffTurnPicker = () => {
    setPickerFilter("");
    setPicker("diff-turn");
  };

  /**
   * Picking the already-open turn keeps the panel (no toggle-close) and just
   * jumps the timeline; any other turn opens like a header/row click. The
   * jump is deferred past the panel open: opening/resizing the panel reflows
   * the chat pane (new scrollHeight) under a sticky-bottom scrollbox, which
   * swallows a same-tick scrollTo — landing the jump on the settled layout
   * with fresh measurements instead.
   */
  const pickDiffTurn = (turnCount: number) => {
    setPicker(null);
    setPickerFilter("");
    if (diffPanel.expandedTurn !== turnCount) diffPanel.openDiff(turnCount);
    else setFocus("diff");
    setTimeout(() => diffPanel.scrollTimelineToTurn(turnCount), 60);
  };

  /**
   * While a turn runs, a message either steers it (lands at its next step —
   * Claude's `next` priority) or queues behind it (runs once it ends — its
   * `later`). Idle, it simply starts a turn.
   */
  const dispatchTurn = (prompt: string, attachments: ImageAttachmentUpload[], busyDelivery: "steer" | "queue", scheduledFor?: Date) => {
    if (selected === null) return;
    void client
      .dispatch({
        type: "thread.turn.start",
        threadId: selected.id,
        message: { text: prompt, attachments },
        // A scheduled message waits in the queue for its time (it cannot steer).
        ...(scheduledFor !== undefined
          ? { scheduledFor: scheduledFor.toISOString() }
          : sessionRunningRef.current
            ? { delivery: busyDelivery }
            : {}),
      })
      .then((result) => {
        const continueAt = usageBanner.banner?.continueAt ?? null;
        if (scheduledFor === undefined && result.status === "queued" && !sessionRunningRef.current && continueAt !== null) {
          toasts.push("queued", "info", `Queued: goes out after the continue at ${clock(continueAt)} (see Queued, above)`, COPY_TOAST_MS);
        } else if (scheduledFor !== undefined) {
          const when = describeScheduled(scheduledFor, new Date());
          toasts.push("scheduled", "info", when === "now" ? "Scheduled: goes out now (see Queued, above)" : `Scheduled for ${when} (see Queued, above)`, COPY_TOAST_MS);
        } else if (sessionRunningRef.current && busyDelivery === "queue") {
          toasts.push("queued", "info", "Queued: sent once this turn fully finishes (see Queued, above)", COPY_TOAST_MS);
        }
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };

  /**
   * `@path/to/image.png` mentions become inline image attachments, combined
   * with anything pasted off the clipboard. The draft stays put when a file
   * cannot be read so the prompt is never eaten by a failed attach.
   */
  const send = (text: string, busyDelivery: "steer" | "queue" = "steer", scheduledFor?: Date) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || selected === null) return;
    // `/btw` never reaches the thread: it is answered on a copy of the
    // context, so it must not wake a settled thread or queue behind a turn.
    const side = parseSideQuestion(trimmed);
    if (side !== null) {
      if (side.length === 0) {
        if (!sideQuestion.reopen()) toasts.push("btw", "info", "Usage: /btw <question> — asks without adding to the thread", COPY_TOAST_MS);
      } else if (sideQuestion.ask(side)) {
        resetDraft(selected.id);
      } else {
        toasts.push("btw", "warn", "A side question is still being answered", COPY_TOAST_MS);
      }
      return;
    }
    // A settled thread wakes on send: unsettle first so the turn lands on a
    // live thread instead of dispatching into a finished one. The toast says
    // what happened; a rejection surfaces as an error and the draft is kept.
    if (threadStatus(selected, Date.now()) === "settled") {
      const id = selected.id;
      void client
        .dispatch({ type: "thread.unsettle", threadId: id, reason: "user" as const })
        .then(() => {
          toasts.push("thread-unsettled", "info", "Thread unsettled", COPY_TOAST_MS);
          send(text, busyDelivery, scheduledFor);
        })
        .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
      return;
    }
    const sourceId = selected.id;
    const parsed = extractMentions(trimmed);
    if (parsed.paths.length === 0 && pending.length === 0) {
      resetDraft(sourceId);
      dispatchTurn(trimmed, [], busyDelivery, scheduledFor);
      return;
    }
    void buildImageAttachments(parsed.paths, cwd ?? process.cwd()).then((built) => {
      if (built.error !== null) {
        setError(built.error.slice(0, 120));
        return;
      }
      // Pasted and @-mentioned together: the server refuses the same, but
      // here the draft is kept and nothing is sent.
      const imageError = imageSetError([...pending, ...built.attachments]);
      if (imageError !== null) {
        setError(`Cannot send: ${imageError}`.slice(0, 160));
        return;
      }
      resetDraft(sourceId);
      writePending(sourceId, []);
      dispatchTurn(parsed.text, [...pending, ...built.attachments], busyDelivery, scheduledFor);
    });
  };

  /**
   * Alt+V (and Ctrl+V where the terminal passes it through) reads an image
   * off the clipboard into a pending attachment chip. Most terminals
   * swallow Ctrl+V for their own paste, so Alt+V is the reliable binding.
   * The read goes to the *terminal* first (OSC 5522 — the only image path
   * that crosses SSH), then the host OS clipboard, then a session-aware
   * error. See `model/terminalClipboard.ts` for the protocol details.
   */
  /** An image's token was deleted from the draft: it no longer goes with the message. */
  const detachImage = (name: string) => setPending((current) => current.filter((attachment) => attachment.name !== name));

  const pasteImage = () => {
    setFocus("composer");
    // Full: say so, and keep what is attached. Dropping the oldest to make
    // room left its image token in the draft with nothing behind it.
    if (pending.length >= MAX_PENDING_ATTACHMENTS) {
      toasts.push("attach-limit", "warn", `A message can carry ${MAX_PENDING_ATTACHMENTS} images — delete an [Image #N] to attach another`, COPY_TOAST_MS);
      return;
    }
    const withRenderer = renderer as unknown as {
      subscribeOsc?: (handler: (sequence: string) => void) => () => void;
    } | null;
    const terminal: TerminalClipboardDeps | null =
      renderer !== null &&
      typeof withRenderer?.subscribeOsc === "function" &&
      process.stdout.isTTY === true
        ? {
            write: (data: string) => {
              process.stdout.write(data);
            },
            subscribe: (handler: (sequence: string) => void) =>
              (withRenderer?.subscribeOsc as (handler: (sequence: string) => void) => () => void)(handler),
          }
        : null;
    void readPastedImage({ env: process.env, terminal }).then((result) => {
      if (result.error !== null) {
        setError(result.error.slice(0, 120));
        return;
      }
      const built = attachmentFromBytes(clipboardFileName(result.mimeType), result.mimeType, result.bytes);
      if (built.error !== null) {
        setError(built.error.slice(0, 120));
        return;
      }
      // Would it still fit the message (count, and the encoded total)? Said
      // now, at the paste, instead of when the message is sent.
      const imageError = imageSetError([...pending, built.attachment]);
      if (imageError !== null) {
        toasts.push("attach-limit", "warn", `Not attached: ${imageError}`, COPY_TOAST_MS);
        return;
      }
      // Re-checked here: another paste may have landed while this one read the clipboard.
      setPending((current) => (current.length >= MAX_PENDING_ATTACHMENTS ? current : [...current, built.attachment]));
    });
  };

  const { createThread, startNewThread, pickCreatingProject, submitProjectFolder, openProjectPicker } =
    useThreadCreation({
      client,
      cwd,
      selected,
      pending,
      shellProjects: shell.projects,
      creatingProjectId,
      creatingModelSelection,
      creatingRuntimeMode,
      resetDraft,
      writePending,
      setCreating,
      setCreatingModelSelection,
      setCreatingRuntimeMode,
      setCreatingProjectId,
      setFocus,
      setOpenThreadId,
      setError,
      setPicker,
      setPickerFilter,
      closePicker,
    });

  useKeyboard((key) => {
    // The full-size quit confirm owns its keys exactly like a modal does:
    // Enter / Ctrl+C again quits, Esc cancels back to the chat pane.
    if (quitConfirmOpen) {
      if ((key.name === "c" && key.ctrl) || key.name === "return") {
        onQuit();
        return;
      }
      if (key.name === "escape") {
        closeQuitConfirm();
        return;
      }
      return;
    }
    // The picker modal owns its keys (type to filter, arrows, enter, esc);
    // every app binding stays swallowed while it is open so chat actions
    // can't fire mid-pick and keystrokes never reach the composer — it is
    // unfocused for the same reason.
    if (picker !== null) {
      return;
    }
    // The same for the modals opened outside the picker (a side answer,
    // a forge prompt): they own their keys while they are up.
    if (sideQuestion.open || forgePrompt !== null) {
      return;
    }
    // The inline answer panel owns its keys exactly like a modal does.
    if (answerVisible) {
      return;
    }
    // While `$EDITOR` owns the terminal the TUI must not act on keys.
    if (editingExternallyRef.current) {
      return;
    }
    // Boot gate: no app bindings until the first snapshots land — the chrome
    // they act on isn't mounted yet. Ctrl+C still falls through to the quit
    // flow below so a stalled boot can always exit.
    if (!bootReady && !(key.name === "c" && key.ctrl)) {
      return;
    }
    // Alt+E opens the draft externally. `meta` is Alt; ctrl+E stays free for
    // the textarea's own Emacs line-end binding. When the composer itself is
    // focused the textarea's `onKeyDown` owns this chord instead (this
    // handler returns early for `focus === "composer"` below).
    if ((key.name === "e" || key.name === "E") && key.meta === true && key.ctrl !== true) {
      editDraftExternally();
      return;
    }
    // Ctrl+O does the same and is the Mac-reliable chord: macOS terminals
    // don't send Option-as-Meta by default (Option+E types ´ instead), while
    // Ctrl+O arrives everywhere and is free in the textarea's own bindings,
    // so this fires from the composer too with no extra wiring.
    if ((key.name === "o" || key.name === "O") && key.ctrl === true && key.meta !== true) {
      editDraftExternally();
      return;
    }
    // Ctrl+P / Alt+P opens the command palette from any pane. `p` is free
    // in the textarea's own bindings, so this fires even with the composer
    // focused; plain `p` (no modifier) must never trigger it.
    if ((key.name === "p" || key.name === "P") && (key.ctrl || key.meta)) {
      openCommandPalette();
      return;
    }
    if (key.name === "c" && key.ctrl) {
      // Escalating flow: every press clears the prompt; a 2nd press inside
      // the window opens the close menu; a 3rd (in the menu) quits via the
      // confirm branch above. An empty prompt jumps straight to the menu.
      const shouldOpenMenu = registerCtrlCPress();
      if (openThreadId !== null) resetDraft(openThreadId);
      if (draft.trim().length === 0 || shouldOpenMenu) {
        toasts.dismiss("ctrl-c");
        openQuitConfirm();
      } else {
        toasts.push("ctrl-c", "info", "ctrl-c again if you want to quit", 2_000);
      }
      return;
    }
    if ((key.name === "v" || key.name === "V") && (key.ctrl || key.meta)) {
      pasteImage();
      return;
    }
    if (key.name === "t" && key.ctrl) {
      toggleTasksVisible();
      return;
    }
    if (focus === "composer") {
      // Submit is owned by the textarea (enter sends, shift+enter newline);
      // escape only leaves the composer — stopping a turn is the composer's
      // own stop button, never a mistyped escape.
      if (key.name === "escape") escapeComposer();
      return;
    }
    if (focus === "diff") {
      // Escape always closes the side panel, even mid-turn: it must never
      // stop the thread as a side effect. Stopping a turn is UI-only now (the
      // composer's stop button), never a key.
      if (key.name === "escape") {
        closeSidePanel();
        return;
      }
      scrollPane(sidePanel.tab === "diff" && diffPanel.expandedTurn !== null ? diffScrollRef.current : sidePanel.scrollRef.current, key.name);
      return;
    }
    // Escape in the chat pane never kills a running turn; it only closes
    // a subagent's conversation, back to its thread.
    if (key.name === "escape") {
      if (subagentView.target !== null) subagentView.close();
      return;
    }
    if (key.name === "i") {
      setFocus("composer");
      return;
    }
    // No `d` binding: the diff opens from a timeline "diff …" row or the
    // diff panel's own header — never a mistyped single key.
    if (key.name === "s") {
      cycleSidebarMode();
      return;
    }
    if (key.name === "[") {
      if (sidebarMode !== "project") {
        setSidebarMode("project");
        return;
      }
      cycleSidebarProject(-1);
      return;
    }
    if (key.name === "]") {
      if (sidebarMode !== "project") {
        setSidebarMode("project");
        return;
      }
      cycleSidebarProject(1);
      return;
    }
    scrollPane(chatScrollRef.current, key.name);
  });

  // Stopped by a plan usage limit: a banner over the composer says when it
  // resets and offers (or shows) the continue for then.
  const usageBanner = useUsageLimitBanner({ client, threadState, openThreadId, now, setError, openThread: setOpenThreadId });
  const queued = useQueuedPanel({ client, threadState, threadId: openThreadId, setError });
  const sideQuestion = useSideQuestion(client, openThreadId);
  // Tasks and Queued share the slot over the composer and page like the
  // notices below them, rather than stacking and eating the chat's rows.
  // Queued comes first: the pager resets to the first pane whenever the set
  // changes, so queueing a message shows it rather than staying on Tasks.
  const dockPanes = [
    ...(queued.items.length > 0 ? (["queued"] as const) : []),
    ...(tasksVisibleNow && plan !== null ? (["tasks"] as const) : []),
  ];
  const dockPager = useNoticePager(dockPanes);
  const dockPane = dockPanes[Math.min(dockPager.index, dockPanes.length - 1)] ?? null;
  const dockPagerControl =
    dockPanes.length > 1 ? (
      <Pager position={dockPanes.indexOf(dockPane!)} count={dockPanes.length} onPage={dockPager.setIndex} />
    ) : undefined;
  const session = threadState.session;
  const sessionRunning = session?.status === "running" || session?.status === "starting";
  sessionRunningRef.current = sessionRunning;

  // Mirrors the chat pane's own live indicator into the terminal's window
  // title, so the thread and its progress stay visible even when the
  // terminal isn't focused. Ticks on the same `now` as the chat pane — no
  // extra timer.
  useEffect(() => {
    if (setTerminalTitle === undefined) return;
    const threadTitleText = selected?.title !== undefined && selected.title.length > 0 ? String(selected.title) : "Moxen";
    if (!sessionRunning) {
      setTerminalTitle(threadTitleText);
      return;
    }
    const anchor = selected?.latestTurn?.startedAt ?? selected?.latestTurn?.requestedAt ?? null;
    const started = anchor === null ? Number.NaN : Date.parse(anchor);
    const elapsedMs = Number.isNaN(started) ? 0 : Math.max(0, now - started);
    const frame = SPINNER[Math.floor(elapsedMs / 1000) % SPINNER.length] ?? "◐";
    setTerminalTitle(`${frame} ${threadTitleText} — working ${formatDuration(elapsedMs)}`);
  }, [setTerminalTitle, selected?.title, selected?.latestTurn, sessionRunning, now]);

  /**
   * Stop the open thread's in-flight turn, mirroring `moxen threads
   * interrupt`. Fire-and-forget: the thread subscription projects the
   * interruption once the server accepts it. Returns whether a turn was
   * running. Only the composer's stop button reaches this — escape paths
   * never do.
   */
  const interruptTurn = (): boolean => {
    if (openThreadId === null || !sessionRunning) return false;
    const nowMs = Date.now();
    if (nowMs - lastInterruptRef.current < 1_000) return true;
    lastInterruptRef.current = nowMs;
    void client
      .dispatch({
        type: "thread.turn.interrupt",
        threadId: openThreadId,
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
    return true;
  };

  /** Stops one background task; shared by the command palette and the background-tasks browser. */
  const stopBackgroundTask = (task: BackgroundTaskRow): void => {
    const threadId = selected?.id;
    if (!threadId) return;
    void client
      .dispatch({ type: "thread.background.stop", threadId, taskId: task.taskId })
      .then(() => toasts.push("background-stop", "info", `Stopped: ${backgroundTaskTitle(task)}`, COPY_TOAST_MS))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  /** Opens the command palette, remembering where esc should return focus. */
  const openCommandPalette = () => {
    // Nothing in it applies to a thread that does not exist yet.
    if (creating) return;
    setPaletteReturnFocus(focus);
    setDeleteArmed(false);
    setPickerFilter("");
    setPicker("command");
  };

  const {
    providers,
    providersError,
    model,
    effort,
    permission,
    permissionChoices,
    modelColor,
    labelFor,
    openModelPicker,
    openEffortPicker,
    openPermissionPicker,
    pickModel,
    pickEffort,
    setThreadRuntimeMode,
  } = useProviderCatalog({
    client,
    selected,
    openThreadId,
    creating,
    effectiveModelSelection,
    effectiveRuntimeMode,
    setCreatingModelSelection,
    setCreatingRuntimeMode,
    setPicker,
    setPickerFilter,
    setFocus,
    setError,
    closePicker,
  });

  // A 1s tick while a turn is in flight drives the thinking/working elapsed
  // counter; the 30s tick above is enough for sidebar ages when idle.
  useEffect(() => {
    if (!sessionRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessionRunning]);
  const contextUsageDisplay = threadState.contextUsage === null ? null : formatContextUsage(threadState.contextUsage);

  // -- side panel (Diff / Agents / Context / Background) --------------------
  const sidePanelOpen = sidePanel.tab !== null && !creating;
  const turnKey = `${selected?.latestTurn?.turnId ?? ""}:${selected?.latestTurn?.state ?? ""}`;
  const currentProvider = providers?.find((candidate) => candidate.instanceId === effectiveModelSelection?.instanceId) ?? null;
  const planUsage = usePlanUsage(
    client,
    turnKey,
    ui?.usageRefreshSeconds === undefined ? undefined : ui.usageRefreshSeconds * 1000,
  );
  const threadUsageLimits = currentProvider === null ? null : (planUsage[currentProvider.driver] ?? currentProvider.usageLimits);
  const planGauges = planUsageGauges(threadUsageLimits);
  const contextBreakdown = useContextBreakdown(
    client,
    openThreadId,
    sidePanelOpen && sidePanel.tab === "context",
    turnKey,
    ui?.contextRefreshSeconds === undefined ? undefined : ui.contextRefreshSeconds * 1000,
  );
  // A total-only reading (Claude's summary without categories, or no live
  // session) still shows what fills the window: the transcript estimate.
  const effectiveBreakdown = useMemo(
    () => effectiveContextBreakdown(contextBreakdown.breakdown, threadState.contextUsage, threadState.messages, threadState.activities),
    [contextBreakdown.breakdown, threadState.contextUsage, threadState.messages, threadState.activities],
  );
  const contextLive = contextBreakdown.live && (contextBreakdown.breakdown?.categories.length ?? 0) > 0;
  // Delegated tasks name their model as `instance/model`; the catalog turns
  // that into the name and brand colour the composer footer uses.
  const modelLabelOf = (reference: string) => {
    const slash = reference.indexOf("/");
    return slash < 0 ? { name: reference, color: null } : labelFor({ instanceId: reference.slice(0, slash), model: reference.slice(slash + 1) });
  };
  const agentRows = useMemo(
    () => agentThreads(shell.threads, openThreadId, now, (instanceId, model) => labelFor({ instanceId, model }).name),
    // `labelFor` reads the provider catalog; recompute when it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shell.threads, openThreadId, now, providers],
  );
  const subagentRows = useMemo(() => nativeSubagents(threadState.activities), [threadState.activities]);
  const diffTurns = threadState.checkpoints.filter((row) => row.files.length > 0);
  const runningAgents = agentRows.filter((agent) => agent.status === "running").length + subagentRows.filter((agent) => agent.running).length;
  const sideBadges: Partial<Record<SideTab, string | null>> = {
    diff: diffTurns.length > 0 ? String(diffTurns.length) : null,
    agents: runningAgents > 0 ? String(runningAgents) : agentRows.length + subagentRows.length > 0 ? String(agentRows.length + subagentRows.length) : null,
    context: contextUsageDisplay?.percent == null ? null : `${contextUsageDisplay.percent}%`,
    background: background.length > 0 ? String(background.length) : null,
  };
  /**
   * One tab at a time: leaving Diff closes the open diff (so a later diff-row
   * click opens rather than toggles a hidden one), and the Diff tab with
   * nothing open shows the latest turn that changed files. Also remembers
   * the tab for the timeline's reopen button (which is how the Agents tab —
   * the only one with no other opener — gets opened).
   */
  const [lastSideTab, setLastSideTab] = useState<SideTab>(ui?.defaultSidePanel ?? "context");
  const showSideTab = (tab: SideTab) => {
    markModalDismissed();
    setLastSideTab(tab);
    if (tab === "diff") {
      if (diffPanel.expandedTurn === null) {
        const latest = diffTurns.reduce((max, row) => Math.max(max, row.checkpointTurnCount), -1);
        if (latest >= 0) {
          diffPanel.openDiff(latest);
          return;
        }
      }
      sidePanel.open("diff");
      setFocus("diff");
      return;
    }
    if (diffPanel.expandedTurn !== null) diffPanel.closeDiff();
    sidePanel.open(tab);
    setFocus("diff");
  };
  const closeSidePanel = () => {
    markModalDismissed();
    if (diffPanel.expandedTurn !== null) diffPanel.closeDiff();
    sidePanel.close();
    setFocus("chat");
  };
  // The new-thread view starts clean: whatever panel the last thread had
  // open closes rather than coming back over the thread this one creates.
  useEffect(() => {
    if (!creating) return;
    if (diffPanel.expandedTurn !== null) diffPanel.closeDiff();
    sidePanel.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating]);
  const toggleSideTab = (tab: SideTab) => {
    if (sidePanelOpen && sidePanel.tab === tab) closeSidePanel();
    else showSideTab(tab);
  };
  const openThreadFromPanel = (threadId: string) => {
    setCreating(false);
    setPicker(null);
    setPickerFilter("");
    setOpenThreadId(threadId);
  };

  // Pane-OUTER width (borders included): the composer, tasks, and answer
  // panels fill this exact slot edge-to-edge. Inner text budgets subtract
  // their own chrome from it below — never shrink the slot itself, or the
  // raised panels end short of the pane edge.
  const chatWidth = Math.max(
    20,
    width - SIDEBAR_WIDTH - (sidePanelOpen ? diffPanel.diffWidth : 0) - CHAT_GUTTER * 2,
  );
  /** Toasts stay entirely inside one pane's own bounds, with a 1-col margin:
      the side panel's while it is open, the chat/timeline pane's otherwise —
      never floating over the sidebar or straddling panes. */
  const toastGeometry = useMemo(() => {
    const chatLeft = SIDEBAR_WIDTH + CHAT_GUTTER;
    const diffLeft = sidePanelOpen ? chatLeft + chatWidth : null;
    const paneLeft = diffLeft ?? chatLeft;
    const paneWidth = diffLeft === null ? chatWidth : diffPanel.diffWidth;
    const paneRight = paneLeft + paneWidth;
    const toastWidth = Math.min(60, Math.max(24, paneWidth - TOAST_INSET * 2));
    return {
      left: Math.max(paneLeft + TOAST_INSET, paneRight - TOAST_INSET - toastWidth),
      width: toastWidth,
    };
  }, [chatWidth, diffPanel.diffWidth, sidePanelOpen]);
  const projectTitle =
    shell.projects.find((project) => project.id === effectiveProjectId)?.title ?? "this project";

  /** "Resume with less context" — same trigger as the desktop banner: a
      Claude snapshot holding >= 100k tokens that hasn't refreshed in >= 70
      minutes (see `shouldOfferResumeCompaction`). Keyed per (thread,
      snapshot) so only a fresh snapshot reopens it after dismissal. */
  const resumeKey = resumeCompactionKey(threadState);
  const resumeBanner =
    creating ||
    resumeKey === null ||
    resumeKey === dismissedResumeKey ||
    !shouldOfferResumeCompaction(threadState, effectiveModelSelection?.instanceId, now)
      ? null
      : { key: resumeKey, usedTokens: threadState.contextUsage?.usedTokens ?? 0 };
  /** What waits over the composer, most urgent first; the banner pages between them. */
  const notices: Notice[] = [];
  if (usageBanner.banner !== null) {
    const banner = usageBanner.banner;
    notices.push({
      key: "usage",
      glyph: "◔",
      glyphColor: banner.wrapUp ? COLOR.warn : COLOR.danger,
      title: "Usage limit reached",
      tags: [
        ...(banner.wrapUp ? [{ text: "wrapping up", color: COLOR.warn }] : []),
        ...(banner.windowLabel === null ? [] : [{ text: `${banner.windowLabel} limit`, color: COLOR.dim }]),
      ],
      detail:
        banner.continueAt !== null ? (
          <>
            <text fg={COLOR.dim} selectable={false}>{"  Continues at "}</text>
            <text fg={COLOR.warn} selectable={false}>{clock(banner.continueAt)}</text>
            <text fg={COLOR.faint} selectable={false}>{` (${untilLabel(new Date(banner.continueAt), now)})`}</text>
            <text fg={COLOR.dim} selectable={false}>{", once the limit has reset"}</text>
          </>
        ) : banner.resetsAt === null ? (
          <text fg={COLOR.dim} selectable={false}>{"  Resets when the provider allows"}</text>
        ) : (
          <>
            <text fg={COLOR.dim} selectable={false}>{"  Resets at "}</text>
            <text fg={COLOR.warn} selectable={false}>{clock(banner.resetsAt.toISOString())}</text>
            <text fg={COLOR.faint} selectable={false}>{` (${untilLabel(banner.resetsAt, now)})`}</text>
          </>
        ),
      actions:
        banner.continueAt !== null
          ? [{ label: "Cancel continue", fg: COLOR.dim, hoverFg: COLOR.text, onClick: usageBanner.cancelContinue }]
          : [
              // Short labels on purpose: the three actions share one row with
              // the title, and a longer pair pushed Dismiss off the edge.
              // Read together: continue [at reset | in a new thread].
              ...(banner.resetsAt === null ? [] : [{ label: "Continue at reset", fg: COLOR.accent, onClick: usageBanner.scheduleContinue }]),
              // A fresh context instead of resuming a long one: the handoff
              // carries the work, and waits for the reset if it has not come.
              // Only once the assistant has said something to hand over.
              ...(lastAssistantMessage === null ? [] : [{ label: "In a new thread", fg: COLOR.accent, onClick: usageBanner.continueInNewThread }]),
              { label: "Dismiss", fg: COLOR.dim, hoverFg: COLOR.text, onClick: usageBanner.dismiss },
            ],
    });
  }
  if (resumeBanner !== null) {
    notices.push({
      key: "resume",
      glyph: "◈",
      glyphColor: COLOR.warn,
      title: "Resume with less context",
      detail: <text fg={COLOR.dim} selectable={false}>{`  ${formatTokenCount(resumeBanner.usedTokens)} tokens from earlier`}</text>,
      actions: [
        { label: "Compact", fg: COLOR.accent, onClick: () => compactSession(() => setDismissedResumeKey(resumeBanner.key)) },
        { label: "Keep full history", fg: COLOR.dim, hoverFg: COLOR.text, onClick: () => setDismissedResumeKey(resumeBanner.key) },
      ],
    });
  }
  const noticePager = useNoticePager(notices.map((notice) => notice.key));

  /**
   * Modal bodies: the model list across providers plus a provider shortcut
   * section, one section per effort descriptor of the current model, every
   * turn that produced file changes for the diff-turn picker, or the
   * command palette's copy/thread/export/jump sections.
   */
  const pickerBody: PickerBody = useMemo(() => {
    if (picker === null) return { kind: "list", sections: [] };
    // Message actions need no catalog either: copy plus a checkpoint-backed
    // history revert for the clicked user turn (assistant clicks copy
    // directly and never reach this modal).
    if (picker === "message") {
      if (messageActionEntry === null) return { kind: "list", sections: [] };
      const entry = messageActionEntry;
      const checkpoint = threadState.checkpoints.find((row) => row.turnId === entry.turnId) ?? null;
      const revertTarget = checkpoint === null ? null : checkpoint.checkpointTurnCount - 1;
      // A missing checkpoint on the latest turn of a running session means
      // "not created yet" — say so instead of the cryptic stock reason.
      const isLatestTurn =
        entry.turnId !== null && groups.length > 0 && groups[groups.length - 1]?.turnId === entry.turnId;
      const revertMissingMeta = sessionRunning && isLatestTurn ? "turn still running" : "no checkpoint for this turn";
      return {
        kind: "list",
        sections: [
          {
            rows: [
              {
                key: "message:copy",
                label: "Copy",
                meta: `${entry.text.length} chars`,
                onPick: () => {
                  closePicker("chat");
                  copyMessage(entry);
                },
              },
              // A message still waiting can be taken back before it runs.
              ...(entry.queued !== undefined && entry.turnId !== null && openThreadId !== null
                ? [
                    {
                      key: "message:cancel",
                      label: entry.queued.scheduledFor === null ? "Cancel queued message" : "Cancel scheduled message",
                      onPick: () => {
                        closePicker("chat");
                        const turnId = entry.turnId!;
                        void client
                          .dispatch({ type: "thread.turn.interrupt", threadId: openThreadId, turnId })
                          .then(() => toasts.push("queued-cancel", "info", "Message cancelled", 2500))
                          .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
                      },
                    },
                  ]
                : []),
              revertTarget === null
                ? {
                    key: "message:revert",
                    label: "Revert to before this turn",
                    meta: revertMissingMeta,
                    disabled: true,
                    onPick: () => {},
                  }
                : {
                    key: "message:revert",
                    label: revertArmed === "conversation" ? "Confirm revert" : "Revert to before this turn",
                    meta: revertArmed === "conversation" ? "enter again to confirm · keeps files" : "conversation only",
                    onPick: () => revertMessageTurn(entry, revertTarget, "conversation"),
                  },
              // The files too, from the snapshot taken before this turn ran.
              revertTarget === null || checkpoint?.status !== "available"
                ? {
                    key: "message:revert-files",
                    label: "Revert conversation and files",
                    meta: revertTarget === null ? revertMissingMeta : "no file snapshot for this turn",
                    disabled: true,
                    onPick: () => {},
                  }
                : {
                    key: "message:revert-files",
                    label: revertArmed === "files" ? "Confirm revert with files" : "Revert conversation and files",
                    meta:
                      revertArmed === "files"
                        ? "enter again to confirm · files go back to before this turn"
                        : "files back to before this turn, new ones removed",
                    onPick: () => revertMessageTurn(entry, revertTarget, "files"),
                  },
            ],
          },
        ],
      };
    }
    // The command palette needs no provider catalog either: only thread,
    // shell, and transcript state the app already holds.
    if (picker === "command") {
      const projectPath = shell.projects.find((project) => project.id === selected?.projectId)?.workspaceRoot ?? null;
      const branchName = selected?.branch ?? null;
      const jumpRows = groups.flatMap((group, index) => {
        const first = group.prompts[0];
        if (first === undefined) return [];
        const line = first.text.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || "(empty prompt)";
        return [
          {
            key: `jump:${group.id}`,
            label: line,
            meta: clock(first.at),
            onPick: () => {
              closePicker("chat");
              diffPanel.scrollTimelineToIndex(index);
            },
          },
        ];
      });
      return {
        kind: "list",
        sections: [
          {
            header: "Copy",
            rows: [
              {
                key: "copy:path",
                label: "Copy project path",
                onPick: () => copyPaletteText(projectPath, "no project path for this thread"),
              },
              {
                key: "copy:branch",
                label: "Copy branch",
                ...(branchName === null ? {} : { meta: branchName }),
                onPick: () => copyPaletteText(branchName, "this thread has no branch"),
              },
              {
                key: "copy:thread",
                label: "Copy thread ID",
                ...(openThreadId === null ? {} : { meta: `${openThreadId.slice(0, 8)}…` }),
                onPick: () => copyPaletteText(openThreadId, "no open thread"),
              },
              {
                key: "copy:last",
                label: "Copy last assistant message",
                ...(lastAssistantMessage === null ? {} : { meta: `${lastAssistantMessage.length} chars` }),
                onPick: () => copyPaletteText(lastAssistantMessage, "no assistant message yet"),
              },
            ],
          },
          {
            header: "Thread",
            rows: [
              {
                key: "thread:new",
                label: "New thread",
                ...(selected === null ? {} : { meta: projectTitle }),
                onPick: () => {
                  startNewThread();
                  closePicker("composer");
                },
              },
              {
                key: "thread:new-project",
                label: "New thread in project…",
                onPick: () => {
                  if (!creating) {
                    setCreatingModelSelection(null);
                    setCreatingRuntimeMode(null);
                    setCreatingProjectId(null);
                    setCreating(true);
                  }
                  setPickerFilter("");
                  setPicker("project");
                },
              },
              {
                key: "thread:settle",
                label: selected !== null && threadStatus(selected, Date.now()) === "settled" ? "Unsettle thread" : "Settle thread",
                onPick: toggleSettleThread,
              },
              {
                key: "thread:regenerate-title",
                label: "Regenerate title",
                onPick: regenerateThreadTitle,
              },
              {
                key: "thread:rename",
                label: "Rename thread",
                onPick: () => {
                  setPickerFilter("");
                  setPicker("rename");
                },
              },
              {
                key: "thread:archive",
                label: "Archive thread",
                onPick: archiveThread,
              },
              {
                key: "message:schedule",
                label: "Schedule message",
                // What is in the composer goes, at a time asked for next.
                ...(draft.trim().length === 0
                  ? { meta: "write it in the composer first", disabled: true, onPick: () => {} }
                  : {
                      meta: truncate(draft.trim().replace(/\s+/gu, " "), 32),
                      onPick: () => {
                        setPickerFilter("");
                        setPicker("schedule");
                      },
                    }),
              },
              {
                key: "thread:compact",
                label: "Compact session",
                ...(entries.length === 0
                  ? { meta: "no turns yet", disabled: true, onPick: () => {} }
                  : { onPick: compactSession }),
              },
              ...(background.length === 0
                ? []
                : [
                    {
                      key: "background:browse",
                      label: "View background tasks",
                      meta: `${background.length} running`,
                      onPick: () => setPicker("background-tasks"),
                    },
                  ]),
              // One row per background task running in the session.
              ...background.map((task) => ({
                key: `background:stop:${task.taskId}`,
                label: `Stop background: ${backgroundTaskTitle(task)}`,
                meta: task.taskType === "local_agent" ? "agent" : "shell",
                onPick: () => {
                  closePicker("chat");
                  stopBackgroundTask(task);
                },
              })),
              deleteSupported
                ? {
                    key: "thread:delete",
                    label: deleteArmed ? "Confirm delete thread" : "Delete thread",
                    meta: deleteArmed ? "enter again to confirm" : "irreversible",
                    onPick: deleteThread,
                  }
                : {
                    key: "thread:delete",
                    label: "Delete thread",
                    meta: "not supported by server",
                    disabled: true,
                    onPick: () => {},
                  },
            ],
          },
          {
            header: "Panels",
            rows: (["diff", "git", "context", "agents", "background"] as const).map((tab) => ({
              key: `panel:${tab}`,
              label: `${sidePanelOpen && sidePanel.tab === tab ? "Hide" : "Show"} ${SIDE_TAB_LABEL[tab]} panel`,
              ...(sideBadges[tab] == null ? {} : { meta: sideBadges[tab]! }),
              onPick: () => {
                closePicker("chat");
                toggleSideTab(tab);
              },
            })),
          },
          {
            header: "Export",
            rows: [
              {
                key: "thread:export",
                label: "Export thread to markdown",
                // A prompt alone (sent, then stopped by a limit) is not a
                // thread worth exporting: the assistant has to have said something.
                ...(lastAssistantMessage === null
                  ? { meta: entries.length === 0 ? "no turns yet" : "no reply yet", disabled: true, onPick: () => {} }
                  : { meta: `${groups.length} turn${groups.length === 1 ? "" : "s"}`, onPick: exportThread }),
              },
              {
                key: "thread:continue",
                label: "Continue in a new thread",
                // Same project, model and checkout; a handoff written from
                // this thread. Held for the reset while a usage limit stands.
                // Nothing to hand over until the assistant has replied.
                ...(lastAssistantMessage === null
                  ? { meta: entries.length === 0 ? "no turns yet" : "no reply yet", disabled: true, onPick: () => {} }
                  : {
                      meta: usageBanner.banner?.resetsAt ? "after the reset" : "fresh context",
                      onPick: () => {
                        closePicker("chat");
                        usageBanner.continueInNewThread();
                      },
                    }),
              },
            ],
          },
          ...(jumpRows.length === 0 ? [] : [{ header: "Jump to message", rows: jumpRows }]),
        ],
      };
    }
    // Answering the open agent question: one picker page per question,
    // options as rows (single-select picks advance immediately, multi-select
    // toggles until Continue), plus a custom-answer row unless disallowed.
    // The diff-turn list needs no provider catalog either.
    if (picker === "diff-turn") {
      const turns = threadState.checkpoints
        .filter((row) => row.files.length > 0)
        .slice()
        .sort((left, right) => left.checkpointTurnCount - right.checkpointTurnCount);
      return {
        kind: "list",
        sections: [
          {
            rows: turns.map((row) => {
              const added = row.files.reduce((total, file) => total + file.additions, 0);
              const removed = row.files.reduce((total, file) => total + file.deletions, 0);
              return {
                key: `turn:${row.checkpointTurnCount}`,
                label: `Turn ${row.checkpointTurnCount}`,
                meta: `${row.files.length} file${row.files.length === 1 ? "" : "s"} +${added} -${removed}`,
                selected: row.checkpointTurnCount === diffPanel.expandedTurn,
                onPick: () => pickDiffTurn(row.checkpointTurnCount),
              };
            }),
          },
        ],
      };
    }
    // The new-thread project list needs no provider catalog either: every
    // known project, with the effective (picked or inherited) one marked,
    // led by a row that creates a project from a local folder.
    if (picker === "project") {
      return {
        kind: "list",
        sections: [
          {
            rows: [
              {
                key: "project:new",
                label: "+ New project from local folder",
                onPick: () => {
                  setPickerFilter("");
                  setPicker("project-new");
                },
              },
              ...shell.projects.map((project) => {
                const root = typeof project.workspaceRoot === "string" ? project.workspaceRoot : "";
                const shortRoot = root.replace(/\\/g, "/").split("/").pop() ?? null;
                return {
                  key: `project:${project.id}`,
                  label: String(project.title ?? project.id),
                  ...(shortRoot === null || shortRoot.length === 0 ? {} : { meta: shortRoot }),
                  selected: project.id === effectiveProjectId,
                  onPick: () => pickCreatingProject(project.id),
                };
              }),
            ],
          },
        ],
      };
    }
    // Permission levels need no provider catalog: the choices derive from
    // the open thread's provider snapshot (or every known mode until it
    // loads), so this branch sits above the catalog loading gate.
    if (picker === "permission") {
      const shown = compatibleRuntimeMode(effectiveRuntimeMode ?? "full-access", permissionChoices);
      return {
        kind: "list",
        sections: [
          {
            rows: permissionChoices.map((choice) => ({
              key: `permission:${choice.mode}`,
              label: choice.label,
              meta: choice.description,
              selected: shown === choice.mode,
              onPick: () => setThreadRuntimeMode(choice.mode),
            })),
          },
        ],
      };
    }
    if (providers === null) {
      if (providersError !== null) return { kind: "error", message: providersError };
      return { kind: "loading" };
    }
    if (picker === "effort") {
      const current = effectiveModelSelection;
      const catalogModel = providers
        .find((provider) => provider.instanceId === current?.instanceId)
        ?.models.find((model) => model.slug === current?.model);
      const descriptors = catalogModel?.efforts ?? [];
      return {
        kind: "list",
        sections: descriptors.map((descriptor) => {
          const picked =
            (current?.options ?? []).find((option) => option.id === descriptor.id)?.value ?? descriptor.currentValue;
          return {
            header: descriptor.label,
            rows: descriptor.choices.map((choice) => ({
              key: `${descriptor.id}:${choice.id}`,
              label: `${choice.label}${choice.isDefault === true ? " (default)" : ""}`,
              selected: picked === choice.id,
              onPick: () => pickEffort(descriptor.id, choice.id),
            })),
          };
        }),
      };
    }
    const current = effectiveModelSelection;
    // A thread that hasn't started yet has no provider to lock to — offer
    // every *enabled* provider, grouped into sections so browsing them stays
    // sane. Disabled instances still report their models over getConfig, but
    // selecting them fails, so they are hidden (same as the desktop picker).
    // Hidden models (`providerModelPreferences`) are skipped except the
    // current one, which stays marked so a since-hidden selection still reads.
    if (creating) {
      return {
        kind: "list",
        sections: offerableProviders(providers)
          .map((provider) => ({
            provider,
            models: offerableModels(
              provider,
              provider.instanceId === current?.instanceId ? current?.model : undefined,
            ),
          }))
          .filter(({ models }) => models.length > 0)
          .map(({ provider, models }) => ({
            header: provider.displayName ?? provider.instanceId,
            rows: models.map((model) => ({
              key: `${provider.instanceId}:${model.slug}`,
              label: model.name,
              selected: current?.instanceId === provider.instanceId && current?.model === model.slug,
              onPick: () => pickModel({ instanceId: provider.instanceId, model: model.slug }),
            })),
          })),
      };
    }
    // An open thread already has a live session on one provider — there is
    // no in-picker provider switch, so only that provider's models are offered
    // (even when the instance has since been disabled — the thread is already
    // on it). Hidden models are skipped except the current one.
    const provider = providers.find((candidate) => candidate.instanceId === current?.instanceId);
    const offered = provider === undefined ? [] : offerableModels(provider, current?.model);
    return {
      kind: "list",
      sections: [
        {
          rows: offered.map((model) => ({
            key: `${provider?.instanceId}:${model.slug}`,
            label: model.name,
            selected: current?.model === model.slug,
            onPick: () => pickModel({ instanceId: provider!.instanceId, model: model.slug }),
          })),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, providers, providersError, effectiveModelSelection, effectiveRuntimeMode, permissionChoices, creating, deleteArmed, deleteSupported, revertArmed, answerDraft, background]);

  /** Wider and taller than a picker: the task browser shows commands and live output. */
  /**
   * The Git tab's write prompts. A forge write is outward-facing, so the
   * tab never dispatches one directly — it asks for this, and the answer
   * is what gets sent.
   */
  const [forgePrompt, setForgePrompt] = useState<{ kind: "create"; draft: boolean } | { kind: "comment"; number: number } | null>(null);
  // Local history and the forge, read only while the Git tab is showing.
  const gitPanel = useGitPanel(client, selected?.id ?? null, sidePanel.tab === "git");
  /**
   * Who opens a pull request when asked: the thread's own agent, which
   * knows the work — or, while its provider is at a usage limit, another
   * provider with usage left, delegated the task in this checkout (it starts
   * cold, so its prompt says to read the branch first). Moxen drives agents;
   * the user only types a title when they choose to open it by hand.
   */
  const threadLimited = usageBanner.banner !== null;
  const handOff = threadLimited ? handOffTarget(providers, currentProvider?.instanceId ?? null, planUsage) : null;
  const requestOpener = { label: !threadLimited ? "the agent" : (handOff?.label ?? null) };
  const agentOpenRequest = (draft: boolean) => {
    if (selected === null) return;
    const kind = gitPanel.forge?.kind ?? null;
    const noun = requestNoun(kind);
    const branch = gitPanel.overview?.status?.branch ?? null;
    if (!threadLimited) {
      send(openRequestPrompt({ kind, draft, branch, cold: false }), "queue");
      toasts.push("forge-agent", "info", `Asked the agent to open a ${draft ? "draft " : ""}${noun.short}`, COPY_TOAST_MS);
      return;
    }
    if (handOff === null) return;
    void client
      .dispatch({
        type: "thread.delegate",
        parentThreadId: selected.id,
        task: openRequestPrompt({ kind, draft, branch, cold: true }),
        title: `Open a ${draft ? "draft " : ""}${noun.short}`,
        provider: handOff.instanceId,
        model: handOff.model,
        wait: false,
        isolation: "shared",
      })
      .then(() => toasts.push("forge-agent", "info", `${handOff.label} is opening the ${noun.short} (see Agents); it reports back here`, COPY_TOAST_MS))
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  const backgroundGeometry = useMemo(() => {
    const panelWidth = Math.min(100, Math.max(30, width - 8));
    const panelHeight = Math.min(32, Math.max(10, height - 4));
    return {
      width: panelWidth,
      height: panelHeight,
      left: Math.max(0, Math.floor((width - panelWidth) / 2)),
      top: Math.max(0, Math.floor((height - panelHeight) / 2)),
    };
  }, [width, height]);
  const pickerGeometry = useMemo(() => {
    const panelWidth = Math.min(64, Math.max(30, width - 6));
    const panelHeight = Math.min(24, Math.max(10, height - 6));
    return {
      width: panelWidth,
      height: panelHeight,
      left: Math.max(0, Math.floor((width - panelWidth) / 2)),
      top: Math.max(0, Math.floor((height - panelHeight) / 2)),
    };
  }, [width, height]);

  /** Small centered prompt for the rename modal: title + input + hint. */
  const renameGeometry = useMemo(() => {    const panelWidth = Math.min(64, Math.max(30, width - 6));
    const panelHeight = 7;
    return {
      width: panelWidth,
      height: panelHeight,
      left: Math.max(0, Math.floor((width - panelWidth) / 2)),
      top: Math.max(0, Math.floor((height - panelHeight) / 2)),
    };
  }, [width, height]);
  /**
   * Ctrl+C confirm geometry: full-size (`width - 4 × height - 4`, 2-col
   * margin) so the quit decision reads as a terminal-level interrupt, not
   * another small picker.
   */
  const quitGeometry = useMemo(() => {
    const panelWidth = Math.min(70, Math.max(30, width - 6));
    const panelHeight = Math.min(10, Math.max(8, height - 4));
    return {
      width: panelWidth,
      height: panelHeight,
      left: Math.max(0, Math.floor((width - panelWidth) / 2)),
      top: Math.max(0, Math.floor((height - panelHeight) / 2)),
    };
  }, [width, height]);

  /**
   * Message-actions modal sized to its content (title + search + rows +
   * hint), not the full picker frame — two rows shouldn't float in twenty.
   */
  const messageGeometry = useMemo(() => {
    const panelWidth = Math.min(64, Math.max(30, width - 6));
    const rows = pickerBody.kind === "list" ? pickerBody.sections.reduce((total, section) => total + section.rows.length, 0) : 0;
    const panelHeight = Math.min(24, 8 + rows);
    return {
      width: panelWidth,
      height: panelHeight,
      left: Math.max(0, Math.floor((width - panelWidth) / 2)),
      top: Math.max(0, Math.floor((height - panelHeight) / 2)),
    };
  }, [width, height, pickerBody]);

  const submitComposer = () => {
    if (editingExternallyRef.current) return;
    if (creating) createThread(draft);
    else send(draft);
  };
  const escapeComposer = () => {
    if (creating) {
      // Zero-thread workspace: there is no transcript to cancel back to,
      // so esc stays in the creating view instead of stranding the UI.
      if (selected === null) {
        setFocus("chat");
        return;
      }
      setCreating(false);
      setCreatingModelSelection(null);
      setCreatingRuntimeMode(null);
      setCreatingProjectId(null);
      setFocus("chat");
      return;
    }
    // Escape only unfocuses back to the chat pane — it never stops a running
    // turn (that's the composer's stop button now).
    setFocus("chat");
  };
  const composerPlaceholder = editingExternally
    ? "Editing in external editor…"
    : creating
      ? "Ask for changes, send follow-ups, or attach images"
      : "Message the agent (@img.png or alt+v to attach)";
  /**
   * The composer holds keyboard focus only when no modal is open: an open
   * picker owns all keystrokes (type to filter), so a still-focused textarea
   * would swallow them into the draft and keep blinking. Closing restores
   * focus via closePicker's explicit target.
   */
  const composerFocused =
    focus === "composer" && picker === null && !quitConfirmOpen && !sideQuestion.open && forgePrompt === null;
  /**
   * Inline answer panel for the pending agent question, rendered in place
   * of the composer (both slots below). Render-time closures, so picks and
   * toggles always read fresh draft state.
   */
  const renderAnswerPanel = (panelWidth: number) => {
    if (answerDraft === null || activeAnswerRequest === null || activeAnswerQuestion === null) return null;
    const draft = answerDraft;
    const question = activeAnswerQuestion;
    return (
      <AnswerPanel
        key={`${draft.requestId}:${draft.index}`}
        question={question}
        position={draft.index}
        total={activeAnswerRequest.questions.length}
        width={panelWidth}
        suspended={picker === "answer-custom"}
        pickedValues={draft.selected[question.id] ?? []}
        onToggleOption={(value) => toggleAnswerOption(draft, question.id, value)}
        onPickOption={(value) => answerCurrentQuestion(question.id, { selected: [value] })}
        onCustom={() => setPicker("answer-custom")}
        onContinue={() => {
          const resolved = resolveAnswerQuestion(question, draft);
          if (resolved === null) {
            setError("pick at least one option");
            return;
          }
          answerCurrentQuestion(question.id, {});
        }}
        onDismiss={dismissAnswerRequest}
      />
    );
  };

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, backgroundColor: SURFACE.base }}>
      {/* Boot gate: sidebar + transcript stay hidden until both snapshots
          land — an empty shell is otherwise indistinguishable from "no
          threads". Toasts, the quit confirm, and pickers below stay mounted
          so boot errors and ctrl+c still surface over the loading screen. */}
      {bootReady ? (
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Sidebar
          sections={sections}
          openThreadId={openThreadId}
          markedThreadIds={markedThreadIds}
          settledExpanded={settledExpanded}
          width={SIDEBAR_WIDTH}
          now={now}
          height={height}
          screenWidth={width}
          backdrop={ui?.backdrop === "off" ? "off" : ui?.backdrop === "static" ? "static" : "animated"}
          openSubagentId={subagentView.target?.agentId ?? null}
          onOpenThread={(threadId) => {
            // A thread row always shows the thread itself: clicking the
            // parent of an open subagent goes back to the parent.
            subagentView.close();
            setFocus("chat");
            setCreating(false);
            setPicker(null);
            setPickerFilter("");
            setOpenThreadId(threadId);
          }}
          onOpenSubagents={(threadId, agentId) => {
            setFocus("chat");
            setCreating(false);
            setPicker(null);
            setPickerFilter("");
            setOpenThreadId(threadId);
            subagentView.open(threadId, agentId);
          }}
          onToggleSettled={toggleSettledExpanded}
          onShowMore={showMoreSettled}
          onSelectMode={setSidebarMode}
          onToggleProject={toggleSidebarProject}
          onCycleProject={cycleSidebarProject}
          onNewThread={startNewThread}
          panelsOpen={sidePanelOpen}
          onTogglePanels={() => {
            // The new-thread view has no panels to show.
            if (creating) return;
            if (sidePanelOpen) closeSidePanel();
            else showSideTab(lastSideTab);
          }}
          onOpenSettings={() => {
            setPickerFilter("");
            setPicker("settings");
          }}
        />
        {creating ? (
          <box
            style={{
              flexDirection: "column",
              flexGrow: 1,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: SURFACE.base,
            }}
          >
            {/* Faint control-plane texture behind the empty state only:
                grid + drifting status dots, zinc palette, unmounted (zero
                cost) in thread view. offsetX is the pane's raw terminal
                origin (the builder mods it) and the field spans the whole
                screen with the sidebar's — one lattice, one swarm.
                Foreground column sits above at zIndex 1 with its own opaque
                surfaces so text never seams. */}
            {ui?.backdrop === "off" ? null : (
              <MonitoringBackdrop
                width={Math.max(0, width - SIDEBAR_WIDTH)}
                height={height}
                offsetX={SIDEBAR_WIDTH}
                fieldWidth={width}
                fieldHeight={height}
                motion={ui?.backdrop === "static" ? "static" : "animated"}
              />
            )}
            {/* Explicit max-width column: alignItems:center shrink-wraps
                children, so the composer needs its own width instead of
                stretching like it does in the thread view. */}
            <box
              style={{
                flexDirection: "column",
                flexShrink: 0,
                width: Math.min(76, Math.max(40, width - SIDEBAR_WIDTH - 8)),
                zIndex: 1,
              }}
            >
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "center" }}>
                <text fg={COLOR.bright} selectable={false} onMouseDown={openProjectPicker}>{`What should we build in `}</text>
                <text
                  fg={COLOR.bright}
                  attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
                  selectable={false}
                  onMouseDown={openProjectPicker}
                >{projectTitle}</text>
                <text fg={COLOR.bright} selectable={false} onMouseDown={openProjectPicker}>{"?"}</text>
              </box>
              {answerVisible ? (
                renderAnswerPanel(Math.min(76, Math.max(40, width - SIDEBAR_WIDTH - 8)))
              ) : (
              <Composer
                draft={draft}
                resetKey={composerResetKey}
                onInput={setDraft}
                onSubmit={submitComposer}
                onEscape={escapeComposer}
                onFocus={() => setFocus("composer")}
                focused={composerFocused}
                placeholder={composerPlaceholder}
                model={model}
                modelColor={modelColor}
                effort={effort}
                permission={permission}
                attachments={pending.map((attachment) => attachment.name)}
                onAttachmentRemoved={detachImage}
                onClaimPaste={claimPaste}
                submitVerb="creates"
                running={false}
                width={Math.min(76, Math.max(40, width - SIDEBAR_WIDTH - 8))}
                hideHint
                onModelClick={openModelPicker}
                onEffortClick={openEffortPicker}
                onPermissionClick={openPermissionPicker}
                onCopyClick={copyDraft}
                onExternalEditClick={editDraftExternally}
                editingExternally={editingExternally}
                skills={skillInventory?.skills}
                skillPrefix={skillInventory?.trigger}
              />
              )}
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "center", marginTop: 1 }}>
                <text fg={COLOR.faint} selectable={false}>{"enter creates · click project to change · esc cancels"}</text>
              </box>
            </box>
          </box>
        ) : (
        // One breathing column on each side of the chat stack: the pane
        // sits off the sidebar and the terminal edge. Inner breathing
        // comes from the scrollbox/composer padding instead.
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: CHAT_GUTTER, paddingRight: CHAT_GUTTER }}>
          {/* Post-boot thread switches (and resyncs) reset `threadState`
              before the new snapshot lands — hold a loading row instead of
              flashing an empty transcript that reads as "no messages". */}
          {threadState.synchronized ? (
          <Timeline
            groups={subagentView.target === null ? groups : subagentView.groups}
            title={
              subagentView.target !== null
                ? `◇ ${subagentTitle(subagentView.transcript, subagentRows.find((row) => row.agentId === subagentView.target?.agentId)?.agentType ?? null)}`
                : selected === null
                  ? "no thread"
                  : String(selected.title ?? selected.id)
            }
            subtitle={subagentView.target !== null ? "subagent" : `${session?.status ?? "idle"}`}
            modelForTurn={(turnId) =>
              labelFor(
                turnModelSelection(
                  {
                    modelSelection: selected?.modelSelection,
                    turnModelSelections: threadState.thread?.turnModelSelections ?? selected?.turnModelSelections,
                  },
                  turnId,
                ),
              )
            }
            modelLabel={modelLabelOf}
            homeDir={homeDir}
            expandedTurn={diffPanel.expandedTurn}
            expandedWork={diffPanel.expandedWork}
            onToggleWork={diffPanel.toggleWork}
            scrollRef={chatScrollRef}
            focused={focus === "chat"}
            onFocus={() => setFocus("chat")}
            onOpenDiff={diffPanel.openDiff}
            onOpenMessageActions={openMessageActions}
            onOpenUrl={openFetchedUrl}
            turnFileDiffs={diffPanel.turnPatchCache.current}
            gitFiles={diffPanel.gitPatchCache.current}
            width={chatWidth}
            sessionStatus={session?.status ?? "idle"}
            now={now}
            turnStartedAt={selected?.latestTurn?.startedAt ?? selected?.latestTurn?.requestedAt ?? null}
          />
          ) : (
            <box style={{ flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
              <text fg={COLOR.dim} selectable={false}>{"loading transcript…"}</text>
            </box>
          )}
          {/* One blank row between the timeline frame and the tasks header;
              below, the last task row sits flush onto the notice rule. The
              composer always keeps its blank row above — a bordered frame
              needs air, unlike the thin rule. With tasks hidden the notice
              drops its rule — the frame's own border is separator enough —
              but keeps the blank row. */}
          {dockPane === "tasks" && plan !== null ? (
            <TasksPanel plan={plan} width={chatWidth} {...(dockPagerControl ? { pager: dockPagerControl } : {})} />
          ) : dockPane === "queued" ? (
            <QueuedPanel
              items={queued.items}
              width={chatWidth}
              now={now}
              onCancel={queued.cancel}
              {...(dockPagerControl ? { pager: dockPagerControl } : {})}
            />
          ) : null}
          <NoticeBanner
            notices={notices}
            index={noticePager.index}
            onPage={noticePager.setIndex}
            width={chatWidth}
            {...(dockPane !== null ? { flushTop: true } : { tight: true })}
          />
          {subagentView.target !== null ? (
            <SubagentBar
              title={subagentTitle(subagentView.transcript, subagentRows.find((row) => row.agentId === subagentView.target?.agentId)?.agentType ?? null)}
              state={subagentState(subagentView.transcript, now)}
              width={chatWidth}
              onBack={subagentView.close}
            />
          ) : answerVisible ? (
            renderAnswerPanel(chatWidth)
          ) : (
          <Composer
            draft={draft}
            resetKey={composerResetKey}
            onInput={setDraft}
            onSubmit={submitComposer}
            onEscape={escapeComposer}
            onFocus={() => setFocus("composer")}
            focused={composerFocused}
            placeholder={composerPlaceholder}
            suggestion={suggestedPrompt}
            model={model}
            modelColor={modelColor}
            effort={effort}
            permission={permission}
            attachments={pending.map((attachment) => attachment.name)}
            onAttachmentRemoved={detachImage}
                onClaimPaste={claimPaste}
            submitVerb="sends"
            running={sessionRunning}
            waitingOutLimit={!sessionRunning && usageBanner.banner?.continueAt != null}
            width={chatWidth}
            onModelClick={openModelPicker}
            onEffortClick={openEffortPicker}
            onPermissionClick={openPermissionPicker}
            onStopClick={interruptTurn}
            onQueue={() => {
              if (!editingExternallyRef.current) send(draft, "queue");
            }}
            onCopyClick={copyDraft}
            onExternalEditClick={editDraftExternally}
            editingExternally={editingExternally}
            skills={skillInventory?.skills}
            skillPrefix={skillInventory?.trigger}
            contextUsage={contextUsageDisplay}
            onContextUsageClick={() => toggleSideTab("context")}
            backgroundSummary={backgroundSummaryLabel(background)}
            onBackgroundClick={() => toggleSideTab("background")}
            planUsage={planGauges}
            onPlanUsageClick={() => toggleSideTab("context")}
          />
          )}
        </box>
        )}
        {!sidePanelOpen || sidePanel.tab === null ? null : (
          <box style={{ width: diffPanel.diffWidth, flexDirection: "column", flexShrink: 0 }}>
            {/* Tabs sit in the frame's own top line (cutting it, with spacing)
                so Threads / chat / side frames stay continuous instead of the
                side frame starting one row lower. */}
            {/* Tabs sit in the frame's own top line (cutting it, with spacing)
                so Threads / chat / side frames stay continuous instead of the
                side frame starting one row lower. */}
            <SideTabBar
              tab={sidePanel.tab}
              badges={sideBadges}
              onTab={showSideTab}
              onClose={closeSidePanel}
              focused={focus === "diff"}
              left={2}
              width={Math.max(10, diffPanel.diffWidth - 4)}
            />
            {sidePanel.tab === "diff" && diffPanel.expandedTurn !== null ? (
              <box style={{ flexDirection: "row", flexGrow: 1 }}>
                <DiffPanel
                  files={diffPanel.patchFiles}
                  loading={diffPanel.patch === null}
                  fileIndex={diffPanel.diffFileIndex}
                  collapsed={diffPanel.collapsedFiles}
                  width={diffPanel.diffWidth}
                  height={height}
                  turnCount={diffPanel.expandedTurn}
                  turnTotal={diffTurns.length}
                  focused={focus === "diff"}
                  scrollRef={diffScrollRef}
                  onToggleFile={diffPanel.toggleDiffFile}
                  onFocus={() => setFocus("diff")}
                  onHeaderClick={openDiffTurnPicker}
                />
              </box>
            ) : (
              <SidePanelFrame
                width={diffPanel.diffWidth}
                height={height}
                focused={focus === "diff"}
                scrollRef={sidePanel.scrollRef}
                onFocus={() => setFocus("diff")}
                footer={
                  sidePanel.tab === "git" ? (
                    <GitFooter overview={gitPanel.overview} forge={gitPanel.forge} width={diffPanel.diffWidth} />
                  ) : sidePanel.tab === "agents" ? (
                    <text fg={COLOR.dim} selectable={false}>{`${agentRows.length} delegated · ${subagentRows.length} subagents`}</text>
                  ) : sidePanel.tab === "context" && effectiveBreakdown !== null ? (
                    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
                      <ActionText label="Compact now" onClick={() => compactSession(() => undefined)} />
                      <text fg={COLOR.faint} bg={SURFACE.panel} selectable={false}>{"  frees the window"}</text>
                    </box>
                  ) : sidePanel.tab === "background" ? (
                    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
                      <text fg={COLOR.dim} bg={SURFACE.panel} selectable={false}>{`${background.length} running  `}</text>
                      <ActionText label="View all" onClick={() => setPicker("background-tasks")} />
                    </box>
                  ) : sidePanel.tab === "diff" && diffTurns.length > 0 ? (
                    <text fg={COLOR.dim} selectable={false}>{`${diffTurns.length} turn${diffTurns.length === 1 ? "" : "s"} with changes`}</text>
                  ) : null
                }
              >
                {sidePanel.tab === "diff" ? (
                  <DiffEmptyTab turns={diffTurns.length} onPick={openDiffTurnPicker} />
                ) : sidePanel.tab === "git" ? (
                  <GitTab
                    overview={gitPanel.overview}
                    forge={gitPanel.forge}
                    requests={gitPanel.requests}
                    status={gitPanel.status}
                    commitChecks={gitPanel.commitChecks}
                    commit={gitPanel.commit}
                    opener={requestOpener}
                    onAgentOpen={agentOpenRequest}
                    onOpenCommit={gitPanel.openCommit}
                    onCloseCommit={gitPanel.closeCommit}
                    onOpenUrl={openFetchedUrl}
                    loadingGit={gitPanel.loadingGit}
                    loadingForge={gitPanel.loadingForge}
                    error={gitPanel.error}
                    busy={gitPanel.busy}
                    selectedBranch={gitPanel.branch}
                    now={now}
                    onSelectBranch={gitPanel.selectBranch}
                    onRefresh={gitPanel.refresh}
                    onCreate={(draft) => setForgePrompt({ kind: "create", draft })}
                    onComment={(request) => setForgePrompt({ kind: "comment", number: request.number })}
                    onMerge={(request, strategy) => {
                      void gitPanel
                        .merge(request.number, strategy, false)
                        .then(() => toasts.push("forge-merge", "info", `Merged #${request.number}.`))
                        .catch(() => undefined);
                    }}
                  />
                ) : sidePanel.tab === "agents" ? (
                  <AgentsTab
                    threads={agentRows}
                    subagents={subagentRows}
                    onOpenSubagent={(agentId) => {
                      if (openThreadId === null) return;
                      setFocus("chat");
                      subagentView.open(openThreadId, agentId);
                    }}
                    now={now}
                    onOpen={openThreadFromPanel}
                  />
                ) : sidePanel.tab === "context" ? (
                  <ContextTab
                    breakdown={effectiveBreakdown}
                    fallback={threadState.contextUsage}
                    live={contextLive}
                    usageLimits={threadUsageLimits}
                    providerName={currentProvider?.displayName ?? null}
                    width={diffPanel.diffWidth}
                    now={now}
                  />
                ) : (
                  <BackgroundTab
                    tasks={background}
                    width={diffPanel.diffWidth}
                    now={now}
                    onOpen={() => setPicker("background-tasks")}
                    onStop={(taskId) => {
                      const task = background.find((row) => row.taskId === taskId);
                      if (task !== undefined) stopBackgroundTask(task);
                    }}
                  />
                )}
              </SidePanelFrame>
            )}
          </box>
        )}
      </box>
      ) : (
        <LoadingScreen stage={bootLoadingStage(shell)} />
      )}
      {toasts.toasts.map((toast, index) => (
        <box
          key={toast.id}
          style={{
            position: "absolute",
            top: 1 + index * TOAST_STEP,
            left: toastGeometry.left,
            width: toastGeometry.width,
            flexDirection: "column",
            flexShrink: 0,
            paddingLeft: 2,
            paddingRight: 2,
            // Single-row while over the side panel: the tab strip already
            // owns row 0, so a padded toast would cover the first content
            // rows (the frame tabs start at row 1 with no spacer). In the
            // chat pane the breathing room stays.
            paddingTop: sidePanelOpen ? 0 : 1,
            paddingBottom: sidePanelOpen ? 0 : 1,
            // Above every modal layer, so errors fired from inside a modal
            // (copy/dispatch failures) stay visible instead of hiding behind it.
            zIndex: 35,
          }}
          border={["left"]}
          borderStyle="heavy"
          borderColor={
            toast.tone === "danger" ? pulseColor(now, TOAST_COLOR.danger, COLOR.bright, 1600) : TOAST_COLOR[toast.tone]
          }
          backgroundColor={SURFACE.raised}
        >
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
            <text fg={TOAST_COLOR[toast.tone]} bg={SURFACE.raised} selectable={false}>
              {truncate(toast.text, Math.max(10, toastGeometry.width - 8 - (toast.action === null ? 0 : toast.action.label.length + 3)))}
            </text>
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.raised}>
              {toast.action === null ? null : (
                <text fg={COLOR.accent} bg={SURFACE.raised} selectable={false} onMouseDown={toast.action.onClick}>
                  {` ${toast.action.label} `}
                </text>
              )}
              <text
                fg={COLOR.faint}
                bg={SURFACE.raised}
                selectable={false}
                onMouseDown={() => {
                  // Manual dismiss removes the overlay on mouse-down while the
                  // matching mouse-up lands on whatever timeline row sits
                  // underneath the × — same swallow window as a modal dismiss
                  // so it doesn't instantly act on it (message actions).
                  markModalDismissed();
                  toasts.dismiss(toast.id);
                }}
              >
                {" ×"}
              </text>
            </box>
          </box>
        </box>
      ))}
      {/* Outside the picker chain below: the Git tab asks for these
          without opening a picker, so nested under it they never showed. */}
      {forgePrompt !== null ? (
        <RenameModal
          initialTitle=""
          title={
            forgePrompt.kind === "create"
              ? `Open a ${forgePrompt.draft ? "draft " : ""}${requestNoun(gitPanel.forge?.kind ?? null).long}`
              : `Comment on #${forgePrompt.number}`
          }
          placeholder={forgePrompt.kind === "create" ? "Title" : "Comment"}
          hint={
            forgePrompt.kind === "create"
              ? "enter opens it on the forge · esc cancels"
              : "enter posts the comment · esc cancels"
          }
          maxLength={forgePrompt.kind === "create" ? 120 : 2000}
          screenWidth={width}
          screenHeight={height}
          left={renameGeometry.left}
          top={renameGeometry.top}
          width={renameGeometry.width}
          height={renameGeometry.height}
          onSubmit={(value) => {
            const text = value.trim();
            const prompt = forgePrompt;
            setForgePrompt(null);
            if (text.length === 0 || prompt === null) return;
            if (prompt.kind === "create") {
              void gitPanel
                .createRequest({ title: text, draft: prompt.draft })
                .then((url) => toasts.push("forge-create", "info", url ?? "Request opened."))
                .catch(() => undefined);
              return;
            }
            void gitPanel
              .commentOn(prompt.number, text)
              .then(() => toasts.push("forge-comment", "info", `Commented on #${prompt.number}.`))
              .catch(() => undefined);
          }}
          onClose={() => setForgePrompt(null)}
        />
      ) : null}
      {sideQuestion.open && sideQuestion.current !== null ? (
        <SideQuestionModal
          entry={sideQuestion.current}
          onCopy={(text) => {
            void clipboard.copyText(text).then((ok) => toasts.push("btw-copy", "info", ok ? "Answer copied" : "Could not copy", COPY_TOAST_MS));
          }}
          screenWidth={width}
          screenHeight={height}
          left={backgroundGeometry.left}
          top={backgroundGeometry.top}
          width={backgroundGeometry.width}
          height={backgroundGeometry.height}
          onClose={sideQuestion.close}
        />
      ) : null}
      {picker === null ? null : picker === "rename" ? (
        <RenameModal
          initialTitle={selected === null ? "" : String(selected.title ?? "")}
          screenWidth={width}
          screenHeight={height}
          left={renameGeometry.left}
          top={renameGeometry.top}
          width={renameGeometry.width}
          height={renameGeometry.height}
          onSubmit={submitRename}
          onClose={() => closePicker(paletteReturnFocus)}
        />
      ) : picker === "answer-custom" ? (
        <RenameModal
          initialTitle=""
          title="Custom answer"
          placeholder="Type an answer…"
          hint="enter submits · esc back to options"
          maxLength={500}
          screenWidth={width}
          screenHeight={height}
          left={renameGeometry.left}
          top={renameGeometry.top}
          width={renameGeometry.width}
          height={renameGeometry.height}
          onSubmit={submitCustomAnswer}
          onClose={() => setPicker(null)}
        />
      ) : picker === "project-new" ? (
        <RenameModal
          initialTitle={process.cwd()}
          title="New project from local folder"
          placeholder="Folder path"
          hint="enter creates · esc back to projects"
          maxLength={500}
          screenWidth={width}
          screenHeight={height}
          left={pickerGeometry.left}
          top={pickerGeometry.top}
          width={pickerGeometry.width}
          height={pickerGeometry.height}
          onSubmit={submitProjectFolder}
          onClose={() => {
            setPickerFilter("");
            setPicker("project");
          }}
        />
      ) : picker === "schedule" ? (
        <RenameModal
          initialTitle={formatScheduleInput(new Date())}
          title="Schedule message"
          placeholder="2026-09-27 14:30"
          hint="enter schedules · a date and time, 14:30, tomorrow 9:00, in 30m · esc cancels"
          maxLength={40}
          screenWidth={width}
          screenHeight={height}
          left={renameGeometry.left}
          top={renameGeometry.top}
          width={renameGeometry.width}
          height={renameGeometry.height}
          onSubmit={(text) => {
            const parsed = parseScheduleInput(text, new Date());
            if (parsed.at === null) {
              toasts.push("schedule", "warn", parsed.error, COPY_TOAST_MS);
              return;
            }
            closePicker("composer");
            send(draft, "queue", parsed.at);
          }}
          onClose={() => closePicker("composer")}
        />
      ) : picker === "settings" ? (
        <SettingsModal
          snapshot={settings.snapshot}
          loading={settings.loading}
          saving={settings.saving}
          error={settings.error}
          onSet={settings.set}
          providers={providers}
          screenWidth={width}
          screenHeight={height}
          left={backgroundGeometry.left}
          top={backgroundGeometry.top}
          width={backgroundGeometry.width}
          height={backgroundGeometry.height}
          onClose={() => setPicker(null)}
        />
      ) : picker === "background-tasks" && selected !== null ? (
        <BackgroundTasksModal
          tasks={background}
          client={client}
          threadId={selected.id}
          screenWidth={width}
          screenHeight={height}
          left={backgroundGeometry.left}
          top={backgroundGeometry.top}
          width={backgroundGeometry.width}
          height={backgroundGeometry.height}
          onClose={() => setPicker(null)}
          onStop={stopBackgroundTask}
        />
      ) : (
        <PickerModal
          key={picker}
          title={
            picker === "model"
              ? creating
                ? "Select model"
                : `Select model — ${
                    providers?.find((candidate) => candidate.instanceId === effectiveModelSelection?.instanceId)
                      ?.displayName ?? "current provider"
                  }`
              : picker === "effort"
                ? "Select effort"
                : picker === "permission"
                  ? "Select permission"
                  : picker === "diff-turn"
                  ? "Select diff turn"
                  : picker === "command"
                    ? "Command palette"
                    : picker === "project"
                      ? "Select project"
                      : "Message actions"
          }
          body={pickerBody}
          filter={pickerFilter}
          onFilterChange={setPickerFilter}
          filterable={picker === "model" || picker === "command" || picker === "message" || picker === "project"}
          emptyLabel={
            picker === "model"
              ? pickerFilter.trim().length > 0
                ? "No matching models."
                : "No models reported by the server."
              : picker === "effort"
                ? "No effort options for this model."
                : picker === "permission"
                  ? "No permission levels for this provider."
                  : picker === "diff-turn"
                  ? "No turns with changes."
                  : picker === "command"
                    ? "No matching commands."
                    : picker === "project"
                      ? "No projects reported by the server."
                      : "No actions."
          }
          screenWidth={width}
          screenHeight={height}
          left={picker === "message" ? messageGeometry.left : pickerGeometry.left}
          top={picker === "message" ? messageGeometry.top : pickerGeometry.top}
          width={picker === "message" ? messageGeometry.width : pickerGeometry.width}
          height={picker === "message" ? messageGeometry.height : pickerGeometry.height}
            onClose={() =>
              closePicker(
                picker === "diff-turn" ? "diff" : picker === "message" ? "chat" : picker === "command" ? paletteReturnFocus : "composer",
              )
            }
          />
        )}
      {quitConfirmOpen ? (
        <ModalShell
          screenWidth={width}
          screenHeight={height}
          left={quitGeometry.left}
          top={quitGeometry.top}
          width={quitGeometry.width}
          height={quitGeometry.height}
          onClose={closeQuitConfirm}
        >
          <box style={{ flexDirection: "column", flexGrow: 1 }}>
            <text fg={COLOR.bright} selectable={false}>{"Quit moxen?"}</text>
            <box style={{ height: 1, flexShrink: 0 }} />
            <text fg={COLOR.dim} selectable={false}>
              {selected === null
                ? "No thread open."
                : `Open thread: ${truncate(String(selected.title ?? selected.id), Math.max(10, quitGeometry.width - 4))}`}
            </text>
            <text fg={COLOR.dim} selectable={false}>{"Ctrl+C cleared the prompt — quitting never sends it."}</text>
            <box style={{ flexGrow: 1 }} />
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "flex-end" }}>
              <text
                fg={COLOR.dim}
                bg={quitCancelHover.hovered ? SURFACE.hover : SURFACE.raised}
                selectable={false}
                onMouseDown={closeQuitConfirm}
                {...quitCancelHover.handlers}
              >
                {" Cancel (esc) "}
              </text>
              <text fg={COLOR.dim} bg={SURFACE.raised} selectable={false}>{"  "}</text>
              <text
                fg={COLOR.danger}
                bg={quitConfirmHover.hovered ? SURFACE.hover : SURFACE.raised}
                selectable={false}
                onMouseDown={onQuit}
                {...quitConfirmHover.handlers}
              >
                {" Quit (enter / ctrl+c again) "}
              </text>
            </box>
          </box>
        </ModalShell>
      ) : null}
      {editingExternally ? (
        // The external editor owns the terminal now: keep rendering the app
        // underneath, but swallow every mouse event behind this invisible
        // catcher so nothing clickable fires until the editor closes. Keys
        // are already gated via `editingExternally`. The state itself is
        // shown by the composer's own centered overlay — this shield carries
        // no message of its own.
        <box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            flexDirection: "column",
            zIndex: 40,
          }}
          selectable={false}
          onMouseDown={() => {}}
        />
      ) : null}
    </box>
  );
}
