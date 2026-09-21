/**
 * Direct catalog: `providers/models/efforts list` without the T3 server.
 *
 * Same `ProviderSummary[]` envelopes as the WS path (`catalog.ts`
 * extraction is T3-payload-specific, so this module builds the summaries
 * directly), values from our own sources (DECOUPLE.md §15.4):
 * - claude/codex/grok: binary presence + best-effort live model listings
 *   through ephemeral driver sessions. Nothing is cached: every call
 *   probes, failures degrade to `models: []` with the reason in `status`.
 * - opencode: one entry per models.dev provider
 *   (`instanceId: "opencode/<providerId>"`, slugs already
 *   `providerID/modelID`, so send-time routing needs no translation),
 *   API-key presence from env, OAuth status from the stored auth file.
 *
 * Honest gaps (cutover/hardening items, not silent): usage windows are
 * session-live in every native driver so `usageLimits` is null here;
 * skills need a live server/session scan; Claude exposes no model catalog
 * API so its models resolve at send time.
 */
import fs from "node:fs";
import path from "node:path";

import * as Effect from "effect/Effect";

import { CodexDriver, type CodexListedModel } from "../../providers/codex/driver.js";
import { GrokDriver } from "../../providers/grok/driver.js";
import { claudeCatalogModels } from "../../providers/claude/catalog.js";
import {
  effortValuesOf,
  loadModelsDevCatalog,
  presentApiKeyEnvs,
  readStoredAuthTypes,
  type LoadedModelsDevCatalog,
  type ModelsDevModel,
  type ModelsDevProvider,
} from "../../providers/opencode/catalog.js";
import type { EffortDescriptor, ModelSummary, ProviderSummary } from "./catalog.js";

/** Codex `reasoningEffort` values (app-server turn params; DECOUPLE.md §6). */
export const CODEX_REASONING_EFFORTS: ReadonlyArray<string> = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const NATIVE_LIST_TIMEOUT_MS = 20_000;
const CATALOG_SESSION_PREFIX = "__catalog__";

export interface NativeModelLister {
  start(threadId: string, workingDirectory: string): Promise<unknown>;
  models(threadId: string): Promise<ReadonlyArray<CodexListedModel>>;
  stop(threadId: string): Promise<unknown>;
}

function codexLister(): NativeModelLister {
  const driver = new CodexDriver();
  return {
    start: (threadId, workingDirectory) =>
      Effect.runPromise(driver.startSession({ threadId, workingDirectory })) as Promise<unknown>,
    models: (threadId) => driver.listModels(threadId),
    stop: (threadId) => Effect.runPromise(driver.stopSession(threadId)) as Promise<unknown>,
  };
}

function grokLister(): NativeModelLister {
  const driver = new GrokDriver();
  return {
    start: (threadId, workingDirectory) =>
      Effect.runPromise(driver.startSession({ threadId, workingDirectory })) as Promise<unknown>,
    models: (threadId) => driver.listModels(threadId),
    stop: (threadId) => Effect.runPromise(driver.stopSession(threadId)) as Promise<unknown>,
  };
}

export interface DirectCatalogOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly workingDirectory?: string;
  readonly listers?: Partial<Record<"codex" | "grok", () => NativeModelLister>>;
  readonly modelsDev?: () => Promise<LoadedModelsDevCatalog>;
}

