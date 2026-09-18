import { useMemo } from "react";

import { useAnimTick } from "./hooks/useAnimTick.js";
import { COLOR, SURFACE } from "./theme.js";

/**
 * Faint monitoring-room texture for the empty `creating` view: a static
 * grid etched in border color plus a handful of slow-drifting status dots
 * in faint — control-plane telemetry, not starfield fantasy. Two layers so
 * the grid stays nearly invisible while the dots read by shape, all inside
 * the quiet zinc palette (no caynac greens/reds).
 *
 * Pure frame builder is exported for tests; the component owns its 150ms
 * tick and unmounts (zero cost) outside the creating view.
 */

const GRID_X = 8;
const GRID_Y = 4;
/** Per-pane drifter count (legacy mode: the field is the pane itself). */
const DRIFTERS = 8;
/** Shared-field drifter count — same dot density spread over a terminal. */
const FIELD_DRIFTERS = 14;
const TICK_MS = 150;

export interface Drifter {
  x: number;
  y: number;
  glyph: string;
}

function seed(n: number): number {
  let h = n * 2654435761;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  return h / 4294967296;
}

/**
 * Static grid rows: `·` wherever the *terminal* cell lands on the lattice.
 * `offsetX/Y` is the backdrop's own origin in terminal cells, so two panes
 * (sidebar, creating view) render subsets of one continuous grid instead of
 * two clashing lattices.
 */
export function buildMonitoringGrid(width: number, height: number, offsetX = 0, offsetY = 0): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      row += (x + offsetX) % GRID_X === 0 && (y + offsetY) % GRID_Y === 0 ? "·" : " ";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Drifters over an arbitrary field rect, deterministic in `frame` so tests
 * pin them. Coordinates are in field space; callers sharing one field (same
 * size, salt, and frame clock) render windows onto a single continuous
 * swarm — a dot crossing a pane boundary keeps its speed, glyph, and blink.
 */
export function fieldDrifters(
  fieldWidth: number,
  fieldHeight: number,
  frame: number,
  count: number,
  salt = 0,
): Drifter[] {
  if (fieldWidth <= 0 || fieldHeight <= 0 || count <= 0) return [];
  const out: Drifter[] = [];
  for (let i = 0; i < count; i++) {
    const sx = seed(i * 2 + 1 + salt);
    const sy = seed(i * 2 + 2 + salt);
    const speed = 1 + (i % 2);
    const x = Math.floor(sx * fieldWidth + frame * speed) % fieldWidth;
    const y = Math.floor(sy * fieldHeight) % fieldHeight;
    // Blink: each dot drops out one frame in four — alive, not noisy.
    if ((frame + i) % 4 === 3) continue;
    out.push({ x, y, glyph: i % 3 === 0 ? "+" : "•" });
  }
  return out;
}

/**
 * Slow drifters roaming this pane alone (legacy mode). `salt`
 * decorrelates panes sharing a screen so their drifters don't mirror.
 */
export function driftersForFrame(width: number, height: number, frame: number, salt = 0): Drifter[] {
  return fieldDrifters(width, height, frame, DRIFTERS, salt);
}

export function MonitoringBackdrop({
  width,
  height,
  left = 0,
  top = 0,
  opacity = 0.55,
  offsetX = 0,
  offsetY = 0,
  seedSalt = 0,
  fieldWidth,
  fieldHeight,
}: {
  width: number;
  height: number;
  /** Placement inside the parent — absolute offsets are content-box
      relative, so inside a bordered pane left/top 0 already means "just
      inside the border", not "over it" (measured, not assumed). */
  left?: number;
  top?: number;
  /** Sidebar runs dimmer than the empty creating view. */
  opacity?: number;
  /**
   * This backdrop's origin in terminal cells (pane position + inset):
   * keeps every pane's lattice on the same global grid. Raw values — the
   * builder mods them.
   */
  offsetX?: number;
  offsetY?: number;
  seedSalt?: number;
  /**
   * Shared drifter field in terminal cells (size of the whole screen).
   * Every pane passing the same field renders its own window onto one
   * continuous swarm: dots drift across pane borders instead of each pane
   * running a mirrored private set. Omitted, drifters roam this pane
   * alone (legacy mode).
   */
  fieldWidth?: number;
  fieldHeight?: number;
}) {
  const tick = useAnimTick(true, TICK_MS);
  const frame = Math.floor(tick / TICK_MS);
  const grid = useMemo(() => buildMonitoringGrid(width, height, offsetX, offsetY), [width, height, offsetX, offsetY]);
  const drifters = useMemo(() => {
    if (fieldWidth === undefined || fieldHeight === undefined) {
      return driftersForFrame(width, height, frame, seedSalt);
    }
    // One swarm per screen: filter to this window, then shift to local.
    // Same field + same frame ⇒ same dots on both sides of a border.
    return fieldDrifters(fieldWidth, fieldHeight, frame, FIELD_DRIFTERS, seedSalt)
      .filter((dot) => dot.x >= offsetX && dot.x < offsetX + width && dot.y >= offsetY && dot.y < offsetY + height)
      .map((dot) => ({ ...dot, x: dot.x - offsetX, y: dot.y - offsetY }));
  }, [width, height, frame, seedSalt, fieldWidth, fieldHeight, offsetX, offsetY]);

  if (width <= 0 || height <= 0) return null;
  return (
    <box
      style={{ position: "absolute", left, top, width, height, flexDirection: "column" }}
      opacity={opacity}
      selectable={false}
    >
      {grid.map((row, y) => (
        <box key={y} style={{ height: 1, flexShrink: 0 }} selectable={false}>
          <text fg={SURFACE.border} selectable={false}>
            {row.padEnd(width)}
          </text>
        </box>
      ))}
      {drifters.map((dot, i) => (
        <box key={i} style={{ position: "absolute", left: dot.x, top: dot.y, width: 1, height: 1 }} selectable={false}>
          <text fg={COLOR.faint} selectable={false}>
            {dot.glyph}
          </text>
        </box>
      ))}
    </box>
  );
}
