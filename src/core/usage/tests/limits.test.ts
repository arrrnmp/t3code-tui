import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { persistUsageLimits, recordUsageWindows, resetUsageLimitsForTests, usageLimitsSnapshot } from "../limits.js";

const NOW = Date.parse("2026-09-25T10:00:00.000Z");
const IN_2H = new Date(NOW + 2 * 3_600_000).toISOString();

afterEach(() => resetUsageLimitsForTests());

describe("usage limits registry", () => {
  it("keeps the probe's windows and refreshes one from a live event", () => {
    recordUsageWindows(
      "claude",
      [
        { id: "session", label: "Session", resetsAt: IN_2H, exhausted: false, usedPercent: 40 },
        { id: "weekly", label: "Weekly", resetsAt: IN_2H, exhausted: false, usedPercent: 12 },
      ],
      NOW,
    );
    recordUsageWindows("claude", [{ id: "session", label: "Session", resetsAt: IN_2H, exhausted: false, usedPercent: 55 }], NOW);
    const claude = usageLimitsSnapshot(NOW).claude!;
    expect(claude.windows.map((window) => [window.id, window.kind, window.usedPercent])).toEqual([
      ["session", "session", 55],
      ["weekly", "weekly", 12],
    ]);
  });

  it("keeps the last percentage when an event carries none, and reads an exhausted window as full", () => {
    recordUsageWindows("claude", [{ id: "session", label: "Session", resetsAt: IN_2H, exhausted: false, usedPercent: 30 }], NOW);
    recordUsageWindows("claude", [{ id: "session", label: "Session", resetsAt: IN_2H, exhausted: false, usedPercent: null }], NOW);
    expect(usageLimitsSnapshot(NOW).claude!.windows[0]!.usedPercent).toBe(30);
    recordUsageWindows("codex", [{ id: "primary", label: "Session", resetsAt: IN_2H, exhausted: true }], NOW);
    expect(usageLimitsSnapshot(NOW).codex!.windows[0]).toMatchObject({ kind: "session", usedPercent: 100 });
  });

  it("leaves out a window it has never seen a percentage for", () => {
    recordUsageWindows("grok", [{ id: "subscription", label: "Monthly", resetsAt: null, exhausted: false }], NOW);
    expect(usageLimitsSnapshot(NOW).grok).toBeUndefined();
  });

  it("reads a window whose reset has passed as empty", () => {
    recordUsageWindows("claude", [{ id: "session", label: "Session", resetsAt: IN_2H, exhausted: true, usedPercent: 100 }], NOW);
    const later = usageLimitsSnapshot(NOW + 3 * 3_600_000).claude!.windows[0]!;
    expect(later).toMatchObject({ usedPercent: 0, resetsAt: null });
  });

  it("persists next to the store and loads it in a fresh registry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "moxen-usage-"));
    persistUsageLimits(root);
    recordUsageWindows("claude", [{ id: "weekly", label: "Weekly – Opus", resetsAt: IN_2H, exhausted: false, usedPercent: 71 }], NOW);
    return new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
      resetUsageLimitsForTests();
      persistUsageLimits(root);
      expect(usageLimitsSnapshot(NOW).claude!.windows[0]).toMatchObject({ label: "Weekly – Opus", kind: "weekly", usedPercent: 71 });
      fs.rmSync(root, { recursive: true, force: true });
    });
  });
});
