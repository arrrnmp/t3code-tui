import { useMemo, useState } from "react";

import { buildSidebarSections, orderedProjectIds, type SidebarMode } from "../../model/sidebar.js";
import type { ShellState } from "../../model/shell.js";
import { SETTLED_PAGE } from "../../app/constants.js";

export function useSidebar(shell: ShellState, openThreadId: string | null, now: number) {
  const [settledExpanded, setSettledExpanded] = useState(false);
  const [settledLimit, setSettledLimit] = useState(SETTLED_PAGE);
  /** Threads pane: flat recency list, project-grouped list, or one project. */
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("flat");
  /** Explicit project for `project` mode; null follows the open thread. */
  const [sidebarProjectId, setSidebarProjectId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set());

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

  return {
    sections,
    settledExpanded,
    toggleSettledExpanded: () => setSettledExpanded((expanded) => !expanded),
    showMoreSettled: () => setSettledLimit((limit) => limit + SETTLED_PAGE),
    sidebarMode,
    setSidebarMode,
    cycleSidebarMode,
    toggleSidebarProject,
    cycleSidebarProject,
  };
}
