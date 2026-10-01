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
 *   `~/.moxen/cache/opencode-models.json` so we never contend with the
 *   server's lock/refresh protocol.
 *
 * Auth status comes from `opencode auth list --format json --standalone` (v2 keeps
 * credentials in SQLite). Only the credential *type* per provider is
 * surfaced — the command itself emits no secrets, and we never log any.
 *
 * Snapshot provenance: `models-snapshot.json` is a verbatim
 * `GET https://models.opencode.ai/api.json` response pinned 2026-09-21
 * (222 providers, ~4.7MB). Refresh overwrites only our cache file, never
 * the pin.
 */
import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

import { appHomeDir } from "../../config.js";
import { OPENCODE_DEFAULT_BINARY } from "./config.js";

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

async function snapshotCatalog(): Promise<ModelsDevCatalog | null> {
  if (!snapshotCatalogCache) {
    try {
      const snapshot = (await import("./models-snapshot.json")).default as unknown;
      snapshotCatalogCache = parseModelsDevCatalog(snapshot);
    } catch {
      return null;
    }
  }
  return snapshotCatalogCache;
}

/**
 * Required API-key env names for one models.dev provider id, from the
 * pinned snapshot. Null when the provider is unknown (custom servers,
 * newer catalog) — callers must let the server decide then, never block.
 */
export async function providerEnvNames(providerID: string): Promise<ReadonlyArray<string> | null> {
  const catalog = await snapshotCatalog();
  if (!catalog) return null;
  const found = catalog.find((provider) => sameProviderId(provider.id, providerID));
  return found ? [...found.env] : null;
}

/**
 * Free-tier bypass for the `opencode` provider: upstream
 * `packages/opencode/src/provider/provider.ts` (the `opencode` hook)
 * keeps zero-input-cost models listed with `apiKey: "public"` when no
 * credential exists, dropping the paid models instead. The send-time
 * preflight must mirror that rule, or it blocks exactly the models the
 * server would serve — e.g. `opencode/muse-spark-1.3-contributor-free`
 * with an empty env (verified live: `opencode run` answers with only
 * an unrelated `opencode-go` entry in `auth.json`). Only the `opencode`
 * provider has this fallback; every other provider still requires its
 * key or stored auth. Missing cost data never bypasses — the server
 * decides those.
 */
export async function isFreeOpencodeModel(providerID: string, modelID: string): Promise<boolean> {
  if (providerID.toLowerCase() !== "opencode") return false;
  const catalog = await snapshotCatalog();
  if (!catalog) return false;
  const provider = catalog.find((entry) => entry.id.toLowerCase() === "opencode");
  if (!provider) return false;
  const model = provider.models.find(
    (entry) => entry.id === modelID || entry.id.toLowerCase() === modelID.toLowerCase(),
  );
  return model?.cost?.input === 0;
}

export function resolveModelsDevUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_MODELS_URL?.trim();
  return override && override.length > 0 ? override : MODELS_DEV_DEFAULT_URL;
}

export function defaultModelsDevCachePath(): string {
  return path.join(appHomeDir(), "cache", "opencode-models.json");
}

/** Provider ids v2 renamed; both spellings resolve to the current id. */
const PROVIDER_ID_ALIASES: Readonly<Record<string, string>> = {
  "azure-cognitive-services": "azure",
  "google-vertex-anthropic": "google-vertex",
};

/** Current v2 provider id for a v1 or v2 spelling (lower-cased). */
export function canonicalProviderId(providerId: string): string {
  const id = providerId.toLowerCase();
  return PROVIDER_ID_ALIASES[id] ?? id;
}

/** Whether two provider ids name the same provider across the v1→v2 renames. */
export function sameProviderId(a: string, b: string): boolean {
  return canonicalProviderId(a) === canonicalProviderId(b);
}

/** Credential type stored for `providerId`, tolerating the renamed ids. */
export function storedAuthTypeFor(stored: Readonly<Record<string, string>>, providerId: string): string | undefined {
  for (const [key, type] of Object.entries(stored)) {
    if (sameProviderId(key, providerId)) return type;
  }
  return undefined;
}

export const AUTH_LIST_TIMEOUT_MS = 5_000;
export const AUTH_LIST_CACHE_TTL_MS = 15_000;

