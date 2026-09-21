/**
 * OpenCode catalog: the models.dev long tail + stored-auth status.
 *
 * Own code, shaped by upstream `packages/core/src/models-dev.ts` and
 * `packages/core/src/plugin/models-dev.ts` (constants + behavior, not
 * text): `GET ${source}/api.json` (default
 * `https://models.opencode.ai`), 5-minute disk-cache freshness, pinned
 * snapshot fallback, 10s fetch timeout. Two deliberate differences from
 * upstream, both forced by our shape:
 * - Upstream serves disk/snapshot immediately and refreshes on a 60-min
 *   background poll (it is a long-lived server). We are request-scoped
 *   (one CLI invocation), so a stale cache triggers one blocking
 *   refresh with snapshot fallback on failure.
 * - Upstream caches in its own `Global.Path.cache`; we keep our own
 *   `~/.t3code/cache/opencode-models.json` so we never contend with the
 *   server's lock/refresh protocol.
 *
 * Auth status mirrors upstream `packages/opencode/src/auth/index.ts`:
 * `OPENCODE_AUTH_CONTENT` wins, else `<xdg-data>/opencode/auth.json`.
 * Only the credential *type* per provider is surfaced — secrets are never
 * read into our process beyond what `JSON.parse` holds transiently, and
 * never logged.
 *
 * Snapshot provenance: `models-snapshot.json` is a verbatim
 * `GET https://models.opencode.ai/api.json` response pinned 2026-09-21
 * (222 providers, ~4.7MB). Refresh overwrites only our cache file, never
 * the pin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MODELS_DEV_DEFAULT_URL = "https://models.opencode.ai";
export const MODELS_DEV_API_PATH = "/api.json";
export const MODELS_DEV_CACHE_TTL_MS = 5 * 60 * 1000;
export const MODELS_DEV_FETCH_TIMEOUT_MS = 10_000;

/** A models.dev reasoning knob on one model. */
export interface ModelsDevReasoningOption {
  readonly type: string;
  readonly values?: ReadonlyArray<string> | undefined;
}

export interface ModelsDevModelCost {
  readonly input: number | null;
  readonly output: number | null;
}

export interface ModelsDevModel {
  readonly id: string;
  readonly name: string;
  readonly reasoningOptions: ReadonlyArray<ModelsDevReasoningOption>;
  readonly cost: ModelsDevModelCost | null;
}

/**
 * Zero-cost model (opencode's own `Free` label rule: `cost.input === 0`).
 * Missing cost data never reads as free.
 */
export function isFreeModel(model: ModelsDevModel): boolean {
  return model.cost !== null && model.cost.input === 0 && model.cost.output === 0;
}

export interface ModelsDevProvider {
  readonly id: string;
  readonly name: string;
  /** Env var names holding API keys for this provider (upstream `env[]`). */
  readonly env: ReadonlyArray<string>;
  readonly models: ReadonlyArray<ModelsDevModel>;
}

export type ModelsDevCatalog = ReadonlyArray<ModelsDevProvider>;

export type ModelsDevCatalogSource = "cache" | "live" | "snapshot" | "empty";

export interface LoadedModelsDevCatalog {
  readonly catalog: ModelsDevCatalog;
  readonly source: ModelsDevCatalogSource;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseReasoningOption(raw: unknown): ModelsDevReasoningOption | null {
  const entry = asRecord(raw);
  const type = entry ? asString(entry.type) : null;
  if (!type) return null;
  const values = entry?.values;
  if (values === undefined) return { type };
  if (!Array.isArray(values)) return { type };
  const names = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return { type, values: names };
}

function parseCost(raw: unknown): ModelsDevModelCost | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  const number = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const input = number(entry.input);
  const output = number(entry.output);
  if (input === null && output === null) return null;
  return { input, output };
}

function parseModel(id: string, raw: unknown): ModelsDevModel | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  const name = asString(entry.name) ?? id;
  const reasoning = entry.reasoning_options;
  const reasoningOptions = Array.isArray(reasoning)
    ? reasoning.flatMap((option) => {
      const parsed = parseReasoningOption(option);
      return parsed ? [parsed] : [];
    })
    : [];
  return { id, name, reasoningOptions, cost: parseCost(entry.cost) };
}

function parseProvider(id: string, raw: unknown): ModelsDevProvider | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  const env = entry.env;
  const envNames = Array.isArray(env)
    ? env.filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
  const models = asRecord(entry.models) ?? {};
  const parsed = Object.entries(models).flatMap(([modelId, model]) => {
    const parsedModel = parseModel(modelId, model);
    return parsedModel ? [parsedModel] : [];
  });
  return {
    id,
    name: asString(entry.name) ?? id,
    env: envNames,
    models: parsed,
  };
}

/** Defensive parse of a models.dev `api.json` payload (any shape in, catalog out). */
export function parseModelsDevCatalog(raw: unknown): ModelsDevCatalog {
  const root = asRecord(raw);
  if (!root) return [];
  return Object.entries(root).flatMap(([id, provider]) => {
    const parsed = parseProvider(id, provider);
    return parsed ? [parsed] : [];
  });
}

/**
 * Effort values for one model: the `values` of its first
 * `{type: "effort"}` reasoning option (upstream `transform.ts` maps these
 * per-provider at call time; the catalog only enumerates them).
 * `toggle`/`budget_tokens` knobs are not select-style efforts — skipped.
 */
