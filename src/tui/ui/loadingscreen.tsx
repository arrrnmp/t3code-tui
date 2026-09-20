import { useState } from "react";

import { useAnimTick } from "../hooks/useAnimTick.js";
import type { BootStage } from "../model/readiness.js";
import { COLOR, pulseColor, SPINNER_FRAMES, SURFACE } from "../theme.js";

/**
 * Full-screen boot gate: shown instead of the app chrome until the shell and
 * initial thread snapshots land (see `isBootReady`). Mounted only while
 * booting, so its 100ms spinner clock costs nothing afterwards. Subscription
 * errors still surface as toasts above it — this screen names the stalled
 * leg, it never swallows failures.
 */

const SLOW_MS = 10_000;

export function LoadingScreen({ stage }: { stage: BootStage }) {
  const [mountedAt] = useState(() => Date.now());
  const tick = useAnimTick(true, 100);
  const frame = SPINNER_FRAMES[Math.floor(tick / 100) % SPINNER_FRAMES.length] ?? "⠋";
  return (
    <box
      style={{ flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center" }}
      backgroundColor={SURFACE.base}
      selectable={false}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} selectable={false}>
        <text fg={pulseColor(tick, COLOR.dim, COLOR.accent, 2400)} bg={SURFACE.base} selectable={false}>
          {` ${frame} Loading ${stage === "threads" ? "threads" : "transcript"}… `}
        </text>
      </box>
      <box style={{ height: 1, flexShrink: 0 }} selectable={false}>
        <text fg={COLOR.faint} bg={SURFACE.base} selectable={false}>
          {"waiting for the T3 Code snapshot"}
        </text>
      </box>
      {tick - mountedAt < SLOW_MS ? null : (
        <box style={{ height: 1, flexShrink: 0 }} selectable={false}>
          <text fg={COLOR.warn} bg={SURFACE.base} selectable={false}>
            {"still waiting — is T3 Code running?"}
          </text>
        </box>
      )}
    </box>
  );
}
