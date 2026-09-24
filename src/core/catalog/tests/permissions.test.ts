import { describe, expect, it } from "vitest";

import {
  compatibleRuntimeMode,
  displayRuntimeMode,
  RUNTIME_MODE_CHOICES,
  runtimeModeChoicesForSupportedModes,
} from "../permissions.js";

describe("runtimeModeChoicesForSupportedModes", () => {
  it("offers every known mode when the provider states nothing", () => {
    for (const unsupported of [null, undefined, []] as const) {
      expect(runtimeModeChoicesForSupportedModes(unsupported).map((choice) => choice.mode)).toEqual([
        "approval-required",
        "auto-accept-edits",
        "auto",
        "full-access",
      ]);
    }
  });

  it("filters to the provider subset in canonical order", () => {
    // Provider order must not leak through: full-access first server-side
    // still presents supervised-first.
    expect(
      runtimeModeChoicesForSupportedModes(["full-access", "approval-required"]).map((choice) => choice.mode),
    ).toEqual(["approval-required", "full-access"]);
  });

  it("labels match the desktop wording", () => {
    expect(RUNTIME_MODE_CHOICES.map((choice) => choice.label)).toEqual([
      "Supervised",
      "Auto-accept edits",
      "Auto",
      "Full access",
    ]);
  });
});

describe("compatibleRuntimeMode", () => {
  it("keeps the current mode while offered", () => {
    const choices = runtimeModeChoicesForSupportedModes(["approval-required", "full-access"]);
    expect(compatibleRuntimeMode("full-access", choices)).toBe("full-access");
  });

  it("falls back to the provider first mode without mutating state", () => {
    const choices = runtimeModeChoicesForSupportedModes(["auto", "full-access"]);
    expect(compatibleRuntimeMode("approval-required", choices)).toBe("auto");
  });

  it("keeps the mode when nothing is offered rather than inventing one", () => {
    expect(compatibleRuntimeMode("auto", [])).toBe("auto");
  });
});

describe("displayRuntimeMode", () => {
  it("prettifies known modes and passes unknown strings through", () => {
    expect(displayRuntimeMode("full-access")).toBe("Full access");
    expect(displayRuntimeMode("mystery-mode")).toBe("mystery-mode");
  });
});
