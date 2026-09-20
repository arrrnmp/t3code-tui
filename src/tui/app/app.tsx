import { useEffect, useMemo, useRef, useState } from "react";
import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";

import { applyShellFrame, emptyShellState, threadStatus, visibleThreads, type ShellState } from "../model/shell.js";
import { Timeline } from "../features/timeline/timeline.js";
import { DiffPanel } from "../features/diffpanel/diffpanel.js";
import { Composer } from "../features/composer/composer.js";
import { TasksPanel } from "../features/taskspanel/taskspanel.js";
import { AttachmentStrip } from "../ui/attachmentstrip.js";
import { PickerModal, type PickerBody } from "../features/pickers/pickermodal.js";
import { ModalShell } from "../ui/modalshell.js";
import { RenameModal } from "../ui/renamemodal.js";
import { AnswerPanel } from "../features/answerpanel/answerpanel.js";
import { dispatchErrorMessage } from "../../errors.js";
import type { ModelSelection, RuntimeMode } from "../../types.js";
import { compatibleRuntimeMode } from "../../cli/catalog/permissions.js";
import { offerableModels, offerableProviders } from "../../cli/catalog/catalog.js";
import {
  attachmentFromBytes,
  buildImageAttachments,
  clipboardFileName,
  extractMentions,
  MAX_PENDING_ATTACHMENTS,
} from "../model/attachments.js";
import type { ImageAttachmentUpload } from "../../cli/threads/threadApi.js";
import { formatContextUsage, formatTokenCount, groupTurns } from "../model/turns.js";
import { markModalDismissed } from "../model/modalDismiss.js";
import { Sidebar } from "../features/sidebar/sidebar.js";
import { MonitoringBackdrop } from "../ui/backdrop.js";
import { LoadingScreen } from "../ui/loadingscreen.js";
import { bootLoadingStage, isBootReady } from "../model/readiness.js";
import { HoverButton } from "../ui/hoverbutton.js";
import { openExternal } from "../../cli/infra/platformOpen.js";
import { formatDuration } from "../model/turns.js";
import { ContextUsageCard } from "../ui/contextusagecard.js";
import { COLOR, MARKER, pulseColor, SPINNER, SURFACE, truncate } from "../theme.js";
import { useToasts, type ToastTone } from "../hooks/useToasts.js";
import { useClipboard } from "../hooks/useClipboard.js";
import { readPastedImage, type TerminalClipboardDeps } from "../model/terminalClipboard.js";
import { useHover } from "../hooks/useHover.js";
import {
  applyThreadFrame,
  detectUsageLimit,
  emptyThreadState,
  timeline,
  resumeCompactionKey,
  shouldOfferResumeCompaction,
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
import { useAnswerFlow } from "../features/answerpanel/useAnswerFlow.js";
import { useSidebar } from "../features/sidebar/useSidebar.js";
import { useDiffPanel } from "../features/diffpanel/useDiffPanel.js";
import { useComposer } from "../features/composer/useComposer.js";
import { useProviderCatalog } from "../features/pickers/useProviderCatalog.js";
import { useThreadCreation } from "./hooks/useThreadCreation.js";
import { useThreadOps } from "./hooks/useThreadOps.js";
import type { PickerName } from "../features/pickers/pickerTypes.js";

export interface TuiClient {
  subscribeShell(
    options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
  subscribeThread(
    threadId: string,
    options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
  dispatch(command: unknown): Promise<unknown>;
  turnDiff(threadId: string, toTurnCount: number): Promise<string | null>;
  getConfig(): Promise<unknown>;
}

export function App({
  client,
  onQuit,
  t3Home,
  cwd,
  launchView,
  setTerminalTitle,
  stateDir = null,
}: {
  client: TuiClient;
  onQuit: () => void;
  t3Home?: string;
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
   * Local T3 projection database dir (null when undiscoverable, e.g. the
   * snapshot harness). Feeds the completed-tool-input backfill below; the
   * UI never depends on it.
   */
  stateDir?: string | null;
}) {
  const { width, height } = useTerminalDimensions();
  const [shell, setShell] = useState<ShellState>(emptyShellState);
  const [threadState, setThreadState] = useState<ThreadState>(emptyThreadState);
  const { plan, tasksVisibleNow, toggleTasksVisible } = useTasksPanel(threadState);
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
  const [revertArmed, setRevertArmed] = useState(false);
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
  const [contextCardOpen, setContextCardOpen] = useState(false);
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
  /**
   * Boot gate: the app chrome stays hidden behind `<LoadingScreen>` until the
   * shell snapshot (thread list) and the picked thread's own snapshot have
   * both landed. Declared up here so the keyboard handler below can swallow
   * app bindings while booting — only the ctrl+c quit flow stays live.
   */
  const bootReady = isBootReady(shell, openThreadId, threadState);
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
  const groups = useMemo(() => groupTurns(entries), [entries]);
  const diffPanel = useDiffPanel({
    client,
    width,
    openThreadId,
    selected,
    shellProjects: shell.projects,
    threadState,
    threadStateRef,
    stateDir,
    groups,
    selectedIdRef,
    chatScrollRef,
    setThreadState,
    setFocus,
    setError,
  });
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
    activeThreadIds: sections.active.map((row) => row.thread.id),
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

  const dispatchTurn = (prompt: string, attachments: ImageAttachmentUpload[]) => {
    if (selected === null) return;
    void client
      .dispatch({
        type: "thread.turn.start",
        commandId: crypto.randomUUID(),
        threadId: selected.id,
        message: { messageId: crypto.randomUUID(), role: "user", text: prompt, attachments },
        runtimeMode: selected.runtimeMode ?? "full-access",
        interactionMode: selected.interactionMode ?? "default",
        createdAt: new Date().toISOString(),
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };

  /**
   * `@path/to/image.png` mentions become inline image attachments, combined
   * with anything pasted off the clipboard. The draft stays put when a file
   * cannot be read so the prompt is never eaten by a failed attach.
   */
  const send = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || selected === null) return;
    // A settled thread wakes on send: unsettle first so the turn lands on a
    // live thread instead of dispatching into a finished one. The toast says
    // what happened; a rejection surfaces as an error and the draft is kept.
    if (threadStatus(selected, Date.now()) === "settled") {
      const id = selected.id;
      void client
        .dispatch({ type: "thread.unsettle", commandId: crypto.randomUUID(), threadId: id, reason: "user" as const })
        .then(() => {
          toasts.push("thread-unsettled", "info", "Thread unsettled", COPY_TOAST_MS);
          send(text);
        })
        .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
      return;
    }
    const sourceId = selected.id;
    const parsed = extractMentions(trimmed);
    if (parsed.paths.length === 0 && pending.length === 0) {
      resetDraft(sourceId);
      dispatchTurn(trimmed, []);
      return;
    }
    void buildImageAttachments(parsed.paths, cwd ?? process.cwd()).then((built) => {
      if (built.error !== null) {
        setError(built.error.slice(0, 120));
        return;
      }
      resetDraft(sourceId);
      writePending(sourceId, []);
      dispatchTurn(parsed.text, [...pending, ...built.attachments]);
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
  const pasteImage = () => {
    setFocus("composer");
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
      setPending((current) => [...current, built.attachment].slice(-MAX_PENDING_ATTACHMENTS));
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
      // Escape always closes the diff, even mid-turn: it must never stop the
      // thread as a side effect. Stopping a turn is UI-only now (the
      // composer's stop button), never a key.
      if (key.name === "escape") {
        diffPanel.closeDiff();
        setFocus("chat");
        return;
      }
      scrollPane(diffScrollRef.current, key.name);
      return;
    }
    // Escape in the chat pane is a no-op: it must never kill a running turn.
    if (key.name === "escape") {
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

  const usageLimit = useMemo(() => detectUsageLimit(threadState), [threadState]);
  useEffect(() => {
    if (usageLimit === null) {
      toasts.dismiss("usage");
      return;
    }
    toasts.push(
      "usage",
      "danger",
      `blocked - ${usageLimit.rateLimitType ?? "quota"} resets ${
        usageLimit.resetsAt === null ? "unknown" : clock(usageLimit.resetsAt.toISOString())
      }`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageLimit]);
  const session = threadState.session;
  const sessionRunning = session?.status === "running" || session?.status === "starting";
  sessionRunningRef.current = sessionRunning;

  // Mirrors the chat pane's own live indicator into the terminal's window
  // title, so the thread and its progress stay visible even when the
  // terminal isn't focused. Ticks on the same `now` as the chat pane — no
  // extra timer.
  useEffect(() => {
    if (setTerminalTitle === undefined) return;
    const threadTitleText = selected?.title !== undefined && selected.title.length > 0 ? String(selected.title) : "T3 Code";
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
   * Stop the open thread's in-flight turn, mirroring `t3code threads
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
        commandId: crypto.randomUUID(),
        threadId: openThreadId,
        createdAt: new Date().toISOString(),
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
    return true;
  };

  /** Opens the command palette, remembering where esc should return focus. */
  const openCommandPalette = () => {
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
    currentSkills,
    modelColor,
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

  const chatWidth = Math.max(
    20,
    width - SIDEBAR_WIDTH - (diffPanel.expandedTurn === null ? 0 : diffPanel.diffWidth) - 2 - CHAT_GUTTER * 2,
  );
  /** Toasts stay entirely inside one pane's own bounds, with a 1-col margin:
      the diff panel's while it is open, the chat/timeline pane's otherwise —
      never floating over the sidebar or straddling panes. */
  const toastGeometry = useMemo(() => {
    const chatLeft = SIDEBAR_WIDTH + CHAT_GUTTER;
    const diffLeft = diffPanel.expandedTurn === null ? null : chatLeft + chatWidth + CHAT_GUTTER;
    const paneLeft = diffLeft ?? chatLeft;
    const paneWidth = diffLeft === null ? chatWidth : diffPanel.diffWidth;
    const paneRight = paneLeft + paneWidth;
    const toastWidth = Math.min(60, Math.max(24, paneWidth - TOAST_INSET * 2));
    return {
      left: Math.max(paneLeft + TOAST_INSET, paneRight - TOAST_INSET - toastWidth),
      width: toastWidth,
    };
  }, [chatWidth, diffPanel.diffWidth, diffPanel.expandedTurn]);
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
  const renderAttachmentStrip = (spacedTop: boolean) => (
    <AttachmentStrip
      attachments={pending}
      onRemove={(index) => setPending((current) => current.filter((_, position) => position !== index))}
      spacedTop={spacedTop}
    />
  );

  /**
   * Modal bodies: the model list across providers plus a provider shortcut
   * section, one section per effort descriptor of the current model, every
   * turn that produced file changes for the diff-turn picker, or the
   * command palette's copy/thread/jump sections.
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
                  copyPaletteText(entry.text, "nothing to copy");
                },
              },
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
                    label: revertArmed ? "Confirm revert" : "Revert to before this turn",
                    ...(revertArmed ? { meta: "enter again to confirm · keeps files" } : {}),
                    onPick: () => revertMessageTurn(entry, revertTarget),
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
                key: "thread:compact",
                label: "Compact session",
                ...(entries.length === 0
                  ? { meta: "no turns yet", disabled: true, onPick: () => {} }
                  : { onPick: compactSession }),
              },
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
  }, [picker, providers, providersError, effectiveModelSelection, effectiveRuntimeMode, permissionChoices, creating, deleteArmed, deleteSupported, revertArmed, answerDraft]);

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
  const composerFocused = focus === "composer" && picker === null && !quitConfirmOpen;
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
          onOpenThread={(threadId) => {
            setFocus("chat");
            setCreating(false);
            setPicker(null);
            setPickerFilter("");
            setOpenThreadId(threadId);
          }}
          onToggleSettled={toggleSettledExpanded}
          onShowMore={showMoreSettled}
          onSelectMode={setSidebarMode}
          onToggleProject={toggleSidebarProject}
          onCycleProject={cycleSidebarProject}
          onNewThread={startNewThread}
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
            <MonitoringBackdrop
              width={Math.max(0, width - SIDEBAR_WIDTH)}
              height={height}
              offsetX={SIDEBAR_WIDTH}
              fieldWidth={width}
              fieldHeight={height}
            />
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
              {renderAttachmentStrip(true)}
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
                flushTop={pending.length > 0}
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
                skills={currentSkills}
              />
              )}
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "center", marginTop: 1 }}>
                <text fg={COLOR.faint} selectable={false}>{"enter creates · click project to change · esc cancels"}</text>
              </box>
            </box>
          </box>
        ) : (
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: CHAT_GUTTER, paddingRight: CHAT_GUTTER }}>
          {/* Post-boot thread switches (and resyncs) reset `threadState`
              before the new snapshot lands — hold a loading row instead of
              flashing an empty transcript that reads as "no messages". */}
          {threadState.synchronized ? (
          <Timeline
            groups={groups}
            title={selected === null ? "no thread" : String(selected.title ?? selected.id)}
            subtitle={`${session?.status ?? "idle"}`}
            model={model}
            modelColor={modelColor}
            t3Home={t3Home}
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
          {/* One blank row between each visible bottom block: every block
              below carries marginTop 1 and nothing else adds gaps. */}
          {tasksVisibleNow && plan !== null ? <TasksPanel plan={plan} width={chatWidth} /> : null}
          {renderAttachmentStrip(tasksVisibleNow)}
          {resumeBanner === null ? null : (
            <box
              style={{
                flexDirection: "column",
                flexShrink: 0,
                marginTop: 1,
                paddingLeft: 2,
                paddingRight: 2,
                paddingTop: 1,
                paddingBottom: 1,
              }}
              border={["top"]}
              borderColor={SURFACE.border}
            >
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
                <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                  <text fg={COLOR.warn} selectable={false}>{"◈ "}</text>
                  <text fg={COLOR.bright} selectable={false}>{"Resume with less context"}</text>
                </box>
                <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                  <HoverButton
                    label=" Compact "
                    fg={COLOR.accent}
                    onClick={() => compactSession(() => setDismissedResumeKey(resumeBanner.key))}
                  />
                  <text selectable={false}>{"  "}</text>
                  <HoverButton
                    label=" Keep full history "
                    fg={COLOR.dim}
                    hoverFg={COLOR.text}
                    onClick={() => setDismissedResumeKey(resumeBanner.key)}
                  />
                </box>
              </box>
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <text fg={COLOR.dim} selectable={false}>
                  {`  ${formatTokenCount(resumeBanner.usedTokens)} tokens from earlier`}
                </text>
              </box>
            </box>
          )}
          {answerVisible ? (
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
            model={model}
            modelColor={modelColor}
            effort={effort}
            permission={permission}
            flushTop={pending.length > 0}
            submitVerb="sends"
            running={sessionRunning}
            width={chatWidth}
            onModelClick={openModelPicker}
            onEffortClick={openEffortPicker}
            onPermissionClick={openPermissionPicker}
            onStopClick={interruptTurn}
            onCopyClick={copyDraft}
            onExternalEditClick={editDraftExternally}
            editingExternally={editingExternally}
            skills={currentSkills}
            contextUsage={contextUsageDisplay}
            onContextUsageClick={() => setContextCardOpen((open) => !open)}
          />
          )}
        </box>
        )}
        {diffPanel.expandedTurn === null ? null : (
          <DiffPanel
            files={diffPanel.patchFiles}
            loading={diffPanel.patch === null}
            fileIndex={diffPanel.diffFileIndex}
            collapsed={diffPanel.collapsedFiles}
            width={diffPanel.diffWidth}
            turnCount={diffPanel.expandedTurn}
            turnTotal={threadState.checkpoints.filter((row) => row.files.length > 0).length}
            focused={focus === "diff"}
            scrollRef={diffScrollRef}
            onToggleFile={diffPanel.toggleDiffFile}
            onFocus={() => setFocus("diff")}
            onHeaderClick={openDiffTurnPicker}
          />
        )}
      </box>
      ) : (
        <LoadingScreen stage={bootLoadingStage(shell)} />
      )}
      {contextCardOpen && contextUsageDisplay !== null && threadState.contextUsage !== null ? (
        <ContextUsageCard
          usage={threadState.contextUsage}
          width={Math.min(40, Math.max(28, width - SIDEBAR_WIDTH - 6), chatWidth)}
          right={Math.max(1, width - (SIDEBAR_WIDTH + CHAT_GUTTER + chatWidth))}
          onCompact={() =>
            compactSession(() => {
              markModalDismissed();
              setContextCardOpen(false);
            })
          }
          onClose={() => {
            markModalDismissed();
            setContextCardOpen(false);
          }}
        />
      ) : null}
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
            paddingTop: 1,
            paddingBottom: 1,
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
            <text fg={COLOR.bright} selectable={false}>{"Quit t3code?"}</text>
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
