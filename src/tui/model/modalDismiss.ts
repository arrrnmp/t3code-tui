let lastDismissedAt = 0;

/**
 * Call whenever a dismiss or collapse removes content from under the cursor
 * or reflows the chat pane on the same click — modal close (backdrop click,
 * Escape, Cancel, row pick), diff open/close, toast manual dismiss, or an
 * inline expandable toggle (WorkFold/ToolStack/PlanCard). Every one of these
 * paths should mark itself here, not just the ones a caller happens to wire
 * up: the mouse-down closes/collapses while the matching mouse-up lands on
 * whatever is now exposed underneath (a message turn, a sidebar row, ...),
 * and that stray click should be swallowed rather than acted on.
 */
export function markModalDismissed(): void {
  lastDismissedAt = Date.now();
}

/** True for `windowMs` after the last `markModalDismissed()` call. */
export function wasModalJustDismissed(windowMs = 250): boolean {
  return Date.now() - lastDismissedAt < windowMs;
}
