import { COLOR } from "../theme.js";
import type { ToastTone } from "../hooks/useToasts.js";

export const SIDEBAR_WIDTH = 44;
/** Breathing columns on each side of the chat stack (timeline, tasks,
    attachments, composer). */
export const CHAT_GUTTER = 1;
export const SETTLED_PAGE = 10;
/** How long a status-bar error stays up before it clears itself. */
export const ERROR_DISPLAY_MS = 6_000;
/** How long the "copied to clipboard" confirmation stays up. */
export const COPY_TOAST_MS = 2_500;
/** Consecutive Ctrl+C presses inside this window escalate: 1st clears the
    prompt, 2nd opens the close menu, 3rd (in the menu) quits. */
export const CTRL_C_WINDOW_MS = 800;

export const TOAST_COLOR: Record<ToastTone, string> = {
  info: COLOR.accent,
  warn: COLOR.warn,
  danger: COLOR.danger,
};
/** Margin kept between a toast and the chat pane's own border. */
export const TOAST_INSET = 1;
/** Padding top + content row + padding bottom, plus a blank row between stacked toasts. */
export const TOAST_STEP = 4;
