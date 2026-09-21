/**
 * Claude model catalog, pinned from T3's bundled model manifest.
 *
 * The Agent SDK exposes no model-listing API, so without this the Claude
 * catalog entry would carry zero models — and the TUI model/effort
 * pickers would come up empty on every Claude thread. The manifest is
 * data (slugs, names, select-type option descriptors), parsed
 * defensively: unknown shapes degrade to fewer models, never a throw.
 * Slugs drift as Anthropic ships; the pin records its date so staleness
 * is visible. See DECOUPLE.md §5.
 */
import manifest from "./claude-manifest.json" with { type: "json" };

export interface ClaudeCatalogChoice {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean | null;
}

export interface ClaudeCatalogEffort {
  readonly id: string;
  readonly label: string;
  readonly choices: ReadonlyArray<ClaudeCatalogChoice>;
  readonly currentValue: string | null;
}

export interface ClaudeCatalogModel {
  readonly slug: string;
  readonly name: string;
  readonly isDefault: boolean | null;
  readonly efforts: ReadonlyArray<ClaudeCatalogEffort>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseChoice(raw: unknown): ClaudeCatalogChoice | null {
  const entry = asRecord(raw);
  const id = entry ? asString(entry.id) : null;
  const label = entry ? asString(entry.label) : null;
  if (!id || !label) return null;
  return {
    id,
    label,
    isDefault: entry?.isDefault === true ? true : entry?.isDefault === false ? false : null,
  };
}

function parseEffort(raw: unknown): ClaudeCatalogEffort | null {
  const entry = asRecord(raw);
  const id = entry ? asString(entry.id) : null;
  const label = entry ? asString(entry.label) : null;
  // Only select-type descriptors carry pickable values (mirrors the CLI
  // catalog's extractEffort); boolean flags are not effort knobs.
  if (!id || !label || entry?.type !== "select" || !Array.isArray(entry.options)) return null;
  const choices = entry.options.flatMap((option) => {
    const choice = parseChoice(option);
    return choice ? [choice] : [];
  });
  // A select with no options renders an empty picker section — skip it.
  if (choices.length === 0) return null;
  return {
    id,
    label,
    choices,
    currentValue: asString(entry.currentValue),
  };
}

/**
 * Parse a model-manifest payload (the pinned file by default) into the
 * `claudeAgent` provider's models. Provider key, profile capabilities,
 * and chat default all follow T3's `resolveProviderCatalog` layout.
 */
export function parseClaudeManifest(raw: unknown = manifest): ClaudeCatalogModel[] {
  const root = asRecord(raw);
  const providers = root ? asRecord(root.providers) : null;
  const agent = providers ? asRecord(providers.claudeAgent) : null;
  if (!agent) return [];
  const profiles = asRecord(agent.profiles) ?? {};
  const defaults = asRecord(agent.defaults);
  const defaultSlug = defaults ? asString(defaults.chat) : null;
  const models = Array.isArray(agent.models) ? agent.models : [];
  return models.flatMap((rawModel) => {
    const entry = asRecord(rawModel);
    const slug = entry ? asString(entry.slug) : null;
    const name = entry ? asString(entry.name) : null;
    if (!slug || !name) return [];
    const profileName = entry ? asString(entry.profile) : null;
    const profile = profileName ? asRecord(profiles[profileName]) : null;
    const capabilities = profile ? asRecord(profile.capabilities) : null;
    const descriptors = capabilities && Array.isArray(capabilities.optionDescriptors)
      ? capabilities.optionDescriptors
      : [];
    return [{
      slug,
      name,
      isDefault: defaultSlug !== null ? defaultSlug === slug : null,
      efforts: descriptors.flatMap((descriptor) => {
        const effort = parseEffort(descriptor);
        return effort ? [effort] : [];
      }),
    }];
  });
}

/** Pinned manifest models; empty when the pin stops parsing. */
export function claudeCatalogModels(): ClaudeCatalogModel[] {
  try {
    return parseClaudeManifest(manifest);
  } catch {
    return [];
  }
}
