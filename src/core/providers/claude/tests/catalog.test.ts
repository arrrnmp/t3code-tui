import { describe, expect, it } from "vitest";

import { claudeCatalogModels, parseClaudeManifest } from "../catalog.js";

describe("parseClaudeManifest", () => {
  it("parses the pinned manifest's claudeAgent models with efforts", () => {
    const models = claudeCatalogModels();
    expect(models.length).toBeGreaterThan(0);
    const slugs = models.map((model) => model.slug);
    expect(slugs).toContain("claude-opus-4-6");
    const opus = models.find((model) => model.slug === "claude-opus-4-6");
    const effort = opus?.efforts.find((descriptor) => descriptor.id === "effort");
    expect(effort?.choices.map((choice) => choice.id)).toEqual(
      expect.arrayContaining(["low", "medium", "high", "max"]),
    );
    expect(opus?.efforts.map((descriptor) => descriptor.id)).not.toContain("fastMode");
    expect(models.find((model) => model.slug === "claude-fable-5-1")?.isDefault).toBe(true);
  });

  it("degrades unknown shapes to fewer models, never a throw", () => {
    expect(parseClaudeManifest(null)).toEqual([]);
    expect(parseClaudeManifest({})).toEqual([]);
    expect(parseClaudeManifest({ providers: { claudeAgent: { models: [{ slug: "", name: "" }] } } })).toEqual([]);
    expect(
      parseClaudeManifest({
        providers: {
          claudeAgent: {
            profiles: { p: { capabilities: { optionDescriptors: [{ id: "flag", label: "Flag", type: "boolean" }] } } },
            models: [{ slug: "m", name: "M", profile: "p" }],
          },
        },
      }),
    ).toEqual([{ slug: "m", name: "M", isDefault: null, efforts: [] }]);
  });
});
