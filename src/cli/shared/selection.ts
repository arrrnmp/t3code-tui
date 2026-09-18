import { CliError } from "../../errors.js";
import type {
  CliConfig,
  ModelSelection,
  ProviderOptionSelection,
  SpeedMode,
} from "../../types.js";

const LEGACY_DEFAULT_MODEL_SELECTION: ModelSelection = { instanceId: "codex", model: "gpt-5.4" };
const CURRENT_DEFAULT_MODEL_SELECTION: ModelSelection = { instanceId: "codex", model: "gpt-6-astra" };
const MODERN_DEFAULTS_VERSION = "0.0.29";

export interface ModelSelectionRequest {
  prompt: string;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
}

function parseVersion(version: string): readonly [number, number, number] | null {
  const values = version.match(/^v?(\d+)\.(\d+)\.(\d+)/u)?.slice(1).map(Number);
  if (!values || values.length !== 3 || values.some((value) => !Number.isInteger(value))) return null;
  return [values[0]!, values[1]!, values[2]!];
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index]! > required[index]!) return true;
    if (actual[index]! < required[index]!) return false;
  }
  return true;
}

export function defaultModelSelectionForVersion(version: string): ModelSelection {
  return versionAtLeast(version, MODERN_DEFAULTS_VERSION)
    ? CURRENT_DEFAULT_MODEL_SELECTION
    : LEGACY_DEFAULT_MODEL_SELECTION;
}

export function defaultStartFromOriginForVersion(version: string): boolean {
  return versionAtLeast(version, MODERN_DEFAULTS_VERSION);
}

export function nonEmptyOption(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new CliError("INVALID_THREAD_OPTION", `${name} must be a non-empty string.`);
  return trimmed;
}

function normalizeProviderOptions(options: unknown): ProviderOptionSelection[] {
  if (Array.isArray(options)) {
    return options.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const value = candidate.value;
      return id && (typeof value === "string" || typeof value === "boolean") ? [{ id, value }] : [];
    });
  }
  if (options !== null && typeof options === "object") {
    return Object.entries(options).flatMap(([id, value]) =>
      id.trim() && (typeof value === "string" || typeof value === "boolean") ? [{ id: id.trim(), value }] : [],
    );
  }
  return [];
}

function setProviderOption(
  selections: ProviderOptionSelection[],
  id: string,
  value: string | boolean,
): void {
  const existing = selections.find((selection) => selection.id === id);
  if (existing) existing.value = value;
  else selections.push({ id, value });
}

export function asModelSelection(value: unknown): ModelSelection | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.instanceId !== "string" || candidate.instanceId.trim().length === 0) return null;
  if (typeof candidate.model !== "string" || candidate.model.trim().length === 0) return null;
  return candidate as unknown as ModelSelection;
}

export function resolveModelSelection(
  base: ModelSelection,
  config: CliConfig,
  options: ModelSelectionRequest,
): ModelSelection {
  const provider = nonEmptyOption(options.provider ?? config.provider, "provider");
  const requestedModel = nonEmptyOption(options.model ?? config.model, "model");
  const thinkingEffort = nonEmptyOption(
    options.thinkingEffort ?? config.thinkingEffort,
    "thinking effort",
  );
  const instanceId = provider ?? base.instanceId;
  if (provider !== undefined && provider !== base.instanceId && requestedModel === undefined) {
    throw new CliError(
      "MODEL_REQUIRED_FOR_PROVIDER",
      `Provider instance ${provider} differs from the project default; select its model with --model.`,
      { details: { provider, projectProvider: base.instanceId } },
    );
  }
  const model = requestedModel ?? base.model;
  const selectionChanged = instanceId !== base.instanceId || model !== base.model;
  const selections = selectionChanged ? [] : normalizeProviderOptions(base.options);
  const speedMode = options.speedMode ?? config.speedMode;

  if (speedMode !== undefined) {
    setProviderOption(selections, "serviceTier", speedMode === "fast" ? "fast" : "default");
    setProviderOption(selections, "fastMode", speedMode === "fast");
  }
  if (thinkingEffort !== undefined) {
    // T3 provider drivers use different descriptor ids for the same user-facing control.
    setProviderOption(selections, "reasoningEffort", thinkingEffort);
    setProviderOption(selections, "effort", thinkingEffort);
    setProviderOption(selections, "reasoning", thinkingEffort);
  }

  return {
    instanceId,
    model,
    ...(selections.length > 0 ? { options: selections } : {}),
  };
}
