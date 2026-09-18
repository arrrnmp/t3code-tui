import { useMemo, useState } from "react";

import { latestPlan, type ThreadState } from "../../model/thread.js";

/** Claude Code-style tasks panel above the composer; ctrl+t toggles. */
export function useTasksPanel(threadState: ThreadState) {
  const [tasksVisible, setTasksVisible] = useState(true);
  const plan = useMemo(() => latestPlan(threadState), [threadState]);
  const tasksVisibleNow = plan !== null && tasksVisible;

  const toggleTasksVisible = () => setTasksVisible((visible) => !visible);

  return { plan, tasksVisibleNow, toggleTasksVisible };
}
