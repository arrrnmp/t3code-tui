import { basename, resolve } from "node:path";

import { buildImageAttachments, extractMentions } from "../../model/attachments.js";
import { dispatchErrorMessage } from "../../../errors.js";
import type { ModelSelection, RuntimeMode, T3Project, T3Thread } from "../../../types.js";
import type { ImageAttachmentUpload } from "../../../cli/threads/threadApi.js";
import type { TuiClient } from "../app.js";
import type { PickerName } from "../../features/pickers/pickerTypes.js";
import { threadTitle } from "../utils.js";

/**
 * New-thread draft flow: handlers for starting a draft, picking or creating
 * its target project, and sending it as `thread.create` + `thread.turn.start`.
 * The `creating`/`creatingModelSelection`/`creatingRuntimeMode`/
 * `creatingProjectId` state itself stays in `App` — it's read from ~20
 * unrelated sites throughout the component (the JSX render fork, every
 * picker, the resume banner, ...), so only the handlers that *write* it move
 * here; the state stays where all those readers already look for it.
 */
export function useThreadCreation(params: {
  client: TuiClient;
  cwd: string | undefined;
  selected: T3Thread | null;
  pending: ImageAttachmentUpload[];
  shellProjects: T3Project[];
  creatingProjectId: string | null;
  creatingModelSelection: ModelSelection | null;
  creatingRuntimeMode: RuntimeMode | null;
  resetDraft: (id: string) => void;
  writePending: (id: string, next: ImageAttachmentUpload[]) => void;
  setCreating: (creating: boolean) => void;
  setCreatingModelSelection: (selection: ModelSelection | null) => void;
  setCreatingRuntimeMode: (mode: RuntimeMode | null) => void;
  setCreatingProjectId: (id: string | null) => void;
  setFocus: (focus: "chat" | "composer") => void;
  setOpenThreadId: (id: string) => void;
  setError: (message: string) => void;
  setPicker: (picker: PickerName) => void;
  setPickerFilter: (filter: string) => void;
  closePicker: (returnFocus?: "composer" | "chat" | "diff") => void;
}) {
  const {
    client,
    cwd,
    selected,
    pending,
    shellProjects,
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
  } = params;

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
      const interactionMode = source.interactionMode ?? "default";
      // The local override picked while drafting wins over whatever the
      // source thread carries — that's the whole point of `creatingModelSelection`.
      const modelSelection = creatingModelSelection ?? source.modelSelection;
      const runtimeMode = creatingRuntimeMode ?? source.runtimeMode ?? "full-access";
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
        setCreatingRuntimeMode(null);
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
    setCreatingRuntimeMode(null);
    setCreatingProjectId(null);
    setCreating(true);
    setFocus("composer");
  };

  /** Points the draft at another project; the new thread is created there. */
  const pickCreatingProject = (projectId: string) => {
    setCreatingProjectId(projectId);
    closePicker("composer");
  };

  /** Creates a project from a local folder and points the draft at it. An
      already-known folder just selects its project (same as the CLI's
      `projects ensure`). Shape mirrors the CLI's `buildProjectCreateCommand`
      (`src/cli/projects/projects.ts`) — the server fills in the rest. */
  const submitProjectFolder = (rawPath: string) => {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) {
      setError("enter a folder path for the new project");
      return;
    }
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if ((trimmed === "~" || trimmed.startsWith("~/")) && home.length === 0) {
      setError("could not resolve ~ — enter a full path");
      return;
    }
    const workspaceRoot = resolve(trimmed === "~" || trimmed.startsWith("~/") ? home + trimmed.slice(1) : trimmed);
    const normalized = workspaceRoot.replace(/[/\\]+$/, "");
    const existing = shellProjects.find(
      (project) =>
        typeof project.workspaceRoot === "string" && project.workspaceRoot.replace(/[/\\]+$/, "") === normalized,
    );
    if (existing !== undefined) {
      pickCreatingProject(existing.id);
      return;
    }
    const projectId = crypto.randomUUID();
    const title = basename(workspaceRoot) || "project";
    void client
      .dispatch({
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId,
        title,
        workspaceRoot,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
        createdAt: new Date().toISOString(),
      })
      .then(() => pickCreatingProject(projectId))
      .catch((cause: unknown) => setError(dispatchErrorMessage(cause)));
  };

  /** Opens the project picker for the new thread's target project. */
  const openProjectPicker = () => {
    setPickerFilter("");
    setPicker("project");
    setFocus("chat");
  };

  return { createThread, startNewThread, pickCreatingProject, submitProjectFolder, openProjectPicker };
}
