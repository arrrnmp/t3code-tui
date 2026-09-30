/** @jsxImportSource react */
/**
 * Browser stand-in for `@opentui/react`: the hooks the components call, and
 * `Terminal`, the root that establishes the character grid they lay out on.
 */
import { createContext, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export interface TerminalSize {
  width: number;
  height: number;
}

const TerminalContext = createContext<TerminalSize>({ width: 120, height: 36 });

/**
 * The root every Moxen TUI screen renders inside: a `width`×`height` grid of
 * monospace cells on the base surface. Components size themselves in cells
 * from props (`width`, `screenWidth`, ...) — keep those in step with the
 * Terminal's own size.
 */
export function Terminal({
  width = 120,
  height = 36,
  background = "var(--mx-surface-base)",
  children,
  style,
}: {
  /** Columns. */
  width?: number;
  /** Rows. */
  height?: number;
  /** Fill behind the grid; defaults to `SURFACE.base`. */
  background?: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <TerminalContext.Provider value={{ width, height }}>
      <div
        className="mx-term"
        style={{
          width: `calc(${width} * var(--mx-cw))`,
          height: `calc(${height} * var(--mx-lh))`,
          background,
          ...style,
        }}
      >
        {children}
      </div>
    </TerminalContext.Provider>
  );
}

export function useTerminalDimensions(): TerminalSize {
  return useContext(TerminalContext);
}

/* ---- keyboard ---- */

export interface ShimKeyEvent {
  name: string;
  sequence: string;
  raw: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  number: boolean;
  eventType: "press";
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

const KEY_NAMES: Record<string, string> = {
  Enter: "return",
  Escape: "escape",
  Backspace: "backspace",
  Delete: "delete",
  Tab: "tab",
  " ": "space",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  PageUp: "pageup",
  PageDown: "pagedown",
  Home: "home",
  End: "end",
};

export function toKeyEvent(e: KeyboardEvent): ShimKeyEvent {
  const name = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  const ev: ShimKeyEvent = {
    name,
    sequence: e.key.length === 1 ? e.key : "",
    raw: e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    option: e.altKey,
    number: /^[0-9]$/.test(e.key),
    eventType: "press",
    defaultPrevented: false,
    preventDefault() {
      ev.defaultPrevented = true;
      e.preventDefault();
    },
    stopPropagation() {
      e.stopPropagation();
    },
  };
  return ev;
}

export function useKeyboard(handler: (key: ShimKeyEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => ref.current(toKeyEvent(e));
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
}

/* ---- renderer ---- */

const postProcess = new Set<() => void>();
let rafPending = false;
function schedulePostProcess() {
  if (rafPending || typeof requestAnimationFrame === "undefined") return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    postProcess.forEach((fn) => fn());
  });
}
if (typeof document !== "undefined") {
  document.addEventListener("input", schedulePostProcess, true);
  document.addEventListener("scroll", schedulePostProcess, true);
}

const noop = () => {};
const renderer = new Proxy(
  {
    addPostProcessFn(fn: () => void) {
      postProcess.add(fn);
      schedulePostProcess();
    },
    removePostProcessFn(fn: () => void) {
      postProcess.delete(fn);
    },
    requestRender: schedulePostProcess,
    on: noop,
    off: noop,
    once: noop,
    width: 120,
    height: 36,
    console: { show: noop, hide: noop, toggle: noop },
  } as Record<string | symbol, unknown>,
  { get: (target, key) => (key in target ? target[key] : noop) },
);

export function useRenderer(): any {
  return renderer;
}

export function useSelectionHandler(_handler: unknown): void {}
export function useOnResize(_handler: unknown): void {}
export function useTimeline(): any {
  return { add: noop, play: noop, pause: noop };
}
