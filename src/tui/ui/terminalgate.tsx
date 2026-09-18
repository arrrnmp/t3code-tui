import type { ReactNode } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { COLOR, SURFACE, truncate } from "../theme.js";
import { isTerminalTooSmall, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "../model/display.js";

/**
 * btop-style viewport guard: while the terminal is narrower than
 * `MIN_TERMINAL_WIDTH` or shorter than `MIN_TERMINAL_HEIGHT`, an opaque
 * notice covers the app instead of a broken layout.
 *
 * The dimensions come from `useTerminalDimensions`, so both directions
 * flip live on resize — pty resizes arrive as SIGWINCH whether local,
 * under tmux, or over SSH, so nothing here is transport-specific. The
 * wrapped tree stays mounted underneath (subscriptions keep streaming and
 * drafts survive), so growing back resumes instantly; the overlay swallows
 * mouse events, and Ctrl+C quits straight out (`useKeyboard` has no
 * capture phase, so the app still sees other keys while gated — accepted
 * rather than tearing down session state on every flicker).
 */
export function MinSizeGate({ children, onQuit }: { children: ReactNode; onQuit: () => void }) {
  const { width, height } = useTerminalDimensions();
  const gated = isTerminalTooSmall(width, height);
  useKeyboard((key) => {
    // Same chord as the app's own quit flow; while gated there is no
    // visible menu to escalate through, so the first press quits.
    if (gated && key.name === "c" && key.ctrl === true) onQuit();
  });
  if (!gated) return <>{children}</>;

  const inner = Math.max(0, width - 4);
  return (
    <>
      {children}
      <box
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: SURFACE.base,
          zIndex: 50,
        }}
        selectable={false}
        onMouseDown={() => {}}
      >
        <text fg={COLOR.warn} selectable={false}>
          {truncate("Terminal too small", inner)}
        </text>
        <box style={{ height: 1, flexShrink: 0 }} />
        <text fg={COLOR.dim} selectable={false}>
          {truncate(`This terminal is ${width} × ${height} — t3code needs at least`, inner)}
        </text>
        <text fg={COLOR.text} selectable={false}>
          {truncate(`${MIN_TERMINAL_WIDTH} × ${MIN_TERMINAL_HEIGHT}.`, inner)}
        </text>
        <box style={{ height: 1, flexShrink: 0 }} />
        <text fg={COLOR.dim} selectable={false}>
          {truncate("Resize the terminal to continue.", inner)}
        </text>
        <text fg={COLOR.dim} selectable={false}>
          {truncate("Or press Ctrl+C to quit.", inner)}
        </text>
      </box>
    </>
  );
}