function binaryOnPath(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env.PATH ?? env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE").split(";").filter((ext) => ext.length > 0)
    : [""];
  for (const dir of raw.split(delimiter).filter((entry) => entry.length > 0)) {
    for (const ext of process.platform === "win32" ? ["", ...exts] : exts) {
      try {
        if (fs.statSync(path.join(dir, `${name}${ext}`)).isFile()) return true;
      } catch {
        // Keep scanning.
      }
    }
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function baseModel(slug: string, name: string): ModelSummary {
  return { slug, name, isCustom: false, isDefault: null, isHidden: false, efforts: [] };
}

function codexEfforts(reasoningEfforts?: ReadonlyArray<string>): EffortDescriptor[] {
  // Per-model efforts from the live list win; the static set is the
  // fallback for servers that do not report them.
  const values = reasoningEfforts && reasoningEfforts.length > 0 ? reasoningEfforts : CODEX_REASONING_EFFORTS;
  return [{
    id: "reasoningEffort",
    label: "Reasoning effort",
    choices: values.map((id) => ({ id, label: id, isDefault: null })),
    currentValue: null,
  }];
}

async function listNative(
  kind: "codex" | "grok",
  displayName: string,
  binary: string,
  options: DirectCatalogOptions,
  env: NodeJS.ProcessEnv,
  attachEfforts: (model: ModelSummary, reasoningEfforts?: ReadonlyArray<string>) => ModelSummary,
): Promise<ProviderSummary> {
  const installed = binaryOnPath(binary, env);
  const base: ProviderSummary = {
    instanceId: kind,
    driver: kind,
    displayName,
    enabled: installed,
    installed,
    status: installed ? null : "not installed",
    authStatus: null,
    models: [],
    supportedRuntimeModes: null,
    usageLimits: null,
    skills: [],
  };
  if (!installed) return base;
  const factory = options.listers?.[kind] ?? (kind === "codex" ? codexLister : grokLister);
  const lister = factory();
  const threadId = `${CATALOG_SESSION_PREFIX}${kind}`;
  const cwd = options.workingDirectory ?? process.cwd();
  try {
    await withTimeout(lister.start(threadId, cwd), NATIVE_LIST_TIMEOUT_MS, `${kind} session`);
    const models = await withTimeout(lister.models(threadId), NATIVE_LIST_TIMEOUT_MS, `${kind} model/list`);
    return {
      ...base,
      authStatus: "authenticated",
      models: models.map((model) => attachEfforts(baseModel(model.id, model.name ?? model.id), model.reasoningEfforts)),
    };
  } catch (cause) {
    const message = errorMessage(cause).slice(0, 200);
    const authFailure = /not logged in|unauthorized|401|auth|login/i.test(message);
    return {
      ...base,
      enabled: authFailure ? false : installed,
      authStatus: authFailure ? "unauthenticated" : null,
      status: message,
    };
  } finally {
    await lister.stop(threadId).catch(() => undefined);
  }
}

function opencodeEfforts(model: ModelsDevModel): EffortDescriptor[] {
  const values = effortValuesOf(model);
  if (values.length === 0) return [];
  return [{
    id: "effort",
    label: "Effort",
    choices: values.map((id) => ({ id, label: id, isDefault: null })),
    currentValue: null,
  }];
}

function storedAuthStatus(providerId: string, stored: Record<string, string>): string | null {
  const type = stored[providerId];
  if (type === "oauth") return "oauth";
  if (type === "api") return "api-key";
  if (typeof type === "string") return type;
  return null;
}

/**
 * How to enable a credential-less provider, using its own key names.
 * `xai`/`openai` additionally offer the subscription path through our
 * vendored OAuth plugins once connected in opencode itself.
 */
export function enablementHint(provider: ModelsDevProvider): string {
  const keys = provider.env.length > 0 ? `set ${provider.env.join(" or ")}` : "add an API key";
  const login =
    provider.id === "xai" || provider.id === "openai" ? " or run `opencode auth login` for the subscription" : "";
  return `not configured (${keys}${login})`;
}

function opencodeProviders(
  loaded: LoadedModelsDevCatalog,
  env: NodeJS.ProcessEnv,
  installed: boolean,
): ProviderSummary[] {
  const stored = readStoredAuthTypes(env);
  return loaded.catalog.map((provider: ModelsDevProvider) => {
    const keyEnvs = presentApiKeyEnvs(provider, env);
    const credential = storedAuthStatus(provider.id, stored) ?? (keyEnvs.length > 0 ? "api-key" : null);
    // The picker only offers usable providers: an opencode entry without
    // any credential (no stored OAuth, no env key) is listed but disabled.
    // `providers list` still shows all 200+ for discovery. Enablement
    // happens in opencode itself (`opencode auth login`, API keys) — the
    // status below says exactly how for each provider.
    const enabled = installed && credential !== null;
    return {
      instanceId: `opencode/${provider.id}`,
      driver: "opencode",
      displayName: provider.name,
      enabled,
      installed,
      status: !installed
        ? "not installed"
        : !enabled
          ? enablementHint(provider)
          : loaded.source === "live"
            ? null
            : `models.dev ${loaded.source}`,
      authStatus: credential,
      models: provider.models.map((model) => ({
        ...baseModel(model.id, model.name),
        efforts: opencodeEfforts(model),
      })),
      supportedRuntimeModes: null,
      usageLimits: null,
      skills: [],
    };
  });
}

/**
 * Build the direct-backend provider summaries. Always probes live sources;
 * every failure degrades into its entry's `status`, never a throw — a
 * broken Codex login must not hide the working Claude install.
 */
export async function buildDirectProviders(options: DirectCatalogOptions = {}): Promise<ProviderSummary[]> {  const env = options.env ?? process.env;
  const opencodeInstalled = binaryOnPath("opencode", env);

  const [claudeInstalled, codex, grok, modelsDev] = await Promise.all([
    Promise.resolve(binaryOnPath("claude", env)),
    listNative("codex", "Codex", "codex", options, env, (model, reasoningEfforts) => ({ ...model, efforts: codexEfforts(reasoningEfforts) })),
    listNative("grok", "Grok", "grok", options, env, (model) => model),
    (options.modelsDev ?? loadModelsDevCatalog)().catch((): LoadedModelsDevCatalog => ({ catalog: [], source: "empty" })),
  ]);

  // Claude has no list API; the pinned manifest is the catalog. The
  // instance id matches T3's (`claudeAgent`) so migrated threads and the
  // manifest's provider key resolve without translation.
  const claude: ProviderSummary = {
    instanceId: "claudeAgent",
    driver: "claude",
    displayName: "Claude Code",
    enabled: claudeInstalled,
    installed: claudeInstalled,
    status: claudeInstalled ? null : "not installed",
    authStatus: null,
    models: claudeCatalogModels().map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: false,
      isDefault: model.isDefault,
      isHidden: false,
      efforts: model.efforts.map((effort) => ({
        id: effort.id,
        label: effort.label,
        choices: effort.choices.map((choice) => ({ id: choice.id, label: choice.label, isDefault: choice.isDefault })),
        currentValue: effort.currentValue,
      })),
    })),
    supportedRuntimeModes: null,
    usageLimits: null,
    skills: [],
  };

  return [claude, codex, grok, ...opencodeProviders(modelsDev, env, opencodeInstalled)];
}

