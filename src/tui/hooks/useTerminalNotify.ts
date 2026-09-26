import { useCallback, useEffect, useRef } from "react";
import { CliRenderEvents, type CliRenderer } from "@opentui/core";

/**
 * Desktop notifications through the terminal, sent only while its window is
 * not focused — a toast already covers the focused case. OSC 9 is the
 * notification most terminals show (iTerm2, WezTerm, Ghostty, kitty's
 * compatibility mode); the bell rides along for the rest (a taskbar flash on
 * Windows Terminal). `MOXEN_NOTIFY=off` silences it, `bell` sends only the
 * bell. A terminal that never reports focus reads as focused: silence
 * beats a notification for every turn in the window you are looking at.
 */
export function useTerminalNotify(renderer: CliRenderer | null): (title: string, body: string) => void {
  const focused = useRef(true);
  useEffect(() => {
    if (renderer === null) return;
    const onFocus = (): void => {
      focused.current = true;
    };
    const onBlur = (): void => {
      focused.current = false;
    };
    renderer.on(CliRenderEvents.FOCUS, onFocus);
    renderer.on(CliRenderEvents.BLUR, onBlur);
    return () => {
      renderer.off(CliRenderEvents.FOCUS, onFocus);
      renderer.off(CliRenderEvents.BLUR, onBlur);
    };
  }, [renderer]);

  return useCallback(
    (title: string, body: string) => {
      if (focused.current || renderer === null) return;
      const mode = (process.env.MOXEN_NOTIFY ?? "desktop").trim().toLowerCase();
      if (mode === "off") return;
      // Control characters would end the sequence early (or smuggle one in).
      const clean = (value: string): string => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
      const sequence = mode === "bell" ? "\x07" : `\x1b]9;${clean(title)}: ${clean(body)}\x07\x07`;
      // Through the renderer's own writer when it has one, so the bytes never
      // land in the middle of a frame it is flushing.
      const writer = (renderer as unknown as { writeOut?: (chunk: string) => void }).writeOut;
      if (typeof writer === "function") writer.call(renderer, sequence);
      else process.stdout.write(sequence);
    },
    [renderer],
  );
}
