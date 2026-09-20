import { useMemo, useRef, useState } from "react";

import { useClipboard } from "../../hooks/useClipboard.js";
import type { useToasts } from "../../hooks/useToasts.js";
import {
  cleanupTempDraftFile,
  createTempDraftFile,
  preferredEditorCommand,
  readTempDraftFile,
  runEditorAttached,
} from "../../model/externalEditor.js";
import type { ImageAttachmentUpload } from "../../../cli/threads/threadApi.js";
import { COPY_TOAST_MS } from "../../app/constants.js";

/**
 * Composition is per thread: switching threads stashes the draft and
 * pending attachments under the old id and restores the new one's, so a
 * half-written message is never lost or leaked into another thread. Owns
 * the draft/attachment storage and the external-editor round trip; the
 * actual submit/send flow stays with the app (it needs the client, the
 * open thread, and the creating-a-new-thread branch).
 */
export function useComposer(
  openThreadId: string | null,
  clipboard: ReturnType<typeof useClipboard>,
  toasts: ReturnType<typeof useToasts>,
  setError: (message: string) => void,
  setFocus: (focus: "composer") => void,
) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Bumped on every explicit external draft clear (post-send, ctrl+c) so the
      composer can tell "I cleared you" apart from "you're still typing" —
      see `Composer`'s `resetKey` doc comment. */
  const [composerResetCounter, setComposerResetCounter] = useState(0);
  const [pendings, setPendings] = useState<Record<string, ImageAttachmentUpload[]>>({});
  /** While the draft sits in `$EDITOR`, the composer rejects input — keys
      are gated in `useKeyboard` and the textarea unfocuses via this flag. */
  const [editingExternally, setEditingExternally] = useState(false);
  const editingExternallyRef = useRef(false);
  editingExternallyRef.current = editingExternally;

  /**
   * Draft key while there is no open thread (fresh install, zero threads):
   * the creating view still needs a place to stash the prompt, so it drafts
   * under a stable ephemeral key instead of dropping keystrokes. Once the
   * first thread is created the subscription selects it and the draft moves
   * with `openThreadId` like every other thread switch.
   */
  const draftKey = openThreadId ?? "__creating__";
  const draft = drafts[draftKey] ?? "";
  const pending = pendings[draftKey] ?? [];

  const copyDraft = () => {
    if (draft.trim().length === 0) return;
    void clipboard.copyText(draft).then((ok) => {
      if (ok) toasts.push("copy-draft", "info", "Copied to clipboard", COPY_TOAST_MS);
      else if (clipboard.isRemote()) setError("copy failed — terminal may block OSC 52");
    });
  };

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
    writeDraft(draftKey, value);
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
    const id = draftKey;
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

  /** Changes on thread switch (via `draftKey`) and on every explicit
      clear (via the counter) — never on ordinary typing. */
  const composerResetKey = `${draftKey}:${composerResetCounter}`;

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
    if (editingExternallyRef.current) return;
    const id = draftKey;
    const seed = drafts[id] ?? "";
    setEditingExternally(true);
    void (async () => {
      let temp: { dir: string; file: string } | null = null;
      let editor = "editor";
      try {
        const { command, args } = await preferredEditorCommand();
        editor = command;
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
        setError(`could not open ${editor}: ${String(cause).slice(0, 80)}`);
      } finally {
        if (temp !== null) await cleanupTempDraftFile(temp.dir);
        setEditingExternally(false);
        setFocus("composer");
      }
    })();
  };

  return {
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
  };
}
