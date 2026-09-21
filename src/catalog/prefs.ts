/**
 * Model preferences: favorites, per-instance hidden slugs, and ordering.
 * Mirrors the T3 desktop shape (`favorites: [{provider, model}]`,
 * `providerModelPreferences: {instance: {hiddenModels, modelOrder}}`)
 * so a first run can import them; afterwards this file is the source of
 * truth. Lives in the store root (`model-prefs.json`) so test stores stay
 * hermetic. Reads never throw — listing must degrade, not fail.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ModelFavorite {
  readonly instanceId: string;
  readonly model: string;
}

export interface ModelPrefs {
  readonly favorites: ReadonlyArray<ModelFavorite>;
  readonly hidden: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly order: Readonly<Record<string, ReadonlyArray<string>>>;
}

export function emptyModelPrefs(): ModelPrefs {
  return { favorites: [], hidden: {}, order: {} };
}

export function prefsFile(storeRoot: string): string {
  return path.join(storeRoot, "model-prefs.json");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function parsePrefs(raw: unknown): ModelPrefs | null {
  const root = asRecord(raw);
  if (!root) return null;
  const favorites = Array.isArray(root.favorites)
    ? root.favorites.flatMap((entry) => {
      const row = asRecord(entry);
      const instanceId = row ? asString(row.instanceId) : null;
      const model = row ? asString(row.model) : null;
      return instanceId && model ? [{ instanceId, model }] : [];
    })
    : [];
  const hidden: Record<string, string[]> = {};
  const order: Record<string, string[]> = {};
  const hiddenRoot = asRecord(root.hidden);
  if (hiddenRoot) {
    for (const [key, value] of Object.entries(hiddenRoot)) {
      const slugs = asStringArray(value);
      if (slugs.length > 0) hidden[key] = slugs;
    }
  }
  const orderRoot = asRecord(root.order);
  if (orderRoot) {
    for (const [key, value] of Object.entries(orderRoot)) {
      const slugs = asStringArray(value);
      if (slugs.length > 0) order[key] = slugs;
    }
  }
  return { favorites, hidden, order };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function loadModelPrefs(storeRoot: string): Promise<ModelPrefs> {
  let text: string;
  try {
    text = await readFile(prefsFile(storeRoot), "utf8");
  } catch {
    return emptyModelPrefs();
  }
  try {
    return parsePrefs(JSON.parse(text) as unknown) ?? emptyModelPrefs();
  } catch {
    return emptyModelPrefs();
  }
}

export async function saveModelPrefs(storeRoot: string, prefs: ModelPrefs): Promise<void> {
  await mkdir(storeRoot, { recursive: true });
  const file = prefsFile(storeRoot);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(prefs, null, 2));
  await rename(tmp, file);
}

export function isModelHidden(prefs: ModelPrefs, instanceId: string, slug: string): boolean {
  return prefs.hidden[instanceId]?.includes(slug) ?? false;
}

function t3HomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.T3CODE_HOME?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".t3");
}

/**
 * One-time import of T3 desktop model curation (`favorites` plus
 * per-instance `hiddenModels`/`modelOrder` from `client-settings.json`).
 * Runs only when our prefs file does not exist yet; always writes the
 * file afterwards (possibly empty) so later reads never re-scan.
 * Best-effort throughout — a missing or corrupt T3 home simply yields an
 * empty import. Returns true when T3 data was found.
 */
export async function ensureImportedFromT3(
  storeRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  try {
    await readFile(prefsFile(storeRoot), "utf8");
    return false;
  } catch {
    // No prefs yet — try the import below.
  }
  const prefs = importT3ClientSettings(await readT3ClientSettings(t3HomeDir(env)));
  await saveModelPrefs(storeRoot, prefs).catch(() => undefined);
  return prefs.favorites.length > 0 || Object.keys(prefs.hidden).length > 0;
}

async function readT3ClientSettings(t3Home: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(t3Home, "userdata", "client-settings.json"), "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function importT3ClientSettings(raw: unknown): ModelPrefs {
  const root = asRecord(raw);
  if (!root) return emptyModelPrefs();
  const favorites = Array.isArray(root.favorites)
    ? root.favorites.flatMap((entry) => {
      const row = asRecord(entry);
      // T3 stores the instance id under `provider` (see contracts
      // settings.ts: the field name is kept for storage stability).
      const instanceId = row ? asString(row.provider) : null;
      const model = row ? asString(row.model) : null;
      return instanceId && model ? [{ instanceId, model }] : [];
    })
    : [];
  const hidden: Record<string, string[]> = {};
  const order: Record<string, string[]> = {};
  const prefs = asRecord(root.providerModelPreferences) ?? {};
  for (const [instanceId, entry] of Object.entries(prefs)) {
    const row = asRecord(entry);
    if (!row) continue;
    const hiddenSlugs = asStringArray(row.hiddenModels);
    if (hiddenSlugs.length > 0) hidden[instanceId] = hiddenSlugs;
    const orderSlugs = asStringArray(row.modelOrder);
    if (orderSlugs.length > 0) order[instanceId] = orderSlugs;
  }
  return { favorites, hidden, order };
}
