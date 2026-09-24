/**
 * What `moxen doctor` reports about the machine that runs provider
 * sessions: provider binaries with versions, git, the thread store, and
 * stored OpenCode credentials (their *presence* — never their contents).
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

export interface ProviderCheck {
  readonly ok: boolean;
  readonly installed: boolean;
  readonly version: string | null;
  readonly login: string;
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
  readonly auth: { readonly ok: boolean; readonly path: string; readonly providers: readonly string[] };
}

async function probeProvider(binary: string, login: string): Promise<ProviderCheck> {
  const installed = await commandExists(binary);
  if (!installed) return { ok: false, installed, version: null, login };
  try {
    const result = await runProcess(binary, ["--version"], { timeoutMs: 10_000 });
    const firstLine = result.stdout.split("\n")[0]?.trim() ?? "";
    return { ok: true, installed, version: firstLine.length > 0 ? firstLine.slice(0, 80) : null, login };
  } catch {
    return { ok: false, installed, version: null, login };
  }
}

export async function diagnose(storeRoot: string): Promise<Diagnosis> {
  const [git, claude, codex, opencode, grok] = await Promise.all([
    commandExists("git"),
    probeProvider("claude", "inherit from `claude auth login`"),
    probeProvider("codex", "inherit from `codex login`"),
    probeProvider("opencode", "`opencode auth login` or provider API keys"),
    probeProvider("grok", "inherit from `grok login`"),
  ]);
  const storeWritable = await access(path.dirname(storeRoot), constants.W_OK)
    .then(() => true)
    .catch(() => false);
  const authProviders = Object.keys(readStoredAuthTypes()).sort();
  const authFile =
    process.env.OPENCODE_AUTH_FILE?.trim() ||
    path.join(process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"), "opencode", "auth.json");
  return {
    node: { ok: true, version: process.version },
    git: { ok: git },
    providers: { claude, codex, opencode, grok },
    store: { ok: storeWritable, path: storeRoot },
    auth: { ok: authProviders.length > 0, path: authFile, providers: authProviders },
  };
}
