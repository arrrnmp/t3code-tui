import { describe, expect, it } from "vitest";

import type { ProviderSummary } from "../../../cli/catalog/catalog.js";
import { displayEffort, displayModelName, isTerminalTooSmall, prettifyModelSlug } from "../display.js";

function providers(): ProviderSummary[] {
  return [
    {
      instanceId: "opencode",
      driver: "opencode",
      displayName: "OpenCode Zen",
      enabled: true,
      installed: true,
      status: null,
      authStatus: null,
      models: [
        {
          slug: "opencode/muse-spark-1.3-contributor-free",
          name: "Muse Spark 1.3 Free",
          isCustom: false,
          isDefault: true,
          isHidden: false,
          efforts: [
            {
              id: "effort",
              label: "Effort",
              choices: [
                { id: "low", label: "Low", isDefault: false },
                { id: "xhigh", label: "xhigh", isDefault: true },
              ],
              currentValue: "xhigh",
            },
          ],
        },
      ],
      usageLimits: null,
      supportedRuntimeModes: null,
      skills: [],
    },
    {
      instanceId: "claudeAgent",
      driver: "claude",
      displayName: "Claude",
      enabled: true,
      installed: true,
      status: null,
      authStatus: null,
      models: [
        {
          slug: "claude-opus-5",
          name: "Claude Opus 5",
          isCustom: false,
          isDefault: null,
          isHidden: false,
          efforts: [
            {
              id: "effort",
              label: "Reasoning",
              // Claude's driver never populates `currentValue`; only the
              // per-choice `isDefault` flag says what the default is.
              choices: [
                { id: "low", label: "Low", isDefault: null },
                { id: "high", label: "High", isDefault: true },
              ],
              currentValue: null,
            },
          ],
        },
      ],
      usageLimits: null,
      supportedRuntimeModes: null,
      skills: [],
    },
  ];
}

describe("displayModelName", () => {
  it("prefers the catalog name over the raw slug", () => {
    expect(
      displayModelName(providers(), {
        instanceId: "opencode",
        model: "opencode/muse-spark-1.3-contributor-free",
      }),
    ).toBe("Muse Spark 1.3 Free");
  });

  it("prettifies the slug while the catalog is still loading", () => {
    expect(
      displayModelName(null, {
        instanceId: "opencode",
        model: "opencode/muse-spark-1.3-contributor-free",
      }),
    ).toBe("Muse Spark 1.3 Contributor Free");
  });

  it("renders a dash without a selection", () => {
    expect(displayModelName(providers(), undefined)).toBe("-");
  });
});

describe("prettifyModelSlug", () => {
  it("keeps version tokens intact", () => {
    expect(prettifyModelSlug("claude-opus-5")).toBe("Claude Opus 5");
  });
});

describe("displayEffort", () => {
  it("resolves the effort choice label", () => {
    expect(
      displayEffort(providers(), {
        instanceId: "opencode",
        model: "opencode/muse-spark-1.3-contributor-free",
        options: [{ id: "effort", value: "xhigh" }],
      }),
    ).toBe("xhigh");
  });

  it("falls back to the raw value without a catalog", () => {
    expect(
      displayEffort(null, {
        instanceId: "opencode",
        model: "opencode/muse-spark-1.3-contributor-free",
        options: [{ id: "effort", value: "xhigh" }],
      }),
    ).toBe("xhigh");
  });

  it("falls back to the model's default effort without an explicit choice", () => {
    expect(
      displayEffort(providers(), { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" }),
    ).toBe("xhigh");
  });

  it("returns null for a model with no effort descriptors and no options", () => {
    const noEffortProviders: ProviderSummary[] = [
      {
        ...providers()[0]!,
        models: [{ ...providers()[0]!.models[0]!, efforts: [] }],
      },
    ];
    expect(
      displayEffort(noEffortProviders, { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" }),
    ).toBeNull();
  });

  it("falls back to the isDefault choice when currentValue is null (Claude's driver)", () => {
    expect(displayEffort(providers(), { instanceId: "claudeAgent", model: "claude-opus-5" })).toBe("High");
  });
});

describe("isTerminalTooSmall", () => {
  it.each([
    [90, 20, false],
    [140, 26, false],
    [200, 60, false],
    [89, 20, true],
    [90, 19, true],
    [80, 24, true],
    [0, 0, true],
  ])("maps %ix%i to too-small=%s", (width, height, expected) => {
    expect(isTerminalTooSmall(width, height)).toBe(expected);
  });
});
