import { useEffect, useState } from "react";

/**
 * Shared animation clock: returns wall-clock ms, re-rendering every `ms`
 * while `active`. Idle cost is zero (no interval when inactive) — callers
 * gate on exactly the condition that needs motion (running turn, visible
 * pill, mounted backdrop, ...) so a quiet screen never re-renders.
 */
export function useAnimTick(active: boolean, ms: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setTick(Date.now());
    const timer = setInterval(() => setTick(Date.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return tick;
}
