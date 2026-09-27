import type { ProviderSummary } from "../../core/catalog/summary.js";
import type { SettingDescriptor, SettingValue, SettingView } from "../../core/configschema.js";

/**
 * What the settings page offers for a setting, as a list to pick from.
 *
 * The page never asks for typing unless nothing else can supply the value:
 * enums list their choices, integers and durations their presets, and the
 * model defaults the provider catalog (so "Default model" lists the models
 * the default provider actually has). What stays free text is what only the
 * user knows — an executable's path, extra instructions.
 */
export interface SettingOption {
  /** What `settings.set` receives; `""` clears the key back to its default. */
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

/** How a setting is edited on the page. */
export type SettingControl =
  | { readonly kind: "toggle" }
  | { readonly kind: "pick"; readonly options: readonly SettingOption[] }
  | { readonly kind: "text"; readonly multiline: boolean };

const option = (value: string, label: string, description?: string): SettingOption =>
  description === undefined ? { value, label } : { value, label, description };

function durationLabel(value: string): string {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (match === null) return value;
  const count = Number(match[1]);
  const unit = { ms: "millisecond", s: "second", m: "minute", h: "hour" }[match[2] as "ms" | "s" | "m" | "h"];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The value a key holds on the page right now, as `settings.set` would take it. */
function valueOf(settings: readonly SettingView[], key: string): string | undefined {
  const value = settings.find((view) => view.descriptor.key === key)?.value;
  return value === undefined || value === "" ? undefined : String(value);
}

/** The catalog providers worth offering: enabled ones. */
function offered(providers: readonly ProviderSummary[]): readonly ProviderSummary[] {
  return providers.filter((provider) => provider.enabled);
}

function catalogOptions(
  source: "provider" | "model" | "effort",
  settings: readonly SettingView[],
  providers: readonly ProviderSummary[],
): SettingOption[] {
  const available = offered(providers);
  const providerId = valueOf(settings, "provider");
  const scoped = providerId === undefined ? available : available.filter((provider) => provider.instanceId === providerId);
  if (source === "provider") {
    return [
      option("", "Not set", "Each project's own default."),
      ...available.map((provider) => option(provider.instanceId, provider.displayName ?? provider.instanceId, provider.instanceId)),
    ];
  }
  if (source === "model") {
    const out: SettingOption[] = [option("", "Provider's default")];
    const seen = new Set<string>();
    for (const provider of scoped) {
      for (const model of provider.models) {
        if (model.isHidden || seen.has(model.slug)) continue;
        seen.add(model.slug);
        // Across providers the provider name tells two same-named models apart.
        const where = scoped.length > 1 ? `${provider.displayName ?? provider.instanceId} · ` : "";
        out.push(option(model.slug, model.name, `${where}${model.slug}`));
      }
    }
    return out;
  }
  // Effort: the levels the default model takes, or every level the
  // offered models share a name for when no model is pinned.
  const modelSlug = valueOf(settings, "model");
  const out: SettingOption[] = [option("", "Provider's default")];
  const seen = new Set<string>();
  for (const provider of scoped) {
    for (const model of provider.models) {
      if (modelSlug !== undefined && model.slug !== modelSlug) continue;
      for (const descriptor of model.efforts) {
        for (const choice of descriptor.choices) {
          if (seen.has(choice.id)) continue;
          seen.add(choice.id);
          out.push(option(choice.id, choice.label));
        }
      }
    }
  }
  return out;
}

/**
 * How the page edits `descriptor`, given every setting's value (the model
 * list follows the default provider) and the provider catalog. A value the
 * lists do not name (a model pinned by hand, a custom duration) is kept as
 * the first option, so opening the list never hides what is in force.
 */
export function settingControl(
  descriptor: SettingDescriptor,
  value: SettingValue,
  settings: readonly SettingView[],
  providers: readonly ProviderSummary[] | null,
): SettingControl {
  const kind = descriptor.kind;
  let options: SettingOption[];
  switch (kind.type) {
    case "boolean":
      return { kind: "toggle" };
    case "enum":
      options = [
        ...(descriptor.defaultValue === undefined ? [option("", "Not set", "Whatever the provider does by default.")] : []),
        ...kind.choices.map((choice) => option(choice.value, choice.label, choice.description)),
      ];
      break;
    case "integer":
      if (kind.presets === undefined) return { kind: "text", multiline: false };
      options = kind.presets.map((preset) => option(String(preset), `${preset}${kind.unit ?? ""}`));
      break;
    case "duration":
      if (kind.presets === undefined) return { kind: "text", multiline: false };
      options = kind.presets.map((preset) => option(preset, durationLabel(preset)));
      break;
    case "string":
      if (kind.source === undefined) return { kind: "text", multiline: kind.multiline === true };
      // No catalog yet (still loading): the list would be empty, not wrong.
      options = catalogOptions(kind.source, settings, providers ?? []);
      break;
  }
  const current = value === undefined || value === "" ? "" : String(value);
  if (!options.some((entry) => entry.value === current)) options = [option(current, current, "Set in the config file"), ...options];
  return { kind: "pick", options };
}

/** A setting's value as the page shows it. */
export function settingValueLabel(descriptor: SettingDescriptor, value: SettingValue, control: SettingControl): string {
  if (descriptor.kind.type === "boolean") return value === true ? "On" : "Off";
  if (control.kind === "pick") {
    const current = value === undefined || value === "" ? "" : String(value);
    const match = control.options.find((entry) => entry.value === current);
    if (match !== undefined) return match.label;
  }
  if (value === undefined || value === "") return "Not set";
  if (descriptor.kind.type === "integer") return `${String(value)}${descriptor.kind.unit ?? ""}`;
  return String(value);
}
