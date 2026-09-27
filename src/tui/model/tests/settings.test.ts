import { describe, expect, it } from "vitest";

import type { ProviderSummary } from "../../../core/catalog/summary.js";
import { describeSettings, settingDescriptor } from "../../../core/configschema.js";
import { DEFAULT_CONFIG } from "../../../core/config.js";
import type { CliConfig } from "../../../core/types.js";
import { settingControl, settingValueLabel } from "../settings.js";

function provider(instanceId: string, models: Array<{ slug: string; name: string; efforts?: string[]; hidden?: boolean }>, enabled = true): ProviderSummary {
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId === "claudeAgent" ? "Claude" : "Codex",
    enabled,
    installed: true,
    status: null,
    authStatus: null,
    models: models.map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: false,
      isDefault: null,
      isHidden: model.hidden === true,
      efforts: model.efforts === undefined ? [] : [{ id: "effort", label: "Effort", currentValue: null, choices: model.efforts.map((id) => ({ id, label: id.toUpperCase(), isDefault: null })) }],
    })),
    supportedRuntimeModes: null,
    usageLimits: null,
    skills: [],
  };
}

const CATALOG = [
  provider("claudeAgent", [
    { slug: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: ["low", "high", "xhigh"] },
    { slug: "claude-old", name: "Old", hidden: true },
  ]),
  provider("codex", [{ slug: "gpt-6", name: "GPT-6", efforts: ["low", "medium"] }]),
  provider("grok", [{ slug: "grok-5", name: "Grok 5" }], false),
];

function control(key: string, config: CliConfig = DEFAULT_CONFIG) {
  const settings = describeSettings(config);
  const view = settings.find((entry) => entry.descriptor.key === key)!;
  return settingControl(view.descriptor, view.value, settings, CATALOG);
}

describe("settingControl", () => {
  it("offers the catalog's enabled providers, and models only from the default provider", () => {
    const providers = control("provider");
    expect(providers.kind === "pick" && providers.options.map((entry) => entry.value)).toEqual(["", "claudeAgent", "codex"]);
    const allModels = control("model");
    expect(allModels.kind === "pick" && allModels.options.map((entry) => entry.value)).toEqual(["", "claude-opus-5-5", "gpt-6"]);
    const claudeModels = control("model", { ...DEFAULT_CONFIG, provider: "claudeAgent" });
    expect(claudeModels.kind === "pick" && claudeModels.options.map((entry) => entry.value)).toEqual(["", "claude-opus-5-5"]);
  });

  it("offers the default model's efforts", () => {
    const efforts = control("thinkingEffort", { ...DEFAULT_CONFIG, provider: "codex", model: "gpt-6" });
    expect(efforts.kind === "pick" && efforts.options.map((entry) => entry.value)).toEqual(["", "low", "medium"]);
  });

  it("keeps a hand-set value it cannot name at the top of the list", () => {
    const models = control("model", { ...DEFAULT_CONFIG, model: "my-custom" });
    expect(models.kind === "pick" && models.options[0]).toMatchObject({ value: "my-custom" });
  });

  it("picks from presets for numbers and durations, and types only what only the user knows", () => {
    const ttl = control("sessionTtl");
    expect(ttl.kind === "pick" && ttl.options.find((entry) => entry.value === "2m")?.label).toBe("2 minutes");
    expect(control("ui.contextRefreshSeconds").kind).toBe("pick");
    expect(control("providers.claude.binaryPath")).toEqual({ kind: "text", multiline: false });
    expect(control("instructions")).toEqual({ kind: "text", multiline: true });
    expect(control("forge.enabled")).toEqual({ kind: "toggle" });
  });

  it("labels values by what they mean", () => {
    const descriptor = settingDescriptor("speedMode")!;
    const pick = control("speedMode");
    expect(settingValueLabel(descriptor, undefined, pick)).toBe("Not set");
    expect(settingValueLabel(descriptor, "fast", pick)).toBe("Fast");
    const model = control("model", { ...DEFAULT_CONFIG, model: "gpt-6" });
    expect(settingValueLabel(settingDescriptor("model")!, "gpt-6", model)).toBe("GPT-6");
  });
});
