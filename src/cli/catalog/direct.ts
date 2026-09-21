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
import { resolveStoreRoot } from "../../threads/store.js";
import { ensureImportedFromT3, isModelHidden, loadModelPrefs } from "../../catalog/prefs.js";
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
  readonly storeRoot?: string;
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

/**
 * The single `opencode` instance (T3 parity): every models.dev model in
 * one catalog entry, addressed `provider/model` exactly like T3's
 * favorites and migrated threads (`opencode/muse-spark-...`,
 * `github-copilot/claude-haiku-4.5`). Source ids without a slash are
 * prefixed with their provider. `enabled` is install state — readiness
 * is per credential and reported in `authStatus`, failing clearly at
 * send time like both references.
 */
function opencodeInstance(
  loaded: LoadedModelsDevCatalog,
  env: NodeJS.ProcessEnv,
  installed: boolean,
  isHidden: (slug: string) => boolean,
): ProviderSummary {
  const stored = readStoredAuthTypes(env);
  const oauth = Object.values(stored).some((type) => type === "oauth");
  const keyed = loaded.catalog.some((provider) => presentApiKeyEnvs(provider, env).length > 0);
  const models = loaded.catalog.flatMap((provider: ModelsDevProvider) =>
    provider.models.map((model) => {
      const slug = model.id.includes("/") ? model.id : `${provider.id}/${model.id}`;
      return {
        slug,
        name: model.name,
        isCustom: false,
        isDefault: null as boolean | null,
        isHidden: isHidden(slug),
        efforts: opencodeEfforts(model),
      };
    }),
  );
  return {
    instanceId: "opencode",
    driver: "opencode",
    displayName: "OpenCode",
    enabled: installed,
    installed,
    status: !installed
      ? "not installed"
      : loaded.source === "live"
        ? null
        : `models.dev ${loaded.source}`,
    authStatus: oauth ? "oauth" : keyed ? "api-key" : null,
    models,
    supportedRuntimeModes: null,
    usageLimits: null,
    skills: [],
  };
}

/**
 * Build the direct-backend provider summaries. Always probes live sources;
 * every failure degrades into its entry's `status`, never a throw — a
 * broken Codex login must not hide the working Claude install.
 */
export async function buildDirectProviders(options: DirectCatalogOptions = {}): Promise<ProviderSummary[]> {
  const env = options.env ?? process.env;
  const opencodeInstalled = binaryOnPath("opencode", env);
  const storeRoot = options.storeRoot ?? resolveStoreRoot();

  const [claudeInstalled, codex, grok, modelsDev, prefs] = await Promise.all([
    Promise.resolve(binaryOnPath("claude", env)),
    listNative("codex", "Codex", "codex", options, env, (model, reasoningEfforts) => ({ ...model, efforts: codexEfforts(reasoningEfforts) })),
    listNative("grok", "Grok", "grok", options, env, (model) => model),
    (options.modelsDev ?? loadModelsDevCatalog)().catch((): LoadedModelsDevCatalog => ({ catalog: [], source: "empty" })),
    // One-time T3 curation import, then our own prefs (hidden models feed
    // the pickers through `isHidden` below).
    ensureImportedFromT3(storeRoot, env)
      .catch(() => false)
      .then(() => loadModelPrefs(storeRoot)),
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
      isHidden: isModelHidden(prefs, "claudeAgent", model.slug),
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

  const opencode = opencodeInstance(modelsDev, env, opencodeInstalled, (slug) => isModelHidden(prefs, "opencode", slug));

  const markHidden = (provider: ProviderSummary): ProviderSummary => ({
    ...provider,
    models: provider.models.map((model) => ({
      ...model,
      isHidden: isModelHidden(prefs, provider.instanceId, model.slug),
    })),
  });

  return [claude, markHidden(codex), markHidden(grok), opencode];
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