/**
 * Translate direct summaries into the `server.getConfig` payload shape so
 * the TUI's `extractProviders` keeps working unmodified — including
 * effort descriptors, which become `capabilities.optionDescriptors`.
 * Hidden-model preferences have no direct equivalent yet: nothing is
 * hidden. Consumed by `tui/client/direct.ts` `getConfig`.
 */
export function toWsConfigPayload(providers: ReadonlyArray<ProviderSummary>): {
  providers: unknown[];
  settings: Record<string, unknown>;
} {
  return {
    providers: providers.map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      displayName: provider.displayName,
      enabled: provider.enabled,
      installed: provider.installed,
      status: provider.status,
      auth: { status: provider.authStatus },
      models: provider.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        isCustom: model.isCustom,
        isDefault: model.isDefault,
        capabilities: {
          optionDescriptors: model.efforts.map((effort) => ({
            id: effort.id,
            label: effort.label,
            type: "select",
            options: effort.choices.map((choice) => ({
              id: choice.id,
              label: choice.label,
              isDefault: choice.isDefault,
            })),
            currentValue: effort.currentValue,
          })),
        },
      })),
      supportedRuntimeModes: provider.supportedRuntimeModes,
      usageLimits: provider.usageLimits,
      skills: provider.skills,
    })),
    settings: {},
  };
}
