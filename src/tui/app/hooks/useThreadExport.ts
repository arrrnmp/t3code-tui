import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultExportFilename, formatThreadExport, type ExportProject } from "../../model/export.js";
import type { ContextUsage, PendingUserInputRequest, PlanSnapshot } from "../../model/thread.js";
import type { TurnGroup } from "../../model/turns.js";
import type { T3Thread } from "../../../types.js";
import type { useToasts } from "../../hooks/useToasts.js";
import { COPY_TOAST_MS } from "../constants.js";

async function uniquePath(dir: string, filename: string): Promise<string> {
  const dot = filename.lastIndexOf(".");
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? "" : filename.slice(dot);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = join(dir, attempt === 0 ? filename : `${base}-${attempt + 1}${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
  return join(dir, `${base}-${Date.now()}${ext}`);
}

/**
 * Command-palette "Export thread" action: renders the whole thread (every
 * turn, one line per tool call, cumulative file edits, open questions, plan
 * checklist) to a single token-compact markdown handover file another agent
 * can continue from. The file lands next to the work — the thread project's
 * workspace root, else the launch directory — with a numeric suffix when the
 * name is taken. The path is toasted and copied (best-effort) so it can be
 * pasted straight into the next session.
 */
export function useThreadExport(params: {
  thread: T3Thread | null;
  openThreadId: string | null;
  project: ExportProject | null;
  groups: TurnGroup[];
  plan: PlanSnapshot | null;
  pending: PendingUserInputRequest[];
  contextUsage: ContextUsage | null;
  exportDir: string | null;
  fallbackDir: string | undefined;
  clipboard: { copyText: (text: string) => Promise<boolean> };
  toasts: ReturnType<typeof useToasts>;
  paletteReturnFocus: "chat" | "composer" | "diff";
  closePicker: (returnFocus?: "composer" | "chat" | "diff") => void;
  setError: (message: string) => void;
}) {
  const {
    thread,
    openThreadId,
    project,
    groups,
    plan,
    pending,
    contextUsage,
    exportDir,
    fallbackDir,
    clipboard,
    toasts,
    paletteReturnFocus,
    closePicker,
    setError,
  } = params;

  const exportThread = () => {
    if (openThreadId === null || thread === null) {
      setError("no open thread to export");
      return;
    }
    if (groups.length === 0) {
      setError("nothing to export yet");
      return;
    }
    const id = openThreadId;
    const markdown = formatThreadExport({
      thread,
      threadId: id,
      project,
      groups,
      plan,
      pending,
      contextUsage,
    });
    const dir = exportDir ?? fallbackDir ?? process.cwd();
    const filename = defaultExportFilename(thread, id);
    void uniquePath(dir, filename)
      .then((path) => writeFile(path, markdown, "utf8").then(() => path))
      .then((path) => {
        toasts.push("thread-exported", "info", `Exported ${groups.length} turn${groups.length === 1 ? "" : "s"} to ${path}`, COPY_TOAST_MS);
        closePicker(paletteReturnFocus);
        void clipboard.copyText(path).catch(() => false);
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };

  return { exportThread };
}
