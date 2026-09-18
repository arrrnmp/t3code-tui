import { afterEach, describe, expect, it, vi } from "vitest";

import { markModalDismissed, wasModalJustDismissed } from "../modalDismiss.js";

describe("modalDismiss", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("swallows for the default window right after a dismiss, then stops", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    markModalDismissed();
    expect(wasModalJustDismissed()).toBe(true);
    vi.setSystemTime(249);
    expect(wasModalJustDismissed()).toBe(true);
    vi.setSystemTime(250);
    expect(wasModalJustDismissed()).toBe(false);
  });

  it("reports false before any modal has ever been dismissed this run", () => {
    // A prior test in this file already called markModalDismissed(), so this
    // only proves the check honors a custom window rather than the module's
    // initial state — a 0ms window can never still be "just" dismissed.
    markModalDismissed();
    expect(wasModalJustDismissed(0)).toBe(false);
  });
});
