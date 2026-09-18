import type { ReactNode } from "react";
import { useTerminalDimensions } from "@opentui/react";

import { COLOR, SURFACE, truncate } from "../theme.js";
import { isTerminalTooSmall, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "../model/display.js";

/**
 * btop-style viewport guard: while the terminal is narrower than
 * `MIN_TERMINAL_WIDTH` or shorter than `MIN_TERMINAL_HEIGHT`, the app is
 * hidden behind a resize notice instead of rendering a broken layout.
 *
 * The dimensions come from `useTerminalDimensions`, so both directions
 * flip live on resize — pty resizes arrive as SIGWINCH whether local,
 * under tmux, or over SSH, so nothing here is transport-specific. The
 * wrapped tree stays mounted (subscriptions keep streaming), so growing
 * back resumes instantly with live data; keypresses still reach the app
 * while gated (`useKeyboard` has no capture phase), which is accepted
 * rather than tearing down and rebuilding session state on every flicker.
 */
export function MinSizeGate({ children }: { children: ReactNode }) {
  const { width, height } = useTerminalDimensions();
  if (!isTerminalTooSmall(width, height)) return <>{children}</>;

  const inner = Math.max(0, width - 4);
  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: SURFACE.base,
      }}
    >
      <text fg={COLOR.warn}>{truncate("Terminal too small", inner)}</text>
      <box style={{ height: 1, flexShrink: 0 }} />
      <text fg={COLOR.dim}>
        {truncate(`This terminal is ${width} × ${height} — t3code needs at least`, inner)}
      </text>
      <text fg={COLOR.text}>{truncate(`${MIN_TERMINAL_WIDTH} × ${MIN_TERMINAL_HEIGHT}.`, inner)}</text>
      <box style={{ height: 1, flexShrink: 0 }} />
      <text fg={COLOR.dim}>{truncate("Resize the terminal to continue.", inner)}</text>
    </box>
  );
}