export function effortValuesOf(model: ModelsDevModel): ReadonlyArray<string> {
  const option = model.reasoningOptions.find((entry) => entry.type === "effort");
  return option?.values ?? [];
}

/** Env-var key names from `provider.env` that are set in `env`. */
export function presentApiKeyEnvs(provider: ModelsDevProvider, env: NodeJS.ProcessEnv): string[] {
  return provider.env.filter((name) => (env[name] ?? "").trim().length > 0);
}

let snapshotCatalogCache: ModelsDevCatalog | null = null;

/**
 * Required API-key env names for one models.dev provider id, from the
 * pinned snapshot. Null when the provider is unknown (custom servers,
 * newer catalog) — callers must let the server decide then, never block.
 */
export async function providerEnvNames(providerID: string): Promise<ReadonlyArray<string> | null> {
  if (!snapshotCatalogCache) {
    try {
      const snapshot = (await import("./models-snapshot.json")).default as unknown;
      snapshotCatalogCache = parseModelsDevCatalog(snapshot);
    } catch {
      return null;
    }
  }
  const found = snapshotCatalogCache.find((provider) => provider.id.toLowerCase() === providerID.toLowerCase());
  return found ? [...found.env] : null;
}

export function resolveModelsDevUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_MODELS_URL?.trim();
  return override && override.length > 0 ? override : MODELS_DEV_DEFAULT_URL;
}

export function defaultModelsDevCachePath(): string {
  return path.join(os.homedir(), ".t3code", "cache", "opencode-models.json");
}

/**
 * Stored OpenCode credentials per provider id (`oauth`/`api`/`wellknown`/…).
 * `OPENCODE_AUTH_CONTENT` (inline JSON, upstream `auth/index.ts`) wins over
 * the auth file; the default file is `<xdg-data>/opencode/auth.json`,
 * overridable with `OPENCODE_AUTH_FILE` (ours). Unparseable input reads as
 * "no stored auth", never an error — listing must degrade, not fail.
 */
export function readStoredAuthTypes(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (filePath: string) => string | null = defaultReadFile,
): Record<string, string> {
  const inline = env.OPENCODE_AUTH_CONTENT?.trim() ?? "";
  if (inline.length > 0) return authTypesOf(parseJson(inline));
  const file = env.OPENCODE_AUTH_FILE?.trim()?.length
    ? (env.OPENCODE_AUTH_FILE as string).trim()
    : path.join(env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"), "opencode", "auth.json");
  const text = readFile(file);
  if (text === null) return {};
  return authTypesOf(parseJson(text));
}

function defaultReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function authTypesOf(raw: unknown): Record<string, string> {
  const root = asRecord(raw);
  if (!root) return {};
  const out: Record<string, string> = {};
  for (const [providerId, entry] of Object.entries(root)) {
    const type = asRecord(entry)?.type;
    if (typeof type === "string" && type.length > 0) out[providerId] = type;
  }
  return out;
}

export interface LoadModelsDevCatalogOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cachePath?: string;
  /** Pinned snapshot text (defaults to the bundled `models-snapshot.json`). */
  readonly snapshotText?: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

function cacheIsFresh(cachePath: string, now: number, statFile: (path: string) => number | null): boolean {
  const mtime = statFile(cachePath);
  if (mtime === null) return false;
  return now - mtime < MODELS_DEV_CACHE_TTL_MS;
}

function statMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function writeCacheBestEffort(cachePath: string, text: string): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, cachePath);
  } catch {
    // Cache is best-effort; the live payload is still returned.
  }
}

/**
 * Load the models.dev catalog: fresh cache → live fetch (cached on
 * success) → pinned snapshot → empty. Returns where the payload came
 * from so callers can label staleness honestly.
 */
export async function loadModelsDevCatalog(options: LoadModelsDevCatalogOptions = {}): Promise<LoadedModelsDevCatalog> {
  const env = options.env ?? process.env;
  const cachePath = options.cachePath ?? defaultModelsDevCachePath();
  const now = options.now ?? Date.now;
  const snapshotText = options.snapshotText === undefined ? (await import("./models-snapshot.json")).default as unknown : options.snapshotText;

  if (cacheIsFresh(cachePath, now(), statMtimeMs)) {
    const text = defaultReadFile(cachePath);
    if (text !== null) {
      const catalog = parseModelsDevCatalog(parseJson(text));
      if (catalog.length > 0) return { catalog, source: "cache" };
    }
  }

  const live = await fetchLiveCatalog(env, options.fetchImpl ?? fetch);
  if (live !== null) {
    writeCacheBestEffort(cachePath, live.text);
    const catalog = parseModelsDevCatalog(parseJson(live.text));
    if (catalog.length > 0) return { catalog, source: "live" };
  }

  if (typeof snapshotText === "string" && snapshotText.length > 0) {
    const catalog = parseModelsDevCatalog(parseJson(snapshotText));
    if (catalog.length > 0) return { catalog, source: "snapshot" };
  }
  return { catalog: [], source: "empty" };
}

async function fetchLiveCatalog(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<{ text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_DEV_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${resolveModelsDevUrl(env)}${MODELS_DEV_API_PATH}`, {
      headers: { "User-Agent": "t3code/models-dev-snapshot" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return { text: await response.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
