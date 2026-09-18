import { CliError } from "../../errors.js";
import type { RuntimeMode } from "../../types.js";

/**
 * Runtime modes a provider driver understands. Unknown strings are dropped
 * (mirroring upstream's ForwardCompatibleArray), so a newer server never
 * breaks this client — and neither does a driver listing modes we predate.
 */
const KNOWN_RUNTIME_MODES: ReadonlySet<string> = new Set([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);

export interface ProviderChoice {
  id: string;
  label: string;
  isDefault: boolean | null;
}

export interface EffortDescriptor {
  id: string;
  label: string;
  choices: ProviderChoice[];
  currentValue: string | null;
}

export interface ModelSummary {
  slug: string;
  name: string;
  isCustom: boolean;
  isDefault: boolean | null;
  /** Hidden from T3's own model picker by the user's `providerModelPreferences`. Not an entitlement check — a hidden model can still be dispatched. */
  isHidden: boolean;
  efforts: EffortDescriptor[];
}

export interface ProviderUsageWindow {
  id: string;
  /** "session", "weekly", "monthly", or "other" — labels and orders the bar, nothing more. */
  kind: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface ProviderUsageLimits {
  checkedAt: string;
  windows: ProviderUsageWindow[];
  /** Set when the provider can never report usage (e.g. an API key account), or a probe failed. */
  unavailable: { reason: string; message: string | null } | null;
}

export interface SkillSummary {
  name: string;
  description: string | null;
  displayName: string | null;
  shortDescription: string | null;
  enabled: boolean;
  /** Claude Code's `disable-model-invocation`: only the user can start it, never the agent. */
  userInvocationOnly: boolean;
  /** Claude Code's `user-invocable: false`: only the agent can start it — composers must not offer it under `$`. */
  userInvocable: boolean;
}

export interface ProviderSummary {
  instanceId: string;
  driver: string;
  displayName: string | null;
  enabled: boolean;
  installed: boolean;
  status: string | null;
  authStatus: string | null;
  models: ModelSummary[];
  /**
   * Runtime modes this provider instance supports (`ServerProvider.
   * supportedRuntimeModes`). Null when the server predates the field or the
   * driver states nothing — both read as "every known mode", matching the
   * desktop's `length > 0` gate. Unknown future modes are dropped on the
   * way in, never surfaced.
   */
  supportedRuntimeModes: RuntimeMode[] | null;
  /** Null when the driver has no notion of subscription usage at all. */
  usageLimits: ProviderUsageLimits | null;
  /** `ServerProvider.skills` — flattened across every workspace the provider has scanned. */
  skills: SkillSummary[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function contractChanged(detail: string, received: unknown): CliError {
  return new CliError(
    "T3_CONTRACT_CHANGED",
    `T3 changed a load-bearing response shape (${detail}). Update t3code-cli against the installed T3 version.`,
    { details: { detail, received: typeof received } },
  );
}

function extractChoice(raw: unknown): ProviderChoice | null {
  const entry = asRecord(raw);
  const id = entry ? asNonEmptyString(entry.id) : null;
  const label = entry ? asNonEmptyString(entry.label) : null;
  if (!id || !label) return null;
  return { id, label, isDefault: asBoolean(entry?.isDefault) };
}

function extractEffort(raw: unknown): EffortDescriptor | null {
  const entry = asRecord(raw);
  const id = entry ? asNonEmptyString(entry.id) : null;
  const label = entry ? asNonEmptyString(entry.label) : null;
  // Only select-type descriptors carry a list of values (the effort-style
  // knobs this command exists to enumerate). Boolean flags are skipped.
  if (!id || !label || entry?.type !== "select" || !Array.isArray(entry.options)) return null;
  const currentValue = asNonEmptyString(entry.currentValue);
  return {
    id,
    label,
    choices: entry.options.flatMap((option) => {
      const choice = extractChoice(option);
      return choice ? [choice] : [];
    }),
    currentValue,
  };
}

function extractModel(raw: unknown, hiddenSlugs: ReadonlySet<string>): ModelSummary | null {
  const entry = asRecord(raw);
  const slug = entry ? asNonEmptyString(entry.slug) : null;
  const name = entry ? asNonEmptyString(entry.name) : null;
  if (!slug || !name) return null;
  const capabilities = entry ? asRecord(entry.capabilities) : null;
  const descriptors = capabilities && Array.isArray(capabilities.optionDescriptors)
    ? capabilities.optionDescriptors
    : [];
  return {
    slug,
    name,
    isCustom: asBoolean(entry?.isCustom) ?? false,
    isDefault: asBoolean(entry?.isDefault),
    isHidden: hiddenSlugs.has(slug),
    efforts: descriptors.flatMap((descriptor) => {
      const effort = extractEffort(descriptor);
      return effort ? [effort] : [];
    }),
  };
}

function extractUsageWindow(raw: unknown): ProviderUsageWindow | null {
  const entry = asRecord(raw);
  const id = entry ? asNonEmptyString(entry.id) : null;
  const kind = entry ? asNonEmptyString(entry.kind) : null;
  const label = entry ? asNonEmptyString(entry.label) : null;
  const usedPercent = entry && typeof entry.usedPercent === "number" ? entry.usedPercent : null;
  if (!id || !kind || !label || usedPercent === null) return null;
  return { id, kind, label, usedPercent, resetsAt: entry ? asNonEmptyString(entry.resetsAt) : null };
}

/**
 * `ServerProvider.usageLimits` — the subscription quota windows (Claude's
 * five-hour session, a weekly allowance, and so on) T3 already probes for its
 * own usage panel. Absent entirely for drivers with no notion of usage (API
 * key accounts); `unavailable` marks an account that has the concept but
 * could not be read this time.
 */
function extractUsageLimits(raw: unknown): ProviderUsageLimits | null {
  const entry = asRecord(raw);
  const checkedAt = entry ? asNonEmptyString(entry.checkedAt) : null;
  if (!checkedAt) return null;
  const windows = entry && Array.isArray(entry.windows) ? entry.windows : [];
  const unavailable = entry ? asRecord(entry.unavailable) : null;
  return {
    checkedAt,
    windows: windows.flatMap((window) => {
      const summary = extractUsageWindow(window);
      return summary ? [summary] : [];
    }),
    unavailable: unavailable
      ? { reason: asNonEmptyString(unavailable.reason) ?? "unsupported", message: asNonEmptyString(unavailable.message) }
      : null,
  };
}

function extractSkill(raw: unknown): SkillSummary | null {
  const entry = asRecord(raw);
  const name = entry ? asNonEmptyString(entry.name) : null;
  if (!name) return null;
  return {
    name,
    description: entry ? asNonEmptyString(entry.description) : null,
    displayName: entry ? asNonEmptyString(entry.displayName) : null,
    shortDescription: entry ? asNonEmptyString(entry.shortDescription) : null,
    enabled: asBoolean(entry?.enabled) ?? false,
    userInvocationOnly: asBoolean(entry?.userInvocationOnly) ?? false,
    userInvocable: asBoolean(entry?.userInvocable) ?? true,
  };
}

/**
 * `ServerSettings.providerModelPreferences[instanceId].hiddenModels` — the
 * slugs a user hid from T3's own model picker. Absent on servers that
 * predate the setting, or when the instance has no preferences saved yet;
 * both read as "nothing hidden" rather than an error.
 */
function extractHiddenModelSlugs(settings: unknown, instanceId: string): ReadonlySet<string> {
  const preferences = asRecord(asRecord(settings)?.providerModelPreferences);
  const entry = asRecord(preferences?.[instanceId]);
  const hidden = entry && Array.isArray(entry.hiddenModels) ? entry.hiddenModels : [];
  return new Set(hidden.filter((slug): slug is string => typeof slug === "string"));
}

function extractSupportedRuntimeModes(raw: unknown): RuntimeMode[] | null {
  if (!Array.isArray(raw)) return null;
  const modes = raw.filter((mode): mode is RuntimeMode => typeof mode === "string" && KNOWN_RUNTIME_MODES.has(mode));
  return modes;
}

function extractProvider(raw: unknown, settings: unknown): ProviderSummary {
  const entry = asRecord(raw);
  const instanceId = entry ? asNonEmptyString(entry.instanceId) : null;
  const driver = entry ? asNonEmptyString(entry.driver) : null;
  if (!instanceId || !driver) throw contractChanged("provider without instanceId/driver", raw);
  const auth = entry ? asRecord(entry.auth) : null;
  const models = entry && Array.isArray(entry.models) ? entry.models : [];
  const hiddenSlugs = extractHiddenModelSlugs(settings, instanceId);
  return {
    instanceId,
    driver,
    displayName: asNonEmptyString(entry?.displayName),
    enabled: asBoolean(entry?.enabled) ?? false,
    installed: asBoolean(entry?.installed) ?? false,
    status: asNonEmptyString(entry?.status),
    authStatus: auth ? asNonEmptyString(auth.status) : null,
    models: models.flatMap((model) => {
      const summary = extractModel(model, hiddenSlugs);
      return summary ? [summary] : [];
    }),
    supportedRuntimeModes: extractSupportedRuntimeModes(entry?.supportedRuntimeModes),
    usageLimits: extractUsageLimits(entry?.usageLimits),
    skills: (entry && Array.isArray(entry.skills) ? entry.skills : []).flatMap((skill) => {
      const summary = extractSkill(skill);
      return summary ? [summary] : [];
    }),
  };
}

/** Pull the provider snapshots out of a server.getConfig / server.refreshProviders payload. */
export function extractProviders(response: unknown): ProviderSummary[] {
  const root = asRecord(response);
  const providers = root?.providers;
  if (!Array.isArray(providers)) throw contractChanged("response.providers is not an array", response);
  return providers.map((provider) => extractProvider(provider, root?.settings));
}

export function selectProvider(providers: readonly ProviderSummary[], instanceId: string): ProviderSummary {
  const found = providers.find((provider) => provider.instanceId === instanceId);
  if (!found) {
    throw new CliError("PROVIDER_NOT_FOUND", `Unknown provider instance: ${instanceId}.`, {
      details: { instanceId, available: providers.map((provider) => provider.instanceId) },
    });
  }
  return found;
}

export function selectModel(provider: ProviderSummary, slug: string): ModelSummary {
  const found = provider.models.find((model) => model.slug === slug);
  if (!found) {
    throw new CliError("MODEL_NOT_FOUND", `Unknown model ${slug} on provider instance ${provider.instanceId}.`, {
      details: {
        instanceId: provider.instanceId,
        slug,
        available: provider.models.map((model) => model.slug),
      },
    });
  }
  return found;
}
