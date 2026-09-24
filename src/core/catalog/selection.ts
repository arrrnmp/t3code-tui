import { CliError } from "../errors.js";
import { binaryOnPath } from "../infra/process.js";
import { parseClaudeModels } from "../providers/claude/catalog.js";
import { CODEX_DEFAULT_MODEL_SLUG } from "../providers/codex/config.js";
import { GROK_DEFAULT_MODEL_SLUG } from "../providers/grok/config.js";
import type {
  CliConfig,
  ModelSelection,
  ProviderOptionSelection,
  SpeedMode,
} from "../types.js";

/** Pins the installation default: `<instanceId>/<model>`, e.g. `claudeAgent/claude-opus-5-5`. */
export const DEFAULT_MODEL_ENV = "MOXEN_DEFAULT_MODEL";

export interface ModelSelectionRequest {
  prompt: string;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
}

export interface InstallationDefaultOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Whether a provider CLI is installed; `PATH` lookup by default. */
  readonly installed?: (binary: string) => boolean;
}

/**
 * The installation default: the model a thread gets when nothing more
 * specific names one — flags, config `provider`/`model`, the project's
 * default and the thread's own selection all win over it.
 *
 * `MOXEN_DEFAULT_MODEL` pins it outright. Otherwise it is the first
 * provider installed here, in a fixed order — Claude, Grok, Codex — on
 * *that provider's own* default, never a model slug of ours that ages with
 * every release: Claude's bundled catalog default, Grok's `grok-build`
 * (keep the session's model) and `codex-default` (send none, so the
 * app-server applies its configured default). OpenCode routes to many
 * providers, so picking one would be a guess; it is never chosen here.
 *
 * With none installed there is no model to fall back to, and saying so
 * beats addressing a provider that cannot start.
 */
export function defaultModelSelection(options: InstallationDefaultOptions = {}): ModelSelection {
  const env = options.env ?? process.env;
  const pinned = env[DEFAULT_MODEL_ENV]?.trim();
  if (pinned) {
    const slash = pinned.indexOf("/");
    if (slash <= 0 || slash === pinned.length - 1) {
      throw new CliError(
        "INVALID_CONFIG",
        `${DEFAULT_MODEL_ENV} must be <provider-instance>/<model>, e.g. claudeAgent/claude-opus-5-5.`,
        { exitCode: 2, details: { value: pinned } },
      );
    }
    return { instanceId: pinned.slice(0, slash), model: pinned.slice(slash + 1) };
  }
  const installed = options.installed ?? ((binary: string) => binaryOnPath(binary, env));
  if (installed("claude")) {
    const models = parseClaudeModels();
    const model = models.find((candidate) => candidate.isDefault === true) ?? models[0];
    if (model) return { instanceId: "claudeAgent", model: model.slug };
  }
  if (installed("grok")) return { instanceId: "grok", model: GROK_DEFAULT_MODEL_SLUG };
  if (installed("codex")) return { instanceId: "codex", model: CODEX_DEFAULT_MODEL_SLUG };
  throw new CliError(
    "NO_DEFAULT_MODEL",
    "No model is configured and no provider CLI (claude, grok, codex) is installed. " +
      "Install one, or name a model: moxen config set provider <instance> and moxen config set model <model>.",
    { exitCode: 3, details: { checked: ["claude", "grok", "codex"] } },
  );
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
    // Provider drivers use different descriptor ids for the same user-facing control.
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

/** Flag-level model request, resolved against the config and a base selection. */
export interface ModelRequest {
  readonly provider?: string;
  readonly model?: string;
  readonly speedMode?: SpeedMode;
  readonly thinkingEffort?: string;
}

function hasModelRequest(request: ModelRequest | undefined): request is ModelRequest {
  return (
    request !== undefined &&
    (request.provider !== undefined ||
      request.model !== undefined ||
      request.speedMode !== undefined ||
      request.thinkingEffort !== undefined)
  );
}

/**
 * The selection a follow-up turn runs on, or undefined to keep the
 * thread's own. A follow-up keeps its thread's model unless the request
 * overrides it: the config's default provider/model must not flip an
 * existing thread's model, so they are stripped before resolving.
 */
export function followUpSelection(
  base: ModelSelection,
  config: CliConfig,
  request: ModelRequest | undefined,
  prompt: string,
): ModelSelection | undefined {
  if (!hasModelRequest(request)) return undefined;
  const scoped: CliConfig = { ...config };
  delete scoped.provider;
  delete scoped.model;
  delete scoped.speedMode;
  delete scoped.thinkingEffort;
  return resolveModelSelection(base, scoped, { prompt, ...request });
}
