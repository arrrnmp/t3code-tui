/**
 * Model preferences: favorites, per-instance hidden slugs, and ordering.
 *
 * Lives in the store root (`model-prefs.json`) so test stores stay
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
