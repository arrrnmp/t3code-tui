import { describe, expect, it } from "vitest";

import { buildMonitoringGrid, driftersForFrame, fieldDrifters } from "./backdrop.js";

describe("monitoring backdrop", () => {
  it("builds a grid of the requested size with dots only on the lattice", () => {
    const rows = buildMonitoringGrid(16, 8);
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row).toHaveLength(16);
    expect(rows[0]?.[0]).toBe("·");
    expect(rows[0]?.[1]).toBe(" ");
    expect(rows[1]?.[0]).toBe(" ");
  });

  it("keeps drifters in bounds and deterministic per frame", () => {
    const first = driftersForFrame(40, 20, 7);
    const second = driftersForFrame(40, 20, 7);
    expect(first).toEqual(second);
    for (const dot of first) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThan(40);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThan(20);
    }
  });

  it("phases the lattice onto a shared origin via offsets", () => {
    // A pane starting at terminal column 1 insets its grid so dots land on
    // the same global columns as a pane starting at 0 with offset 0.
    const root = buildMonitoringGrid(16, 4);
    const inset = buildMonitoringGrid(16, 4, 1, 1);
    expect(root[0]?.[0]).toBe("·");
    expect(root[0]?.[8]).toBe("·");
    // Inset pane: local (7, 3) maps to global (8, 4) — same lattice.
    // (Local row 0 is blank by design: offset rows start dots at row 3.)
    expect(inset[3]?.[7]).toBe("·");
    expect(inset[3]?.[0]).toBe(" ");
    expect(inset[0]?.[7]).toBe(" ");
  });

  it("shares one swarm across panes via a common field", () => {
    // Two windows onto a 100-wide field at frame 11: union the dots each
    // side sees and compare against the raw field — nothing lost, nothing
    // doubled, and a dot near the boundary keeps one identity.
    const field = fieldDrifters(100, 20, 11, 14, 0);
    const left = field.filter((dot) => dot.x < 40).map((dot) => ({ ...dot }));
    const right = field.filter((dot) => dot.x >= 40).map((dot) => ({ ...dot, x: dot.x - 40 }));
    expect(left.length + right.length).toBe(field.length);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    const nearBoundary = field.filter((dot) => dot.x >= 38 && dot.x < 42);
    for (const dot of nearBoundary) {
      const seen = dot.x < 40 ? left : right;
      expect(seen.some((row) => row.glyph === dot.glyph)).toBe(true);
    }
  });

  it("decorrelates drifter streams between panes via salt", () => {
    const plain = driftersForFrame(40, 20, 7);
    const salted = driftersForFrame(40, 20, 7, 7919);
    expect(plain).not.toEqual(salted);
    for (const dot of salted) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThan(40);
    }
  });

  it("returns nothing for empty panes", () => {
    expect(driftersForFrame(0, 0, 0)).toEqual([]);
    expect(buildMonitoringGrid(0, 0)).toEqual([]);
  });
});
