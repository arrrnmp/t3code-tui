/**
 * Claude model catalog.
 *
 * The Agent SDK exposes no model-listing API, so without this the Claude
 * catalog entry would carry zero models - and the TUI model/effort
 * pickers would come up empty on every Claude thread. `claude-models.json`
 * is our own hand-maintained list (slugs, display names, effort choices),
 * parsed defensively: unknown shapes degrade to fewer models, never a
 * throw. Slugs drift as Anthropic ships, so the file records its date and
 * staleness stays visible.
 */
import catalogFile from "./claude-models.json" with { type: "json" };

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

function parseChoice(raw: unknown, defaultId: string | null): ClaudeCatalogChoice | null {
  const entry = asRecord(raw);
  const id = entry ? asString(entry.id) : null;
  const label = entry ? asString(entry.label) : null;
  if (!id || !label) return null;
  return { id, label, isDefault: defaultId === null ? null : defaultId === id ? true : null };
}

function parseEffort(raw: unknown): ClaudeCatalogEffort | null {
  const entry = asRecord(raw);
  const id = entry ? asString(entry.id) : null;
  const label = entry ? asString(entry.label) : null;
  if (!id || !label || !Array.isArray(entry?.choices)) return null;
  const defaultChoice = asString(entry?.default);
  const choices = entry.choices.flatMap((option) => {
    const choice = parseChoice(option, defaultChoice);
    return choice ? [choice] : [];
  });
  // An option with no choices renders an empty picker section - skip it.
  if (choices.length === 0) return null;
  // `currentValue` is what the picker shows as *selected*, which the
  // bundled file never asserts - the default choice is a different thing
  // and downstream already treats null as "nothing selected yet".
  return { id, label, choices, currentValue: asString(entry?.currentValue) };
}

/**
 * Parse the model file (the bundled one by default) into catalog models.
 * Every field is optional as far as this parser is concerned: a model
 * missing its slug or name is skipped, an option with no choices is
 * dropped, and a malformed file yields an empty list.
 */
export function parseClaudeModels(raw: unknown = catalogFile): ClaudeCatalogModel[] {
  const root = asRecord(raw);
  if (!root) return [];
  const defaultSlug = asString(root.default);
  const models = Array.isArray(root.models) ? root.models : [];
  return models.flatMap((rawModel) => {
    const entry = asRecord(rawModel);
    const slug = entry ? asString(entry.slug) : null;
    const name = entry ? asString(entry.name) : null;
    if (!slug || !name) return [];
    const options = entry && Array.isArray(entry.options) ? entry.options : [];
    return [{
      slug,
      name,
      isDefault: defaultSlug !== null ? defaultSlug === slug : null,
      efforts: options.flatMap((option) => {
        const effort = parseEffort(option);
        return effort ? [effort] : [];
      }),
    }];
  });
}

/** Bundled models; empty when the file stops parsing. */
export function claudeCatalogModels(): ClaudeCatalogModel[] {
  try {
    return parseClaudeModels(catalogFile);
  } catch {
    return [];
  }
}

/**
 * A model's display name ("Claude Opus 5"), for ids the CLI reports on its
 * own — a fallback model, say. An id the list does not know reads as itself.
 */
export function claudeModelName(slug: string): string {
  return claudeCatalogModels().find((model) => model.slug === slug)?.name ?? slug;
}
