import type { CliRenderer } from "@opentui/core";

import { threadStatus } from "../../model/shell.js";
import { emptyThreadState, type TimelineEntry } from "../../model/thread.js";
import { wasModalJustDismissed } from "../../model/modalDismiss.js";
import type { useToasts } from "../../hooks/useToasts.js";
import type { ModelSelection, RuntimeMode, T3Thread } from "../../../types.js";
import type { TuiClient } from "../app.js";
import type { PickerName } from "../../features/pickers/pickerTypes.js";
import { COPY_TOAST_MS } from "../constants.js";

/**
 * Thread-lifecycle operations reachable from the command palette and the
 * message-actions modal: delete, settle/unsettle, regenerate title, archive,
 * compact, open message actions, revert a turn, and rename. `deleteArmed` /
 * `deleteSupported` / `messageActionEntry` / `revertArmed` state stays in
 * `App` — `pickerBody` reads them directly to build the message-actions and
 * command-palette rows, so only the handlers that *write* them move here.
 */
export function useThreadOps(params: {
  client: TuiClient;
  renderer: CliRenderer | null;
  openThreadId: string | null;
  selected: T3Thread | null;
  creating: boolean;
  shellThreads: T3Thread[];
  activeThreadIds: string[];
  toasts: ReturnType<typeof useToasts>;
  paletteReturnFocus: "chat" | "composer" | "diff";
  deleteArmed: boolean;
  revertArmed: boolean;
  sessionRunningRef: { current: boolean };
  closePicker: (returnFocus?: "composer" | "chat" | "diff") => void;
  closeDiff: () => void;
  setError: (message: string) => void;
  setOpenThreadId: (id: string | null) => void;
  setDeleteArmed: (armed: boolean) => void;
  setDeleteSupported: (supported: boolean) => void;
  setRevertArmed: (armed: boolean) => void;
  setMessageActionEntry: (entry: TimelineEntry | null) => void;
  setPickerFilter: (filter: string) => void;
  setPicker: (picker: PickerName) => void;
  setCreatingModelSelection: (selection: ModelSelection | null) => void;
  setCreatingRuntimeMode: (mode: RuntimeMode | null) => void;
  setCreatingProjectId: (id: string | null) => void;
  setCreating: (creating: boolean) => void;
  setFocus: (focus: "chat" | "composer") => void;
  setThreadState: (updater: ReturnType<typeof emptyThreadState> | (() => ReturnType<typeof emptyThreadState>)) => void;
  setThreadResync: (updater: (count: number) => number) => void;
}) {
  const {
    client,
    renderer,
    openThreadId,
    selected,
    creating,
    shellThreads,
    activeThreadIds,
    toasts,
    paletteReturnFocus,
    deleteArmed,
    revertArmed,
    sessionRunningRef,
    closePicker,
    closeDiff,
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
  } = params;

  /**
   * Deletes the open thread behind a two-step confirm (first pick arms).
   * `thread.delete` has only ever been used as create-rollback, so a
   * rejection permanently disables the row for the session instead of
   * retrying. Deleting the last thread lands in the creating view, which is
   * fully wired for a zero-thread workspace (project/model pickers plus draft
   * all work without a source thread).
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
    const fallback = activeThreadIds.find((threadId) => threadId !== id) ?? null;
    void client
      .dispatch({ type: "thread.delete", commandId: crypto.randomUUID(), threadId: id })
      .then(() => {
        toasts.push("thread-deleted", "info", "Thread deleted", COPY_TOAST_MS);
        closePicker("chat");
        if (fallback === null) {
          setCreatingModelSelection(null);
          setCreatingRuntimeMode(null);
          setCreatingProjectId(null);
          setCreating(true);
          setFocus("composer");
        }
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
          setCreatingRuntimeMode(null);
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
   * next thread like delete does. Archiving the last visible thread lands in
   * the creating view (same zero-thread path as delete). Also refuses while
   * drafting, for the same reason as delete.
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
    const fallback = activeThreadIds.find((threadId) => threadId !== id) ?? null;
    void client
      .dispatch({ type: "thread.archive", commandId: crypto.randomUUID(), threadId: id })
      .then(() => {
        toasts.push("thread-archived", "info", "Thread archived", COPY_TOAST_MS);
        closePicker("chat");
        if (fallback === null) {
          setCreatingModelSelection(null);
          setCreatingRuntimeMode(null);
          setCreatingProjectId(null);
          setCreating(true);
          setFocus("composer");
        }
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
        closeDiff();
        setThreadState(emptyThreadState());
        setThreadResync((count) => count + 1);
      })
      .catch((cause: unknown) => {
        setRevertArmed(false);
        setError(String(cause).slice(0, 120));
      });
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

  return {
    deleteThread,
    toggleSettleThread,
    regenerateThreadTitle,
    archiveThread,
    compactSession,
    openMessageActions,
    revertMessageTurn,
    submitRename,
  };
}