/** Runs `opencode auth list --format json --standalone`; stdout on success, null on any failure. */
export type AuthListRunner = (binary: string, env: NodeJS.ProcessEnv) => Promise<string | null>;

/**
 * `--standalone` reads the credential store directly. Without it the CLI
 * connects to the user's shared background service and starts one when none
 * is running, leaving a daemon behind. Async, so a slow CLI never blocks the
 * event loop of the server or the TUI.
 */
function defaultAuthListRunner(binary: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        binary,
        ["auth", "list", "--format", "json", "--standalone"],
        { env, encoding: "utf8", timeout: AUTH_LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => resolve(error || typeof stdout !== "string" ? null : stdout),
      );
      child.stdin?.end();
    } catch {
      resolve(null);
    }
  });
}

export interface ReadStoredAuthOptions {
  /** Executable to ask (the `opencode.binaryPath` setting); default `opencode`. */
  readonly binaryPath?: string | undefined;
  readonly run?: AuthListRunner | undefined;
  readonly now?: () => number;
  /** Skip the per-process cache (tests). */
  readonly fresh?: boolean;
}

const authCache = new Map<string, { at: number; value: Record<string, string> }>();

/** Drop cached auth lists (after a login, and between tests). */
export function clearStoredAuthCache(): void {
  authCache.clear();
}

/**
 * Stored OpenCode credentials per provider id, from v2's own
 * `opencode auth list --format json --standalone` (v2 keeps credentials in SQLite, so
 * `auth.json` is a stub). Output is `[{id, name, connections: [{type, name?}]}]`
 * — type and env-var name only, never a secret. Connection types map onto
 * the v1 vocabulary consumers already read: `key`→`api`, `oauth`→`oauth`,
 * `env`→`env` (a key found in the environment); an unknown type passes
 * through. Several connections: `oauth` wins, then `api`, then the rest.
 * Cached per process for a short TTL, bounded by a timeout, and any failure
 * (no binary, no service, bad JSON) reads as "no stored auth", never an
 * error — listing must degrade, not fail.
 */
export async function readStoredAuthTypes(
  env: NodeJS.ProcessEnv = process.env,
  options: ReadStoredAuthOptions = {},
): Promise<Record<string, string>> {
  const binary = options.binaryPath?.trim() || OPENCODE_DEFAULT_BINARY;
  const now = (options.now ?? Date.now)();
  const cacheKey = `${binary}\0${env.PATH ?? env.Path ?? ""}`;
  const cached = options.fresh ? undefined : authCache.get(cacheKey);
  if (cached && now - cached.at < AUTH_LIST_CACHE_TTL_MS) return { ...cached.value };
  const text = await (options.run ?? defaultAuthListRunner)(binary, env);
  const value = text === null ? {} : authTypesOf(parseJson(text));
  if (!options.fresh) authCache.set(cacheKey, { at: now, value });
  return { ...value };
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

const AUTH_TYPE_RANK: Readonly<Record<string, number>> = { oauth: 0, api: 1 };

function mapConnectionType(type: string): string {
  return type === "key" ? "api" : type;
}

/**
 * Credential types per provider from a list of `{id, connections: [{type}]}`
 * entries: the output of `opencode auth list --format json`, and equally the
 * `data` of `GET /api/integration`, where a stored credential is
 * `{type: "credential", method: "key" | "oauth"}` and an env key `{type: "env"}`.
 */
export function authTypesOf(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const entry of raw) {
    const record = asRecord(entry);
    const id = record ? asString(record.id) : null;
    const connections = record?.connections;
    if (!id || !Array.isArray(connections)) continue;
    const types = connections
      .flatMap((connection) => {
        const record = asRecord(connection);
        const kind = asString(record?.type);
        const type = kind === "credential" ? asString(record?.method) : kind;
        return type ? [mapConnectionType(type)] : [];
      })
      .sort((a, b) => (AUTH_TYPE_RANK[a] ?? 2) - (AUTH_TYPE_RANK[b] ?? 2));
    if (types[0] !== undefined) out[id] = types[0];
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
      headers: { "User-Agent": "moxen/models-dev-snapshot" },
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
