/**
 * Thumb geometry for the composer's textarea indicator (the native
 * `<scrollbox>` bar can't wrap a textarea, so the composer draws its own
 * 1-column strip in the same visual language: faint track, accent thumb,
 * hidden entirely unless the draft overflows its visible rows).
 *
 * All inputs are visual rows: `total` is the full wrapped content height,
 * `viewport` the visible rows, `top` the first visible row. The track may
 * be longer than the viewport — the composer strip spans the whole card,
 * not just the textarea — via `trackLen` (defaults to the viewport).
 */
export interface ThumbGeometry {
  /** First track row covered by the thumb. */
  start: number;
  /** Thumb length in track rows (always >= 1). */
  size: number;
}

/** Null while everything fits: no thumb to draw. */
export function thumbGeometry(total: number, viewport: number, top: number, trackLen: number = viewport): ThumbGeometry | null {
  const rows = Math.floor(total);
  const visible = Math.floor(viewport);
  const track = Math.floor(trackLen);
  if (visible <= 0 || track <= 0 || rows <= visible) return null;
  const first = Math.min(Math.max(0, Math.floor(top)), rows - visible);
  const size = Math.max(1, Math.min(track, Math.round((track * visible) / rows)));
  const start = track <= size ? 0 : Math.round(((track - size) * first) / (rows - visible));
  return { start, size };
}
