import { useEffect, useMemo, useRef, useState } from "react";
import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react";

import { applyShellFrame, emptyShellState, threadStatus, visibleThreads, type ShellState } from "./model/shell.js";
import { Timeline } from "./timeline.js";
import { DiffPanel } from "./diffpanel.js";
import { Composer } from "./composer.js";
import { TasksPanel } from "./taskspanel.js";
import { AttachmentStrip } from "./attachmentstrip.js";
import { PickerModal, type PickerBody } from "./pickermodal.js";
import { ModalShell } from "./modalshell.js";
import { RenameModal } from "./renamemodal.js";
import { AnswerPanel } from "./answerpanel.js";
import { dispatchErrorMessage } from "../errors.js";
import { extractProviders, type ProviderSummary } from "../catalog/catalog.js";
import type { ModelSelection, ProviderOptionSelection } from "../types.js";
import {
  attachmentFromBytes,
  buildImageAttachments,
  clipboardFileName,
  extractMentions,
  MAX_PENDING_ATTACHMENTS,
  readClipboardImage,
} from "./model/attachments.js";
import type { ImageAttachmentUpload } from "../threads/threadApi.js";
import { splitPatchByFile, type PatchFile } from "./model/patch.js";
import { displayEffort, displayModelName } from "./model/display.js";
import { buildSidebarSections, orderedProjectIds, type SidebarMode } from "./model/sidebar.js";
import { formatContextUsage, formatTokenCount, groupTurns, proportionalTarget } from "./model/turns.js";
import { markModalDismissed, wasModalJustDismissed } from "./model/modalDismiss.js";
import { describeActivity, missingCompletedInput, withCompletedInput, toolCallIdOf } from "./model/activity.js";
import type { ActivityView } from "./model/activity.js";
import { fetchWorkingTreeDiff } from "./model/gitdiff.js";
import { readCompletedToolInputs } from "../infra/toolInputs.js";
import { Sidebar } from "./sidebar.js";
import { openExternal } from "../infra/platformOpen.js";
import { formatDuration } from "./model/turns.js";
import { ContextUsageCard } from "./contextusagecard.js";
import { COLOR, MARKER, providerColor, SPINNER, SURFACE, truncate } from "./theme.js";
import { useToasts, type ToastTone } from "./hooks/useToasts.js";
import { useClipboard } from "./hooks/useClipboard.js";
import { useHover } from "./hooks/useHover.js";
import {
  cleanupTempDraftFile,
  createTempDraftFile,
  preferredEditorCommand,
  readTempDraftFile,
  runEditorAttached,
} from "./model/externalEditor.js";
import {
  applyThreadFrame,
  detectUsageLimit,
  emptyThreadState,
  latestPlan,
  pendingUserInputRequests,
  timeline,
  resumeCompactionKey,
  shouldOfferResumeCompaction,
  type PendingUserInputQuestion,
  type ThreadState,
  type TimelineEntry,
} from "./model/thread.js";

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

/** Arrow keys and page keys scroll whichever pane holds focus. */
function scrollPane(pane: ScrollBoxRenderable | null, keyName: string): void {
  if (pane === null) return;
  if (keyName === "down") pane.scrollBy(1);
  else if (keyName === "up") pane.scrollBy(-1);
  else if (keyName === "pagedown") pane.scrollBy(Math.max(1, pane.viewport.height - 2));
  else if (keyName === "pageup") pane.scrollBy(-Math.max(1, pane.viewport.height - 2));
  else if (keyName === "home") pane.scrollTo(0);
  else if (keyName === "end") pane.scrollTo(pane.scrollHeight);
}

const SIDEBAR_WIDTH = 44;
/** Breathing columns on each side of the chat stack (timeline, tasks,
    attachments, composer). */
const CHAT_GUTTER = 1;
const SETTLED_PAGE = 10;
/** How long a status-bar error stays up before it clears itself. */
const ERROR_DISPLAY_MS = 6_000;
/** How long the "copied to clipboard" confirmation stays up. */
const COPY_TOAST_MS = 2_500;
/** Consecutive Ctrl+C presses inside this window escalate: 1st clears the
    prompt, 2nd opens the close menu, 3rd (in the menu) quits. */
const CTRL_C_WINDOW_MS = 800;

const TOAST_COLOR: Record<ToastTone, string> = {
  info: COLOR.accent,
  warn: COLOR.warn,
  danger: COLOR.danger,
};
/** Margin kept between a toast and the chat pane's own border. */
const TOAST_INSET = 1;
/** Padding top + content row + padding bottom, plus a blank row between stacked toasts. */
const TOAST_STEP = 4;

