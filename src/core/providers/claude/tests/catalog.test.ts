import { describe, expect, it } from "vitest";

import { claudeCatalogModels, parseClaudeModels } from "../catalog.js";

describe("parseClaudeModels", () => {
  it("parses the bundled models with their effort choices", () => {
    const models = claudeCatalogModels();
    expect(models.length).toBeGreaterThan(0);
    const slugs = models.map((model) => model.slug);
    expect(slugs).toContain("claude-opus-4-6");
    const opus = models.find((model) => model.slug === "claude-opus-4-6");
    const effort = opus?.efforts.find((descriptor) => descriptor.id === "effort");
    expect(effort?.choices.map((choice) => choice.id)).toEqual(
      expect.arrayContaining(["low", "medium", "high", "max"]),
    );
    expect(effort?.choices.find((choice) => choice.id === "high")?.isDefault).toBe(true);
    expect(models.find((model) => model.slug === "claude-fable-5-1")?.isDefault).toBe(true);
  });

  it("keeps every model the catalog is expected to offer", () => {
    // The Agent SDK lists nothing, so this file is the whole catalog: a
    // model dropped here disappears from the picker silently.
    const slugs = claudeCatalogModels().map((model) => model.slug);
    expect(slugs).toEqual([
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  it("degrades unknown shapes to fewer models, never a throw", () => {
    expect(parseClaudeModels(null)).toEqual([]);
    expect(parseClaudeModels({})).toEqual([]);
    expect(parseClaudeModels({ models: [{ slug: "", name: "" }] })).toEqual([]);
    // An option with no choices is not a pickable knob.
    expect(
      parseClaudeModels({ models: [{ slug: "m", name: "M", options: [{ id: "flag", label: "Flag" }] }] }),
    ).toEqual([{ slug: "m", name: "M", isDefault: null, efforts: [] }]);
  });
});
