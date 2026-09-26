import { describe, expect, it } from "vitest";

import { thumbGeometry } from "../scrollbar.js";

describe("thumbGeometry", () => {
  it("hides while everything fits (and on degenerate viewports)", () => {
    expect(thumbGeometry(10, 10, 0)).toBeNull();
    expect(thumbGeometry(5, 10, 0)).toBeNull();
    expect(thumbGeometry(20, 0, 0)).toBeNull();
  });

  it("covers the whole track at the top of barely-overflowing content", () => {
    expect(thumbGeometry(11, 10, 0)).toEqual({ start: 0, size: 9 });
  });

  it("shrinks and rides to the bottom on long drafts", () => {
    const mid = thumbGeometry(30, 10, 10);
    expect(mid).not.toBeNull();
    expect(mid!.size).toBeLessThan(10);
    expect(mid!.start).toBeGreaterThan(0);
    expect(thumbGeometry(30, 10, 20)).toEqual({ start: 10 - mid!.size, size: mid!.size });
  });

  it("clamps a stale scroll offset into range", () => {
    expect(thumbGeometry(30, 10, 99)).toEqual(thumbGeometry(30, 10, 20));
    expect(thumbGeometry(30, 10, -4)).toEqual(thumbGeometry(30, 10, 0));
  });

  it("maps onto a longer track (full-card strip)", () => {
    expect(thumbGeometry(30, 10, 10, 12)).toEqual({ start: 4, size: 4 });
    expect(thumbGeometry(30, 10, 20, 12)).toEqual({ start: 8, size: 4 });
    expect(thumbGeometry(30, 10, 0, 12)).toEqual({ start: 0, size: 4 });
  });
});