/** First line of the prompt, matching the CLI handover title. */
function threadTitle(prompt: string): string {
  const title = prompt.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || "New thread";
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

function clock(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "--:--";
  const date = new Date(parsed);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
  const [focus, setFocus] = useState<"chat" | "composer" | "diff">("chat");
  const toasts = useToasts();
  /** Kept as the one call every existing error path already used; now routes
      through `toasts` instead of its own state + timeout effect. */
  const setError = (message: string) => toasts.push("error", "danger", `error: ${message}`, ERROR_DISPLAY_MS);
  /** Composition is per thread: switching threads stashes the draft and
      pending attachments under the old id and restores the new one's, so a
      half-written message is never lost or leaked into another thread. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Bumped on every explicit external draft clear (post-send, ctrl+c) so the
      composer can tell "I cleared you" apart from "you're still typing" —
      see `Composer`'s `resetKey` doc comment. */
  const [composerResetCounter, setComposerResetCounter] = useState(0);
  const [pendings, setPendings] = useState<Record<string, ImageAttachmentUpload[]>>({});
  /** Composer is drafting the first message of a new thread, not a reply. */
  const [creating, setCreating] = useState(launchView !== "thread");
  /** Overrides the model the new thread inherits from its source once the
      user picks a different one while creating — `null` means "still
      inheriting". Picking a model/effort during `creating` must land here,
      never dispatch `thread.model-selection.set` against the still-open
      source thread. */
  const [creatingModelSelection, setCreatingModelSelection] = useState<ModelSelection | null>(null);
  /**
   * Overrides the project the new thread lands in once the user picks a
   * different one while creating — `null` means "still inheriting" from the
   * source thread. Picked via the project picker (command palette or `[`/`]`
   * in the creating view); `createThread` reads it back on send.
   */
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [settledExpanded, setSettledExpanded] = useState(false);
  const [settledLimit, setSettledLimit] = useState(SETTLED_PAGE);
  /** Threads pane: flat recency list, project-grouped list, or one project. */
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("flat");
  /** Explicit project for `project` mode; null follows the open thread. */
  const [sidebarProjectId, setSidebarProjectId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  /** Full-size Ctrl+C confirm: Enter / Ctrl+C again quits, Esc cancels. */
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  const quitCancelHover = useHover();
  const quitConfirmHover = useHover();
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  /**
   * Checkpoint patches by checkpoint turn count, backfilling the inline
   * per-edit diffs whose tool input the wire stripped. Rendered through a
   * version bump (the map itself lives in a ref so the backfill effect never
   * re-fires off its own writes); cleared whenever the open thread changes.
   */
  const turnPatchCache = useRef(new Map<number, PatchFile[]>());
  const patchInflight = useRef(new Set<number>());
  /**
   * Working-tree hunks for the running turn's bare rows (whole-tree patch,
   * matched per row by path suffix). Checkpoint patches shadow it wherever
   * present — historical turns must never render current-tree hunks, since
   * the tree moved on. Refreshed only when the wanted set below changes.
   */
  const gitPatchCache = useRef<PatchFile[]>([]);
  const lastGitWanted = useRef<string | null>(null);
  /** Completed tool calls whose input was already merged back from the
      local projection database (or confirmed missing) — cleared with the
      rest of the per-thread caches below. */
  const mergedToolInput = useRef(new Set<string>());
  const [, bumpTurnPatches] = useState(0);
  const [diffFileIndex, setDiffFileIndex] = useState(0);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWork, setExpandedWork] = useState<ReadonlySet<string>>(() => new Set());
  /** Claude Code-style tasks panel above the composer; ctrl+t toggles. */
  const [tasksVisible, setTasksVisible] = useState(true);
  /** Centered picker modal: model/effort lists, the diff-turn list, the command palette, the rename or custom-answer prompt, message actions, or the new-thread project list. */
  const [picker, setPicker] = useState<
    "model" | "effort" | "diff-turn" | "command" | "rename" | "message" | "answer-custom" | "project" | null
  >(null);
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
  /**
   * Draft answers for the open agent question, keyed by question id:
   * picked option values plus free text (which wins when present, mirroring
   * the desktop resolver). `index` walks multi-question requests in order.
   */
  interface AnswerDraft {
    requestId: string;
    index: number;
    selected: Record<string, string[]>;
    custom: Record<string, string>;
  }
  const [answerDraft, setAnswerDraft] = useState<AnswerDraft | null>(null);
  /** Request ids already shown or settled — auto-open fires once each. */
  const seenAnswerRequestsRef = useRef<Set<string>>(new Set());
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
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
  /** Consecutive Ctrl+C press counting for the clear → menu → quit flow. */
  const lastCtrlCRef = useRef(0);
  const ctrlCCountRef = useRef(0);
  const clipboard = useClipboard();
  const renderer = useRenderer() as CliRenderer | null;
  /** While the draft sits in `$EDITOR`, the composer rejects input — keys
      are gated in `useKeyboard` and the textarea unfocuses via this flag. */
  const [editingExternally, setEditingExternally] = useState(false);
  const editingExternallyRef = useRef(false);
  editingExternallyRef.current = editingExternally;
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

  const openThreadProjectId = shell.threads.find((thread) => thread.id === openThreadId)?.projectId ?? null;
  const sections = useMemo(
    () =>
      buildSidebarSections(shell, {
        settledExpanded,
        settledLimit,
        now,
        mode: sidebarMode,
        projectId: sidebarProjectId,
        fallbackProjectId: openThreadProjectId,
        collapsedProjects,
      }),
    [shell, settledExpanded, settledLimit, now, sidebarMode, sidebarProjectId, openThreadProjectId, collapsedProjects],
  );
  const cycleSidebarMode = () => {
    setSidebarMode((mode) => (mode === "flat" ? "grouped" : mode === "grouped" ? "project" : "flat"));
  };

  const toggleSidebarProject = (projectId: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  /** Move the `project`-mode filter to the previous/next project by recency. */
  const cycleSidebarProject = (direction: 1 | -1) => {
    const ordered = orderedProjectIds(shell);
    if (ordered.length === 0) return;
    const current = sidebarProjectId ?? openThreadProjectId ?? sections.projectId ?? ordered[0]!;
    const index = ordered.indexOf(current);
    const next = ordered[(index === -1 ? 0 : index + direction + ordered.length) % ordered.length];
    if (next !== undefined) setSidebarProjectId(next);
  };

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
  /** The model selection every picker/footer reads: while drafting a new
      thread this is the local override (once picked) or the source thread's
      own model, never a dispatch target. */
  const effectiveModelSelection = creating ? (creatingModelSelection ?? selected?.modelSelection) : selected?.modelSelection;
  /**
   * The project the next thread lands in: while drafting, the local override
   * (once picked) or the source thread's own project — never dispatched
   * against anything until `createThread` sends `thread.create`.
   */
  const effectiveProjectId = creating ? (creatingProjectId ?? selected?.projectId ?? null) : (selected?.projectId ?? null);

  const draft = openThreadId === null ? "" : (drafts[openThreadId] ?? "");
  const pending = openThreadId === null ? [] : (pendings[openThreadId] ?? []);
  const copyDraft = () => {
    if (draft.trim().length === 0) return;
    void clipboard.copyText(draft).then((ok) => {
      if (ok) toasts.push("copy-draft", "info", "Copied to clipboard", COPY_TOAST_MS);
    });
  };
  /** One palette copy action: missing data toasts instead of dispatching. */
  const copyPaletteText = (text: string | null, emptyMessage: string) => {
    if (text === null || text.length === 0) {
      setError(emptyMessage);
      return;
    }
    void clipboard.copyText(text).then((ok) => {
      if (ok) toasts.push("palette-copy", "info", "Copied to clipboard", COPY_TOAST_MS);
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
   * Deletes the open thread behind a two-step confirm (first pick arms).
   * `thread.delete` has only ever been used as create-rollback, so a
   * rejection permanently disables the row for the session instead of
   * retrying. Refuses the last remaining thread — reopening from zero is
   * unwired, and stranding the UI there would be worse than refusing.
   */
  const deleteThread = () => {
    if (openThreadId === null || selected === null) {
      setError("no open thread to delete");
      return;
    }
    if (creating) {
      setError("finish or cancel the new thread before deleting");
      return;
    }
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const id = openThreadId;
    const remaining = shell.threads.filter(
      (thread) => thread.id !== id && thread.archivedAt === null && thread.deletedAt == null,
    );
    if (remaining.length === 0) {
      setDeleteArmed(false);
      setError("cannot delete the last thread");
      return;
    }
    const fallback = sections.active.map((row) => row.thread.id).find((threadId) => threadId !== id) ?? null;
    void client
      .dispatch({ type: "thread.delete", commandId: crypto.randomUUID(), threadId: id })
      .then(() => {
        toasts.push("thread-deleted", "info", "Thread deleted", COPY_TOAST_MS);
        closePicker("chat");
        setOpenThreadId(fallback);
      })
      .catch((cause: unknown) => {
        setDeleteSupported(false);
        setDeleteArmed(false);
        setError(String(cause).slice(0, 120));
      });
  };
  /**
   * Settles (or unsettles) the open thread. Settling drops back into the
   * new-thread view — the settled thread stays open underneath as the source
   * that lends its project/model/modes, so the next prompt starts fresh
   * instead of appending to a finished thread. Unsettling stays put.
   */
  const toggleSettleThread = () => {
    if (openThreadId === null || selected === null) {
      setError("no open thread to settle");
      return;
    }
    const id = openThreadId;
    const settled = threadStatus(selected, Date.now()) === "settled";
    const command = settled
      ? { type: "thread.unsettle", commandId: crypto.randomUUID(), threadId: id, reason: "user" as const }
      : { type: "thread.settle", commandId: crypto.randomUUID(), threadId: id };
    void client
      .dispatch(command)
      .then(() => {
        toasts.push("thread-settled", "info", settled ? "Thread unsettled" : "Thread settled — new thread", COPY_TOAST_MS);
        closePicker(paletteReturnFocus);
        if (!settled) {
          setCreatingModelSelection(null);
          setCreatingProjectId(null);
          setCreating(true);
          setFocus("composer");
        }
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  /**
   * Asks the server to regenerate the open thread's title
   * (`thread.meta.update` with `regenerateTitle`; the title arrives back
   * over the shell subscription). Fire-and-forget like the other
   * dispatches; renames the source thread when drafting, which is harmless.
   */
  const regenerateThreadTitle = () => {
    if (openThreadId === null || selected === null) {
      setError("no open thread to retitle");
      return;
    }
    const id = openThreadId;
    void client
      .dispatch({ type: "thread.meta.update", commandId: crypto.randomUUID(), threadId: id, regenerateTitle: true })
      .then(() => {
        toasts.push("thread-regenerate-title", "info", "Regenerating title", COPY_TOAST_MS);
        closePicker(paletteReturnFocus);
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  /**
   * Archives the open thread (`thread.archive`), moving selection to the
   * next thread like delete does. Refuses the last visible thread — there
   * is no unarchive path in this UI, so stranding the view there would be
   * unrecoverable without the desktop app. Also refuses while drafting,
   * for the same reason as delete.
   */
  const archiveThread = () => {
    if (openThreadId === null || selected === null) {
      setError("no open thread to archive");
      return;
    }
    if (creating) {
      setError("finish or cancel the new thread before archiving");
      return;
    }
    const id = openThreadId;
    const remaining = shell.threads.filter(
      (thread) => thread.id !== id && thread.archivedAt === null && thread.deletedAt == null,
    );
    if (remaining.length === 0) {
      setError("cannot archive the last thread");
      return;
    }
    const fallback = sections.active.map((row) => row.thread.id).find((threadId) => threadId !== id) ?? null;
    void client
      .dispatch({ type: "thread.archive", commandId: crypto.randomUUID(), threadId: id })
      .then(() => {
        toasts.push("thread-archived", "info", "Thread archived", COPY_TOAST_MS);
        closePicker("chat");
        setOpenThreadId(fallback);
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  /**
   * Compacts the open thread by sending the `/compact` maintenance turn the
   * server interprets (no dedicated command exists). Goes through the same
   * turn dispatch as a normal prompt; the server rejects it with a toastable
   * error when the provider can't compact. `onDispatched` lets callers other
   * than the command palette (the context-usage card, the resume-with-less-
   * context toast) choose their own post-dispatch cleanup instead of closing
   * a picker that was never open.
   */
  const compactSession = (onDispatched: () => void = () => closePicker("chat")) => {
    if (openThreadId === null || selected === null) {
      setError("no open thread to compact");
      return;
    }
    const thread = selected;
    void client
      .dispatch({
        type: "thread.turn.start",
        commandId: crypto.randomUUID(),
        threadId: thread.id,
        message: { messageId: crypto.randomUUID(), role: "user", text: "/compact", attachments: [] },
        runtimeMode: thread.runtimeMode ?? "full-access",
        interactionMode: thread.interactionMode ?? "default",
        createdAt: new Date().toISOString(),
      })
      .then(onDispatched)
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  /**
   * Message click shared by prompts and the closing reply: Copy plus Revert
   * for both (revert resolves through the entry's turn either way). A
   * text-selection drag ending on the card must not act, so a non-empty live
   * selection means "that was a drag" (the selection-copy flow already
   * toasted for it). Likewise the mouse-up half of a backdrop-dismiss
   * gesture is swallowed so dismissing onto a turn doesn't reopen.
   */
  const openMessageActions = (entry: TimelineEntry) => {
    let selectedText = "";
    try {
      selectedText = renderer?.getSelection()?.getSelectedText() ?? "";
    } catch {
      selectedText = "";
    }
    if (selectedText.trim().length > 0) return;
    if (wasModalJustDismissed()) return;
    setMessageActionEntry(entry);
    setRevertArmed(false);
    setPickerFilter("");
    setPicker("message");
  };
  /**
   * Rewinds the transcript to before the modal's turn via
   * `thread.conversation.revert` (history only — files untouched; the
   * file-restoring variant is never dispatched from here). Two-step confirm
   * like delete, refused while a turn is running, and followed by a
   * subscription resync since our projector can't consume removal events.
   * Also drops the diff panel: it may show a turn that no longer exists.
   */
  const revertMessageTurn = (entry: TimelineEntry, targetTurnCount: number) => {
    if (!revertArmed) {
      setRevertArmed(true);
      return;
    }
    if (openThreadId === null) {
      setError("no open thread to revert");
      return;
    }
    if (sessionRunningRef.current) {
      setRevertArmed(false);
      setError("wait for the turn to finish before reverting");
      return;
    }
    const id = openThreadId;
    void client
      .dispatch({
        type: "thread.conversation.revert",
        commandId: crypto.randomUUID(),
        threadId: id,
        turnCount: targetTurnCount,
        createdAt: new Date().toISOString(),
      })
      .then(() => {
        toasts.push("message-reverted", "info", "Turn reverted", COPY_TOAST_MS);
        closePicker("chat");
        setExpandedTurn(null);
        setPatch(null);
        setThreadState(emptyThreadState());
        setThreadResync((count) => count + 1);
      })
      .catch((cause: unknown) => {
        setRevertArmed(false);
        setError(String(cause).slice(0, 120));
      });
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
  /**
   * Commits the rename modal: empty or unchanged titles just close, anything
   * else dispatches `thread.meta.update` fire-and-forget — the new title
   * arrives back over the shell subscription.
   */
  const submitRename = (title: string) => {
    const trimmed = title.trim().replace(/\s+/gu, " ");
    const id = openThreadId;
    const current = selected === null ? null : String(selected.title ?? "");
    closePicker(paletteReturnFocus);
    if (id === null || trimmed.length === 0 || trimmed === current) return;
    void client
      .dispatch({ type: "thread.meta.update", commandId: crypto.randomUUID(), threadId: id, title: trimmed })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  /** Agent questions awaiting answers, oldest first. */
  const pendingAnswerRequests = useMemo(() => pendingUserInputRequests(threadState), [threadState]);
  /** Request ids submitted or dismissed locally: hidden optimistically
      until the server's resolved event confirms (errors unhide). */
  const [settledAnswerRequestIds, setSettledAnswerRequestIds] = useState<string[]>([]);
  /** The request currently answered inline (null once settled or resolved elsewhere). */
  const activeAnswerRequest =
    answerDraft === null
      ? null
      : (pendingAnswerRequests.find(
          (candidate) =>
            candidate.requestId === answerDraft.requestId && !settledAnswerRequestIds.includes(candidate.requestId),
        ) ?? null);
  const activeAnswerQuestion = activeAnswerRequest?.questions[answerDraft?.index ?? -1] ?? null;
  /** The inline answer panel replaces the composer while a request is live. */
  const answerVisible = activeAnswerRequest !== null && activeAnswerQuestion !== null;
  /**
   * Opens the answer state for a fresh pending request (once each — the
   * seen set survives resyncs). Focus is deliberately untouched: the inline
   * panel replaces the composer in place, and submit/dismiss return to
   * exactly where the user was.
   */
  useEffect(() => {
    if (openThreadId === null || picker !== null) return;
    const fresh = pendingAnswerRequests.find((request) => !seenAnswerRequestsRef.current.has(request.requestId));
    if (fresh === undefined) return;
    seenAnswerRequestsRef.current.add(fresh.requestId);
    setAnswerDraft({ requestId: fresh.requestId, index: 0, selected: {}, custom: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAnswerRequests, picker, openThreadId]);
  /**
   * Resolves one question the way the desktop does (sans attachments):
   * free text wins when present, otherwise the picked option values
   * validated against the question (multi-select needs at least one).
   */
  const resolveAnswerQuestion = (
    question: PendingUserInputQuestion,
    draft: { selected: Record<string, string[]>; custom: Record<string, string> },
  ): string | string[] | null => {
    const custom = draft.custom[question.id]?.trim() ?? "";
    if (question.allowCustomAnswer !== false && custom.length > 0) return custom;
    const valid = new Set(question.options.map((option) => option.value ?? option.label));
    const picked = (draft.selected[question.id] ?? []).filter((value) => valid.has(value));
    if (question.multiSelect) return picked.length > 0 ? picked : null;
    return picked[0] ?? null;
  };
  /**
   * Records one question's answer, then advances to the next question or
   * dispatches the whole record. Every question resolves through the same
   * function, so a stored answer can never disagree with what dispatch sends.
   */
  const answerCurrentQuestion = (questionId: string, update: { selected?: string[]; custom?: string }) => {
    if (answerDraft === null) return;
    const draft: AnswerDraft = {
      ...answerDraft,
      selected: update.selected === undefined ? answerDraft.selected : { ...answerDraft.selected, [questionId]: update.selected },
      custom: update.custom === undefined ? answerDraft.custom : { ...answerDraft.custom, [questionId]: update.custom },
    };
    const request = pendingAnswerRequests.find((candidate) => candidate.requestId === draft.requestId);
    if (request === undefined) {
      return;
    }
    if (draft.index + 1 < request.questions.length) {
      setAnswerDraft({ ...draft, index: draft.index + 1 });
      return;
    }
    const answers: Record<string, string | string[]> = {};
    for (const question of request.questions) {
      const resolved = resolveAnswerQuestion(question, draft);
      if (resolved === null) {
        setError("answer every question before submitting");
        return;
      }
      answers[question.id] = resolved;
    }
    const id = openThreadId;
    if (id === null) {
      return;
    }
    void client
      .dispatch({
        type: "thread.user-input.respond",
        commandId: crypto.randomUUID(),
        threadId: id,
        requestId: draft.requestId,
        answers,
        createdAt: new Date().toISOString(),
      })
      .then(() => {
        toasts.push("answer-submitted", "info", "Answer submitted", COPY_TOAST_MS);
        setSettledAnswerRequestIds((settled) =>
          settled.includes(draft.requestId) ? settled : [...settled, draft.requestId],
        );
      })
      .catch((cause: unknown) => {
        // A rejection right after answering in another client means the
        // request is already gone — re-check once settled instead of crying
        // error over a race the user already resolved.
        setTimeout(() => {
          const stillPending = pendingUserInputRequests(threadStateRef.current).some(
            (request) => request.requestId === draft.requestId,
          );
          if (stillPending) {
            setSettledAnswerRequestIds((settled) => settled.filter((entry) => entry !== draft.requestId));
            setError(dispatchErrorMessage(cause));
          } else {
            toasts.push("answer-elsewhere", "info", "Already answered elsewhere", COPY_TOAST_MS);
            setSettledAnswerRequestIds((settled) =>
              settled.includes(draft.requestId) ? settled : [...settled, draft.requestId],
            );
          }
        }, 800);
      });
  };
  /** Toggles one multi-select option without leaving the modal. */
  const toggleAnswerOption = (draft: NonNullable<typeof answerDraft>, questionId: string, value: string) => {
    const current = draft.selected[questionId] ?? [];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    setAnswerDraft({ ...draft, selected: { ...draft.selected, [questionId]: next } });
  };
  /**
   * Closes the request without answering (the agent is not messaged).
   * Rejected for native callback questions, which stay visible with the
   * error — toasts paint above everything, so it stays readable.
   */
  const dismissAnswerRequest = () => {
    const draft = answerDraft;
    const id = openThreadId;
    if (draft === null || id === null) {
      return;
    }
    void client
      .dispatch({
        type: "thread.user-input.dismiss",
        commandId: crypto.randomUUID(),
        threadId: id,
        requestId: draft.requestId,
        createdAt: new Date().toISOString(),
      })
      .then(() => {
        toasts.push("answer-dismissed", "info", "Question dismissed", COPY_TOAST_MS);
        setSettledAnswerRequestIds((settled) =>
          settled.includes(draft.requestId) ? settled : [...settled, draft.requestId],
        );
      })
      .catch((cause: unknown) => {
        setSettledAnswerRequestIds((settled) => settled.filter((entry) => entry !== draft.requestId));
        setError(dispatchErrorMessage(cause));
      });
  };
  /**
   * Opens the draft in the preferred external editor (explicit `$VISUAL` /
   * `$EDITOR` first, otherwise the first available graphical default: VS
   * Code, Zed, TextEdit on macOS; Notepad on Windows; `vi` elsewhere). The
   * app keeps rendering underneath with a "save and close" overlay that
   * swallows mouse events; keys are already gated via `editingExternally`.
   * On exit the temp file is read back into the draft and the textarea
   * force-syncs via the reset counter.
   */
  const editDraftExternally = () => {
    if (openThreadId === null || editingExternallyRef.current) return;
    const id = openThreadId;
    const seed = drafts[id] ?? "";
    setEditingExternally(true);
    void (async () => {
      let temp: { dir: string; file: string } | null = null;
      try {
        const { command, args } = await preferredEditorCommand();
        temp = await createTempDraftFile(seed);
        const exitCode = await runEditorAttached(command, args, temp.file);
        if (exitCode !== 0) {
          setError(`editor exited with code ${exitCode}`);
          return;
        }
        const edited = await readTempDraftFile(temp.file);
        if (edited !== seed) {
          writeDraft(id, edited);
          setComposerResetCounter((count) => count + 1);
        }
      } catch (cause: unknown) {
        setError(`could not open external editor: ${String(cause).slice(0, 80)}`);
      } finally {
        if (temp !== null) await cleanupTempDraftFile(temp.dir);
        setEditingExternally(false);
        setFocus("composer");
      }
    })();
  };
  /** Changes on thread switch (via `openThreadId`) and on every explicit
      clear (via the counter) — never on ordinary typing. */
  const composerResetKey = `${openThreadId ?? "none"}:${composerResetCounter}`;

  const writeDraft = (id: string, value: string) => {
    setDrafts((current) => {
      if (value.length === 0) {
        if (current[id] === undefined) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return current[id] === value ? current : { ...current, [id]: value };
    });
  };

  const setDraft = (value: string) => {
    if (openThreadId !== null) writeDraft(openThreadId, value);
  };

  /** Clears a thread's draft *and* tells the composer to force-sync its
      buffer — use this instead of `writeDraft(id, "")` for every clear that
      didn't originate from the composer's own `onInput`. */
  const resetDraft = (id: string) => {
    writeDraft(id, "");
    setComposerResetCounter((count) => count + 1);
  };

  const writePending = (id: string, next: ImageAttachmentUpload[]) => {
    setPendings((current) => {
      if (next.length === 0) {
        if (current[id] === undefined) return current;
        const copy = { ...current };
        delete copy[id];
        return copy;
      }
      return { ...current, [id]: next };
    });
  };

  const setPending = (next: ImageAttachmentUpload[] | ((current: ImageAttachmentUpload[]) => ImageAttachmentUpload[])) => {
    if (openThreadId === null) return;
    const id = openThreadId;
    if (typeof next === "function") {
      setPendings((current) => {
        const resolved = (next as (current: ImageAttachmentUpload[]) => ImageAttachmentUpload[])(current[id] ?? []);
        if (resolved.length === 0) {
          if (current[id] === undefined) return current;
          const copy = { ...current };
          delete copy[id];
          return copy;
        }
        return { ...current, [id]: resolved };
      });
      return;
    }
    writePending(id, next);
  };

  /** Threads holding an unsent draft or attachments — the sidebar marks them. */
  const markedThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of Object.keys(drafts)) ids.add(id);
    for (const id of Object.keys(pendings)) ids.add(id);
    return ids;
  }, [drafts, pendings]);

  useEffect(() => {
    if (openThreadId === null) return;
    selectedIdRef.current = openThreadId;
    setThreadState(emptyThreadState());
    turnPatchCache.current.clear();
    gitPatchCache.current = [];
    lastGitWanted.current = null;
    mergedToolInput.current.clear();
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

  /**
   * Fetches one turn's checkpoint patch into the shared cache (one fetch per
   * turn per thread-open). Failures stay uncached and retry on the next
   * expansion or resync — the backfill effect only runs on change, so a
   * failed fetch never hot-loops. Background failures stay silent: unlike
   * the diff panel there is no user action to attribute an error toast to.
   */
  const ensureTurnPatch = (threadId: string, turnCount: number) => {
    const cache = turnPatchCache.current;
    if (cache.has(turnCount) || patchInflight.current.has(turnCount)) return;
    patchInflight.current.add(turnCount);
    void client
      .turnDiff(threadId, turnCount)
      .then((result) => {
        patchInflight.current.delete(turnCount);
        if (selectedIdRef.current !== threadId) return;
        if (result !== null) {
          try {
            cache.set(turnCount, splitPatchByFile(result));
          } catch {
            cache.delete(turnCount);
          }
        } else {
          cache.delete(turnCount);
        }
        bumpTurnPatches((version) => version + 1);
      })
      .catch(() => {
        patchInflight.current.delete(turnCount);
        cache.delete(turnCount);
        bumpTurnPatches((version) => version + 1);
      });
  };

  /**
   * Opening or closing the diff panel resizes the chat pane on the same
   * click that triggered it — the reflow can land the mouse-up half of that
   * click on a message row that just shifted into this exact spot, opening
   * its actions unintentionally. Same swallow window as a modal dismiss.
   */
  const openDiff = (turnCount: number) => {
    if (openThreadId === null) return;
    markModalDismissed();
    if (expandedTurn === turnCount) {
      setExpandedTurn(null);
      setFocus("chat");
      return;
    }
    setExpandedTurn(turnCount);
    setPatch(null);
    setDiffFileIndex(0);
    setCollapsedFiles(new Set());
    setFocus("diff");
    const id = openThreadId;
    void client
      .turnDiff(id, turnCount)
      .then((result) => {
        setPatch(result);
        // Warm the inline backfill cache with the same patch so rows for
        // this turn show hunks without a second fetch.
        if (result !== null && selectedIdRef.current === id) {
          try {
            turnPatchCache.current.set(turnCount, splitPatchByFile(result));
            bumpTurnPatches((version) => version + 1);
          } catch {
            turnPatchCache.current.delete(turnCount);
          }
        }
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };

  /**
   * Resolves a checkpoint turn count to a group index: the rendered diff
   * entry by the picker's own count first (immune to foreign absorption),
   * the turnId lookup as fallback.
   */
  const timelineIndexForTurnCount = (turnCount: number): number | null => {
    const byDiff = groups.findIndex((group) => group.diff?.checkpoint?.checkpointTurnCount === turnCount);
    if (byDiff !== -1) return byDiff;
    const turnId = threadState.checkpoints.find((row) => row.checkpointTurnCount === turnCount)?.turnId ?? null;
    if (turnId === null) return null;
    const byTurn = groups.findIndex((group) => group.turnId === turnId);
    return byTurn === -1 ? null : byTurn;
  };

  /** Jumps the chat pane to the turn that owns `turnCount`'s checkpoint. */
  const scrollTimelineToTurn = (turnCount: number): void => {
    const index = timelineIndexForTurnCount(turnCount);
    if (index === null) return;
    scrollTimelineToIndex(index);
  };

  /**
   * Drives the chat pane to a proportional target, re-asserting on a short
   * schedule: reflows landing after the jump (slow patch fetch, streaming
   * events) can snap a sticky-bottom box back, so each follow-up re-reads
   * fresh measurements via `getTarget` and stops once the position holds.
   */
  const assertChatScroll = (getTarget: () => number | null, attempt = 0): void => {
    const pane = chatScrollRef.current;
    const target = getTarget();
    if (pane === null || target === null) return;
    pane.scrollTo(target);
    if (attempt < 2) {
      setTimeout(() => {
        const later = chatScrollRef.current;
        const fresh = getTarget();
        if (later === null || fresh === null) return;
        if (Math.abs(later.scrollTop - fresh) > 2) assertChatScroll(getTarget, attempt + 1);
      }, 150);
    }
  };

  /** Scrolls the chat pane to `index` of `groups` (stable under appends). */
  const scrollTimelineToIndex = (index: number, attempt = 0): void => {
    assertChatScroll(() => {
      const pane = chatScrollRef.current;
      if (pane === null || groups.length === 0 || index < 0 || index >= groups.length) return null;
      return proportionalTarget(index, groups.length, pane.scrollHeight, pane.viewport.height);
    }, attempt);
  };

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
    if (expandedTurn !== turnCount) openDiff(turnCount);
    else setFocus("diff");
    setTimeout(() => scrollTimelineToTurn(turnCount), 60);
  };

  /**
   * Folding or unfolding the Worked row adds or removes rows below it — the
   * same reflow hazard as opening the diff panel: the chat pane resizes on
   * the same click that triggered it, so the mouse-up half can land on a
   * message row that just shifted under the cursor. Same swallow window as a
   * modal dismiss.
   */
  const toggleWork = (id: string) => {
    markModalDismissed();
    setFocus("chat");
    setExpandedWork((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDiffFile = (index: number) => {
    setFocus("diff");
    setDiffFileIndex(index);
    const target = patchFiles[index];
    if (target === undefined) return;
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(target.path)) next.delete(target.path);
      else next.add(target.path);
      return next;
    });
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
   * off the OS clipboard into a pending attachment chip. Most terminals
   * swallow Ctrl+V for their own paste, so Alt+V is the reliable binding.
   */
  const pasteImage = () => {    setFocus("composer");
    void readClipboardImage().then((result) => {
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

  /**
   * New thread in the effective project (the picked override, else the open
   * thread's), inheriting the source's model and modes. The id is
   * client-generated so the thread can open immediately; the subscription
   * fills it in once the server projects both commands.
   */
  const createThread = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || selected === null) return;
    const source = selected;
    // The picked project wins over the source thread's — that is the whole
    // point of `creatingProjectId`. Without a resolvable project there is
    // nothing to create under.
    const projectId = creatingProjectId ?? source.projectId;
    if (projectId === undefined || projectId === null) {
      setError("pick a project for the new thread first");
      return;
    }
    const parsed = extractMentions(trimmed);
    void buildImageAttachments(parsed.paths, cwd ?? process.cwd()).then((built) => {
      if (built.error !== null) {
        setError(built.error.slice(0, 120));
        return;
      }
      if (selected === null) return;
      const nowIso = new Date().toISOString();
      const threadId = crypto.randomUUID();
      const title = threadTitle(parsed.text);
      const runtimeMode = source.runtimeMode ?? "full-access";
      const interactionMode = source.interactionMode ?? "default";
      // The local override picked while drafting wins over whatever the
      // source thread carries — that's the whole point of `creatingModelSelection`.
      const modelSelection = creatingModelSelection ?? source.modelSelection;
      const create = {
        type: "thread.create",
        commandId: crypto.randomUUID(),
        threadId,
        projectId,
        title,
        ...(modelSelection === undefined ? {} : { modelSelection }),
        runtimeMode,
        interactionMode,
        branch: source.branch ?? null,
        worktreePath: null,
        createdAt: nowIso,
      };
      const start = {
        type: "thread.turn.start",
        commandId: crypto.randomUUID(),
        threadId,
        message: {
          messageId: crypto.randomUUID(),
          role: "user",
          text: parsed.text,
          attachments: [...pending, ...built.attachments],
        },
        ...(modelSelection === undefined ? {} : { modelSelection }),
        titleSeed: title,
        runtimeMode,
        interactionMode,
        createdAt: nowIso,
      };
      void (async () => {
        try {
          await client.dispatch(create);
          await client.dispatch(start);
        } catch (cause: unknown) {
          setError(String(cause).slice(0, 120));
          return;
        }
        resetDraft(source.id);
        writePending(source.id, []);
        setCreating(false);
        setCreatingModelSelection(null);
        setCreatingProjectId(null);
        setFocus("chat");
        setOpenThreadId(threadId);
      })();
    });
  };

  /** Starts drafting a new thread in the open thread's project. Reachable
      from the sidebar's "+" button — no keybinding. */
  const startNewThread = () => {
    if (selected === null) {
      setError("no open thread to inherit the project from");
      return;
    }
    setCreatingModelSelection(null);
    setCreatingProjectId(null);
    setCreating(true);
    setFocus("composer");
  };

  /** Points the draft at another project; the new thread is created there. */
  const pickCreatingProject = (projectId: string) => {
    setCreatingProjectId(projectId);
    closePicker("composer");
  };

  /** Opens the project picker for the new thread's target project. */
  const openProjectPicker = () => {
    setPickerFilter("");
    setPicker("project");
    setFocus("chat");
  };

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
      // confirm branch above.
      const at = Date.now();
      if (at - lastCtrlCRef.current > CTRL_C_WINDOW_MS) ctrlCCountRef.current = 0;
      ctrlCCountRef.current += 1;
      lastCtrlCRef.current = at;
      if (openThreadId !== null) resetDraft(openThreadId);
      if (ctrlCCountRef.current >= 2) setQuitConfirmOpen(true);
      return;
    }
    if ((key.name === "v" || key.name === "V") && (key.ctrl || key.meta)) {
      pasteImage();
      return;
    }
    if (key.name === "t" && key.ctrl) {
      setTasksVisible((visible) => !visible);
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
        setExpandedTurn(null);
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

  const entries = useMemo(() => timeline(threadState), [threadState]);
  /** Turn groups own the scroll math: the diff-turn picker resolves a picked
      turn to a group index and jumps the chat pane to it. */
  const groups = useMemo(() => groupTurns(entries), [entries]);
  /**
   * Backfills inline per-edit diffs from each turn's checkpoint patch: the
   * wire strips tool input, so rows whose activity carries no content match
   * their file against the turn diff instead. Runs on transcript change
   * (new activities, fresh checkpoints, resyncs) — the cache + inflight
   * guards make it one fetch per turn, and failures stay uncached without
   * hot-looping since nothing here re-fires off a settled fetch.
   *
   * Rows in the still-running turn have no checkpoint yet, so they backfill
   * from a live working-tree diff instead (one `git diff` per wanted-set
   * change, matched per row the same way). Completed turns never consult
   * the tree — its hunks may belong to later turns.
   */
  useEffect(() => {
    if (openThreadId === null) return;
    const id = openThreadId;
    const lastId = groups.length === 0 ? null : (groups[groups.length - 1]?.id ?? null);
    // Declared below — read live here since the effect only ever runs
    // post-render (same pattern as sessionRunningRef/threadStateRef).
    const runningNow = threadState.session?.status === "running" || threadState.session?.status === "starting";
    const root =
      selected === null ? null : (shell.projects.find((project) => project.id === selected.projectId)?.workspaceRoot ?? null);
    const gitParts: string[] = [];
    const gitWanted: string[] = [];
    const mergeIds: string[] = [];
    for (const group of groups) {
      const turnCount = group.diff?.checkpoint?.checkpointTurnCount;
      const open = runningNow && group.id === lastId;
      let groupBare = false;
      for (const entry of group.work) {
        if (entry.kind !== "activity" || entry.activity === null) continue;
        let view: ActivityView | null = null;
        try {
          view = describeActivity(entry.activity);
        } catch {
          continue;
        }
        if (view.kind === "file" && view.diff === null) {
          groupBare = true;
          if (open && view.path !== "…") {
            gitParts.push(`${group.id}\n${view.path.toLowerCase()}\n${entry.id}`);
            gitWanted.push(view.path);
          }
        }
        const missing = missingCompletedInput(entry.activity, view);
        if (missing !== null && !mergedToolInput.current.has(missing)) mergeIds.push(missing);
      }
      if (turnCount !== undefined && groupBare) ensureTurnPatch(id, turnCount);
    }
    // Completed rows recover their stripped input from the local projection
    // database (exact per-edit diffs, no git needed). Merged rows re-render
    // through the normal pipeline; misses simply retry on the next new row
    // instead of hot-looping, since nothing here re-fires without change.
    if (stateDir !== null && mergeIds.length > 0) {
      const wanted = [...new Set(mergeIds)];
      for (const toolCallId of wanted) mergedToolInput.current.add(toolCallId);
      void readCompletedToolInputs(stateDir, id)
        .then((found) => {
          if (found === null || selectedIdRef.current !== id) return;
          let changed = false;
          const activities = threadStateRef.current.activities.map((row) => {
            const toolCallId = toolCallIdOf(row);
            const input = toolCallId === null ? undefined : found.get(toolCallId);
            if (toolCallId === null || input === undefined) return row;
            const next = withCompletedInput(row, input);
            if (next !== row) {
              changed = true;
              mergedToolInput.current.add(toolCallId);
            }
            return next;
          });
          if (!changed) return;
          setThreadState((current) => ({ ...current, activities }));
        })
        .catch(() => {});
    }
    if (root !== null && gitParts.length > 0) {
      gitParts.sort();
      const wanted = `${root}\n${gitParts.join("\n")}`;
      if (wanted !== lastGitWanted.current) {
        lastGitWanted.current = wanted;
        void fetchWorkingTreeDiff(root, [...new Set(gitWanted)])
          .then((files) => {
            if (selectedIdRef.current !== id) return;
            gitPatchCache.current = files ?? [];
            bumpTurnPatches((version) => version + 1);
          })
          .catch(() => {
            gitPatchCache.current = [];
          });
      }
    } else if (gitPatchCache.current.length > 0) {
      gitPatchCache.current = [];
      bumpTurnPatches((version) => version + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, openThreadId, client, selected, shell.projects, stateDir]);
  const plan = useMemo(() => latestPlan(threadState), [threadState]);
  const diffWidth = Math.max(40, Math.floor((width - SIDEBAR_WIDTH) / 2));
  const patchFiles = useMemo(() => (patch === null ? [] : splitPatchByFile(patch)), [patch]);
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
  /** Live read of the above for picker-row callbacks, whose memo snapshot
      goes stale while the modal is open (same pattern as editingExternallyRef). */
  const sessionRunningRef = useRef(false);
  sessionRunningRef.current = sessionRunning;
  /** Live thread state for delayed re-checks (answer race detection). */
  const threadStateRef = useRef(threadState);
  threadStateRef.current = threadState;

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

  /**
   * The catalog loads once per session from `server.getConfig` and feeds both
   * the composer footer labels and the model picker; picking dispatches
   * `thread.model-selection.set` and the thread subscription projects the new
   * model into the footer.
   */
  const ensureProviders = () => {
    if (providers !== null || providersLoading) return;
    setProvidersLoading(true);
    void client.getConfig().then(
      (response) => {
        try {
          setProviders(extractProviders(response));
        } catch (cause: unknown) {
          setProvidersError(String(cause).slice(0, 120));
        }
        setProvidersLoading(false);
      },
      (cause: unknown) => {
        setProvidersError(String(cause).slice(0, 120));
        setProvidersLoading(false);
      },
    );
  };

  // Footer labels need the catalog even when the picker never opens.
  useEffect(() => {
    ensureProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const closePicker = (returnFocus: "composer" | "chat" | "diff" = "composer") => {
    setPicker(null);
    setPickerFilter("");
    setDeleteArmed(false);
    setRevertArmed(false);
    markModalDismissed();
    setFocus(returnFocus);
  };

  const closeQuitConfirm = () => {
    setQuitConfirmOpen(false);
    markModalDismissed();
    setFocus("chat");
  };

  /** Opens the command palette, remembering where esc should return focus. */
  const openCommandPalette = () => {
    setPaletteReturnFocus(focus);
    setDeleteArmed(false);
    setPickerFilter("");
    setPicker("command");
  };

  const openModelPicker = () => {
    if (selected === null) {
      setError("no open thread to set the model for");
      return;
    }
    setProvidersError(null);
    setPickerFilter("");
    setPicker("model");
    setFocus("chat");
    ensureProviders();
  };

  const openEffortPicker = () => {
    if (selected === null) {
      setError("no open thread to set the effort for");
      return;
    }
    setProvidersError(null);
    setPickerFilter("");
    setPicker("effort");
    setFocus("chat");
    ensureProviders();
  };

  /**
   * While drafting a new thread this only lands in `creatingModelSelection`
   * — the new thread doesn't exist yet, so there is nothing to dispatch
   * against; `createThread` reads it back when it actually sends the
   * `thread.create`/`thread.turn.start` pair. Otherwise it dispatches
   * `thread.model-selection.set` against the open thread, same as before.
   */
  const setThreadModel = (modelSelection: {
    instanceId: string;
    model: string;
    options?: ProviderOptionSelection[];
  }) => {
    if (creating) {
      setCreatingModelSelection(modelSelection);
      closePicker();
      return;
    }
    if (openThreadId === null) return;
    void client
      .dispatch({
        type: "thread.model-selection.set",
        commandId: crypto.randomUUID(),
        threadId: openThreadId,
        modelSelection,
      })
      .then(() => {
        closePicker();
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };

  /**
   * Switching models keeps the effort-style options that still exist on the
   * new model; dropping them would silently reset the effort knob.
   */
  const pickModel = (choice: { instanceId: string; model: string }) => {
    const catalogModel = providers
      ?.find((provider) => provider.instanceId === choice.instanceId)
      ?.models.find((model) => model.slug === choice.model);
    const kept = (effectiveModelSelection?.options ?? []).filter(
      (option) =>
        typeof option.value === "boolean" ||
        catalogModel?.efforts.some((effort) => effort.id === option.id) === true,
    );
    setThreadModel({
      instanceId: choice.instanceId,
      model: choice.model,
      ...(kept.length > 0 ? { options: kept } : {}),
    });
  };

  const pickEffort = (descriptorId: string, choiceId: string) => {
    const current = effectiveModelSelection;
    if (current === undefined) return;
    setThreadModel({
      instanceId: current.instanceId,
      model: current.model,
      options: [...(current.options ?? []).filter((option) => option.id !== descriptorId), { id: descriptorId, value: choiceId }],
    });
  };

  // A 1s tick while a turn is in flight drives the thinking/working elapsed
  // counter; the 30s tick above is enough for sidebar ages when idle.
  useEffect(() => {
    if (!sessionRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessionRunning]);
  // Pretty catalog name, never the raw slug; the effort knob (e.g. xhigh)
  // comes from the selection options. Interaction mode ("Build") is
  // intentionally not shown. The model lives in exactly one place: the
  // composer footer. The timeline subtitle and status bar carry status only.
  const model = displayModelName(providers, effectiveModelSelection);
  const effort = displayEffort(providers, effectiveModelSelection);
  // There is no bottom bar to carry these — each is a floating toast in the
  // top-right corner instead, pushed into `toasts` by the effects above
  // (quit-armed, usage-limit) or by `setError`; each clears itself.

  /** The open thread's own provider — undefined until the catalog has
      loaded at least once. Backs both the `$` skill picker and the
      provider-brand color on the model name. */
  const currentProvider = providers?.find((candidate) => candidate.instanceId === effectiveModelSelection?.instanceId);
  const currentSkills = currentProvider?.skills;
  const modelColor = providerColor(currentProvider?.driver, effectiveModelSelection?.instanceId, model);
  const contextUsageDisplay = threadState.contextUsage === null ? null : formatContextUsage(threadState.contextUsage);

  const chatWidth = Math.max(
    20,
    width - SIDEBAR_WIDTH - (expandedTurn === null ? 0 : diffWidth) - 2 - CHAT_GUTTER * 2,
  );
  /** Toasts stay entirely inside one pane's own bounds, with a 1-col margin:
      the diff panel's while it is open, the chat/timeline pane's otherwise —
      never floating over the sidebar or straddling panes. */
  const toastGeometry = useMemo(() => {
    const chatLeft = SIDEBAR_WIDTH + CHAT_GUTTER;
    const diffLeft = expandedTurn === null ? null : chatLeft + chatWidth + CHAT_GUTTER;
    const paneLeft = diffLeft ?? chatLeft;
    const paneWidth = diffLeft === null ? chatWidth : diffWidth;
    const paneRight = paneLeft + paneWidth;
    const toastWidth = Math.min(60, Math.max(24, paneWidth - TOAST_INSET * 2));
    return {
      left: Math.max(paneLeft + TOAST_INSET, paneRight - TOAST_INSET - toastWidth),
      width: toastWidth,
    };
  }, [chatWidth, diffWidth, expandedTurn]);
  const projectTitle =
    shell.projects.find((project) => project.id === effectiveProjectId)?.title ?? "this project";

  const tasksVisibleNow = plan !== null && tasksVisible;
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
              scrollTimelineToIndex(index);
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
                  if (selected === null) {
                    setError("no open thread to start from");
                    return;
                  }
                  startNewThread();
                  closePicker("composer");
                },
              },
              {
                key: "thread:new-project",
                label: "New thread in project…",
                onPick: () => {
                  if (selected === null) {
                    setError("no open thread to start from");
                    return;
                  }
                  if (!creating) {
                    setCreatingModelSelection(null);
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
                selected: row.checkpointTurnCount === expandedTurn,
                onPick: () => pickDiffTurn(row.checkpointTurnCount),
              };
            }),
          },
        ],
      };
    }
    // The new-thread project list needs no provider catalog either: every
    // known project, with the effective (picked or inherited) one marked.
    if (picker === "project") {
      return {
        kind: "list",
        sections: [
          {
            rows: shell.projects.map((project) => {
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
    // every provider, grouped into sections so browsing them stays sane.
    if (creating) {
      return {
        kind: "list",
        sections: providers
          .filter((provider) => provider.models.length > 0)
          .map((provider) => ({
            header: provider.displayName ?? provider.instanceId,
            rows: provider.models.map((model) => ({
              key: `${provider.instanceId}:${model.slug}`,
              label: model.name,
              selected: current?.instanceId === provider.instanceId && current?.model === model.slug,
              onPick: () => pickModel({ instanceId: provider.instanceId, model: model.slug }),
            })),
          })),
      };
    }
    // An open thread already has a live session on one provider — there is
    // no in-picker provider switch, so only that provider's models are offered.
    const provider = providers.find((candidate) => candidate.instanceId === current?.instanceId);
    return {
      kind: "list",
      sections: [
        {
          rows: (provider?.models ?? []).map((model) => ({
            key: `${provider?.instanceId}:${model.slug}`,
            label: model.name,
            selected: current?.model === model.slug,
            onPick: () => pickModel({ instanceId: provider!.instanceId, model: model.slug }),
          })),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, providers, providersError, effectiveModelSelection, creating, deleteArmed, deleteSupported, revertArmed, answerDraft]);

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
      setCreating(false);
      setCreatingModelSelection(null);
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
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Sidebar
          sections={sections}
          openThreadId={openThreadId}
          markedThreadIds={markedThreadIds}
          settledExpanded={settledExpanded}
          width={SIDEBAR_WIDTH}
          onOpenThread={(threadId) => {
            setFocus("chat");
            setCreating(false);
            setPicker(null);
            setPickerFilter("");
            setOpenThreadId(threadId);
          }}
          onToggleSettled={() => setSettledExpanded((expanded) => !expanded)}
          onShowMore={() => setSettledLimit((limit) => limit + SETTLED_PAGE)}
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
            {/* Explicit max-width column: alignItems:center shrink-wraps
                children, so the composer needs its own width instead of
                stretching like it does in the thread view. */}
            <box
              style={{
                flexDirection: "column",
                flexShrink: 0,
                width: Math.min(76, Math.max(40, width - SIDEBAR_WIDTH - 8)),
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
                flushTop={pending.length > 0}
                submitVerb="creates"
                running={false}
                width={Math.min(76, Math.max(40, width - SIDEBAR_WIDTH - 8))}
                hideHint
                onModelClick={openModelPicker}
                onEffortClick={openEffortPicker}
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
          <Timeline
            groups={groups}
            title={selected === null ? "no thread" : String(selected.title ?? selected.id)}
            subtitle={`${session?.status ?? "idle"}`}
            model={model}
            modelColor={modelColor}
            t3Home={t3Home}
            expandedTurn={expandedTurn}
            expandedWork={expandedWork}
            onToggleWork={toggleWork}
            scrollRef={chatScrollRef}
            focused={focus === "chat"}
            onFocus={() => setFocus("chat")}
            onOpenDiff={openDiff}
            onOpenMessageActions={openMessageActions}
            onOpenUrl={openFetchedUrl}
            turnFileDiffs={turnPatchCache.current}
            gitFiles={gitPatchCache.current}
            width={chatWidth}
            sessionStatus={session?.status ?? "idle"}
            now={now}
            turnStartedAt={selected?.latestTurn?.startedAt ?? selected?.latestTurn?.requestedAt ?? null}
          />
          {/* One blank row between each visible bottom block: every block
              below carries marginTop 1 and nothing else adds gaps. */}
          {tasksVisibleNow && plan !== null ? <TasksPanel plan={plan} width={chatWidth} /> : null}
          {renderAttachmentStrip(tasksVisibleNow)}
          {resumeBanner === null ? null : (
            <box
              style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}
              border={["top"]}
              borderColor={SURFACE.border}
            >
              <text fg={COLOR.warn} selectable={false}>
                {`Resume with less context · ${formatTokenCount(resumeBanner.usedTokens)} tokens from earlier `}
              </text>
              <text fg={COLOR.accent} selectable={false} onMouseDown={() => compactSession(() => setDismissedResumeKey(resumeBanner.key))}>
                {`[compact] `}
              </text>
              <text fg={COLOR.faint} selectable={false} onMouseDown={() => setDismissedResumeKey(resumeBanner.key)}>
                {`[dismiss]`}
              </text>
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
            flushTop={pending.length > 0}
            submitVerb="sends"
            running={sessionRunning}
            width={chatWidth}
            onModelClick={openModelPicker}
            onEffortClick={openEffortPicker}
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
        {expandedTurn === null ? null : (
          <DiffPanel
            files={patchFiles}
            loading={patch === null}
            fileIndex={diffFileIndex}
            collapsed={collapsedFiles}
            width={diffWidth}
            turnCount={expandedTurn}
            turnTotal={threadState.checkpoints.filter((row) => row.files.length > 0).length}
            focused={focus === "diff"}
            scrollRef={diffScrollRef}
            onToggleFile={toggleDiffFile}
            onFocus={() => setFocus("diff")}
            onHeaderClick={openDiffTurnPicker}
          />
        )}
      </box>
      {contextCardOpen && contextUsageDisplay !== null && threadState.contextUsage !== null ? (
        <ContextUsageCard
          usage={threadState.contextUsage}
          width={Math.min(40, Math.max(28, width - SIDEBAR_WIDTH - 6))}
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
          borderColor={TOAST_COLOR[toast.tone]}
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
                fg={quitCancelHover.hovered ? COLOR.text : COLOR.dim}
                selectable={false}
                onMouseDown={closeQuitConfirm}
                {...quitCancelHover.handlers}
              >
                {"Cancel (esc)"}
              </text>
              <text
                fg={COLOR.danger}
                attributes={quitConfirmHover.hovered ? TextAttributes.BOLD | TextAttributes.UNDERLINE : 0}
                selectable={false}
                onMouseDown={onQuit}
                {...quitConfirmHover.handlers}
              >
                {"   Quit (enter / ctrl+c again)"}
              </text>
            </box>
          </box>
        </ModalShell>
      ) : null}
      {editingExternally ? (
        // The external editor owns the terminal now: keep rendering the app
        // underneath, but swallow every mouse event behind this catcher so
        // nothing clickable fires until the editor closes. Keys are already
        // gated via `editingExternally`.
        <box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            flexDirection: "column",
            justifyContent: "center",
            zIndex: 40,
          }}
          selectable={false}
          onMouseDown={() => {}}
        >
          <text fg={COLOR.faint} selectable={false}>{"─".repeat(Math.max(0, width))}</text>
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "center" }}>
            <text fg={COLOR.dim} selectable={false}>{"Save and close editor to continue…"}</text>
          </box>
          <text fg={COLOR.faint} selectable={false}>{"─".repeat(Math.max(0, width))}</text>
        </box>
      ) : null}
    </box>
  );
}
