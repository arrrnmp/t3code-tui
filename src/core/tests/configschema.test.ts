import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, setConfigValue, normalizeConfig, CONFIG_KEYS } from "../config.js";
import {
  SETTINGS,
  describeSettings,
  parseSettingValue,
  readSetting,
  settingDescriptor,
  writeSetting,
} from "../configschema.js";

describe("settings schema", () => {
  it("is the single source of settable keys", () => {
    // The CLI validates `config set` against this list and the TUI renders
    // a control per entry, so a key missing here is a key neither surface has.
    expect(CONFIG_KEYS).toEqual(SETTINGS.map((descriptor) => descriptor.key));
    expect(new Set(CONFIG_KEYS).size).toBe(CONFIG_KEYS.length);
  });

  it("keeps every key the config file used to accept", () => {
    for (const key of ["projectPolicy", "workspaceMode", "openMode", "threadEnvMode", "runtimeMode", "interactionMode", "provider", "model", "speedMode", "thinkingEffort", "sessionTtl", "instructions", "autoContinueAtUsageLimit"]) {
      expect(settingDescriptor(key), key).toBeDefined();
    }
  });

  it("reads a default through for an unset key, and the pinned value once set", () => {
    expect(readSetting(DEFAULT_CONFIG, "git.historyLimit")).toBe(50);
    const next = setConfigValue(DEFAULT_CONFIG, "git.historyLimit", "120");
    expect(readSetting(next, "git.historyLimit")).toBe(120);
    expect(next.git?.historyLimit).toBe(120);
  });

  it("creates intermediate objects for a dotted key without disturbing siblings", () => {
    const withPath = setConfigValue(DEFAULT_CONFIG, "providers.claude.binaryPath", "/opt/claude");
    const withBoth = setConfigValue(withPath, "providers.claude.promptSuggestions", "false");
    expect(withBoth.providers?.claude).toEqual({ binaryPath: "/opt/claude", promptSuggestions: false });
  });

  it("rejects a bad value with the allowed set rather than writing it", () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, "ui.backdrop", "sparkly")).toThrow(
      "ui.backdrop must be one of: animated, static, off.",
    );
    expect(() => setConfigValue(DEFAULT_CONFIG, "git.historyLimit", "9")).toThrow(
      "git.historyLimit must be a whole number between 10 and 1000.",
    );
    expect(() => setConfigValue(DEFAULT_CONFIG, "forge.enabled", "yes")).toThrow("forge.enabled must be true or false.");
    expect(() => setConfigValue(DEFAULT_CONFIG, "sessionTtl", "soon")).toThrow(
      "sessionTtl must be a duration such as 45s, 2m or 1h.",
    );
  });

  it("offers only presets the key itself would accept, its default among them", () => {
    for (const descriptor of SETTINGS) {
      const kind = descriptor.kind;
      if ((kind.type !== "integer" && kind.type !== "duration") || kind.presets === undefined) continue;
      for (const preset of kind.presets) expect(parseSettingValue(descriptor, String(preset))).toBe(preset);
      expect(kind.presets as readonly unknown[]).toContain(descriptor.defaultValue);
    }
  });

  it("clears an optional enum set to nothing, but refuses nothing for one with a default", () => {
    expect(setConfigValue({ ...DEFAULT_CONFIG, speedMode: "fast" }, "speedMode", "").speedMode).toBeUndefined();
    expect(() => parseSettingValue(settingDescriptor("ui.backdrop")!, "")).toThrow(/must be one of/);
  });

  it("refuses a key it does not know", () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, "git.historyLimitt", "20")).toThrow("Unknown config key");
  });

  it("clears a key set back to empty, rather than pinning the empty string", () => {
    const pinned = setConfigValue(DEFAULT_CONFIG, "model", "opus");
    expect(setConfigValue(pinned, "model", "").model).toBeUndefined();
    // A key whose default *is* empty keeps it: "" means "inherit the CLI's own".
    expect(setConfigValue(DEFAULT_CONFIG, "providers.claude.homePath", "").providers?.claude?.homePath).toBe("");
  });

  it("round-trips a nested section through the file normalizer", () => {
    const written = setConfigValue(setConfigValue(DEFAULT_CONFIG, "forge.ghPath", "/usr/bin/gh"), "ui.backdrop", "off");
    const reloaded = normalizeConfig(JSON.parse(JSON.stringify(written)));
    expect(reloaded.forge?.ghPath).toBe("/usr/bin/gh");
    expect(reloaded.ui?.backdrop).toBe("off");
  });

  it("drops a section field a newer build wrote, instead of failing the load", () => {
    const reloaded = normalizeConfig({ ...DEFAULT_CONFIG, git: { historyLimit: 30, somethingNew: true } });
    expect(reloaded.git).toEqual({ historyLimit: 30 });
  });

  it("rejects a section that is not an object", () => {
    expect(() => normalizeConfig({ ...DEFAULT_CONFIG, ui: "off" })).toThrow("ui must be a JSON object.");
  });

  it("type-checks a value that arrives already typed from the file", () => {
    expect(() => normalizeConfig({ ...DEFAULT_CONFIG, git: { autoFetch: 1 } })).toThrow(
      "git.autoFetch must be true or false.",
    );
    expect(() => normalizeConfig({ ...DEFAULT_CONFIG, git: { historyLimit: 20.5 } })).toThrow(
      "git.historyLimit must be a whole number.",
    );
  });

  it("marks which values the file pins and which fall back", () => {
    const views = describeSettings(setConfigValue(DEFAULT_CONFIG, "ui.backdrop", "static"));
    const backdrop = views.find((view) => view.descriptor.key === "ui.backdrop");
    const refresh = views.find((view) => view.descriptor.key === "ui.contextRefreshSeconds");
    expect(backdrop).toMatchObject({ value: "static", explicit: true });
    expect(refresh).toMatchObject({ value: 5, explicit: false });
  });

  it("gives every descriptor a label and a description", () => {
    for (const descriptor of SETTINGS) {
      expect(descriptor.label.length, descriptor.key).toBeGreaterThan(0);
      expect(descriptor.description.length, descriptor.key).toBeGreaterThan(0);
    }
  });

  it("parses each kind on its own", () => {
    expect(parseSettingValue({ ...SETTINGS[0]!, kind: { type: "string" } }, "  spaced  ")).toBe("spaced");
    expect(writeSetting(DEFAULT_CONFIG, "forge.enabled", false).forge?.enabled).toBe(false);
  });
});
