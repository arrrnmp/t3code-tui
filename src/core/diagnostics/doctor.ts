/**
 * What `moxen doctor` reports about the machine that runs provider
 * sessions: provider binaries with versions, git, the thread store, and
 * stored OpenCode credentials (their *presence* and type — never their
 * contents; read through `opencode auth list`, since v2 keeps them in SQLite).
 *
 * It runs where the sessions run: in-process for a direct client, on the
 * shared server otherwise. That is why it is a server query rather than
 * CLI code — with a server, the CLI's own machine is the wrong one to ask.
 */
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { commandExists, runProcess } from "../infra/process.js";
import { readStoredAuthTypes } from "../providers/opencode/catalog.js";
import { compareSemver, OPENCODE_MIN_VERSION } from "../providers/opencode/config.js";

export interface ProviderCheck {
  readonly ok: boolean;
  readonly installed: boolean;
  readonly version: string | null;
  readonly login: string;
  /** Set when the provider has a version floor (OpenCode: v2+). */
  readonly minVersion?: string;
}

/** The `x.y.z` in a `--version` line such as `opencode v2.0.19`, or null. */
export function parseVersionNumber(line: string | null): string | null {
  return line?.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

/** Whether a `--version` line meets `minVersion`; unparseable reads as too old. */
export function meetsMinVersion(line: string | null, minVersion: string): boolean {
  const version = parseVersionNumber(line);
  return version !== null && compareSemver(version, minVersion) >= 0;
}

export interface Diagnosis {
  readonly node: { readonly ok: true; readonly version: string };
  readonly git: { readonly ok: boolean };
  readonly providers: {
    readonly claude: ProviderCheck;
    readonly codex: ProviderCheck;
    readonly opencode: ProviderCheck;
    readonly grok: ProviderCheck;
  };
  readonly store: { readonly ok: boolean; readonly path: string };
  readonly auth: {
    readonly ok: boolean;
    /** Where v2 keeps credentials: the `opencode.db` under the XDG data dir. */
    readonly path: string;
    readonly providers: readonly string[];
    /** Credential type per provider (`api` | `oauth` | `env`), from `opencode auth list`. */
    readonly types: Readonly<Record<string, string>>;
  };
}

async function probeProvider(binary: string, login: string, minVersion?: string): Promise<ProviderCheck> {
  const installed = await commandExists(binary);
  if (!installed) return { ok: false, installed, version: null, login };
  try {
    const result = await runProcess(binary, ["--version"], { timeoutMs: 10_000 });
    const firstLine = result.stdout.split("\n")[0]?.trim() ?? "";
    const version = firstLine.length > 0 ? firstLine.slice(0, 80) : null;
    if (minVersion === undefined) return { ok: true, installed, version, login };
    return { ok: meetsMinVersion(version, minVersion), installed, version, login, minVersion };
  } catch {
    return { ok: false, installed, version: null, login };
  }
}

/**
 * `opencodeBinaryPath`: the `opencode` executable to probe and ask for stored
 * credentials. No setting feeds it today (the driver is built with defaults
 * too), so callers pass nothing and `opencode` on PATH is used.
 */
export async function diagnose(storeRoot: string, opencodeBinaryPath?: string): Promise<Diagnosis> {
  const [git, claude, codex, opencode, grok] = await Promise.all([
    commandExists("git"),
    probeProvider("claude", "inherit from `claude auth login`"),
    probeProvider("codex", "inherit from `codex login`"),
    probeProvider(
      opencodeBinaryPath ?? "opencode",
      "`opencode auth login` (openai, xai and more built in) or provider API keys",
      OPENCODE_MIN_VERSION,
    ),
    probeProvider("grok", "inherit from `grok login`"),
  ]);
  const storeWritable = await access(path.dirname(storeRoot), constants.W_OK)
    .then(() => true)
    .catch(() => false);
  const types = opencode.installed ? await readStoredAuthTypes(process.env, { binaryPath: opencodeBinaryPath }) : {};
  const authProviders = Object.keys(types).sort();
  // v2 keeps credentials in SQLite; auth.json is an empty stub.
  const dataDir = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  return {
    node: { ok: true, version: process.version },
    git: { ok: git },
    providers: { claude, codex, opencode, grok },
    store: { ok: storeWritable, path: storeRoot },
    auth: { ok: authProviders.length > 0, path: path.join(dataDir, "opencode", "opencode.db"), providers: authProviders, types },
  };
}
