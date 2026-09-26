import { useMemo, useState } from "react";

import { latestBackgroundTasks, latestPlan, type ThreadState } from "../../model/thread.js";

/**
 * Claude Code-style tasks checklist above the composer; ctrl+t toggles.
 * Background work (`background`) is surfaced separately, through the
 * composer's own footer segment and the background-tasks browser it opens —
 * unlike the checklist it isn't pinned, so it carries no visibility toggle.
 */
export function useTasksPanel(threadState: ThreadState) {
  const [tasksVisible, setTasksVisible] = useState(true);
  const plan = useMemo(() => latestPlan(threadState), [threadState]);
  const background = useMemo(() => latestBackgroundTasks(threadState), [threadState]);
  const tasksVisibleNow = plan !== null && tasksVisible;

  const toggleTasksVisible = () => setTasksVisible((visible) => !visible);

  return { plan, background, tasksVisibleNow, toggleTasksVisible };
}
