/**
 * Doctor, repointed at the direct world (DECOUPLE.md §15.5): provider
 * binaries with versions, the thread store, stored subscription auth —
 * no T3 CLI, no T3 home, no server, no protocol handlers.
 *
 * Envelope evolution note: the outer `{ok, checks}` wrapper stays, but
 * the T3-specific checks (`t3Cli`, `t3Home`, `t3Server`,
 * `desktopProtocol`, `exactThreadProtocol`) are gone — there is nothing
 * left to probe. `providers` reports one row per owned surface and
 * `auth` summarizes the stored OpenCode credentials file.
 */
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readStoredAuthTypes } from "../providers/opencode/catalog.js";
import { resolveStoreRoot } from "../threads/store.js";
import type { CliConfig } from "../types.js";
import { commandExists, runProcess } from "./infra/process.js";

interface ProviderCheck {
  ok: boolean;
  installed: boolean;
  version: string | null;
}

async function probeProvider(binary: string, versionArgs: string[]): Promise<ProviderCheck> {
  const installed = await commandExists(binary);
  if (!installed) return { ok: false, installed, version: null };
  try {
    const result = await runProcess(binary, versionArgs, { timeoutMs: 10_000 });
    const firstLine = result.stdout.split("\n")[0]?.trim() ?? "";
    const version = firstLine.length > 0 ? firstLine.slice(0, 80) : null;
    return { ok: true, installed, version };
  } catch {
    return { ok: false, installed, version: null };
  }
}

export async function doctor(config: CliConfig, configPath: string, configExists: boolean) {
  const [git, claude, codex, opencode, grok] = await Promise.all([
    commandExists("git"),
    probeProvider("claude", ["--version"]),
    probeProvider("codex", ["--version"]),
    probeProvider("opencode", ["--version"]),
    probeProvider("grok", ["--version"]),
  ]);

  const storePath = resolveStoreRoot();
  const storeWritable = await access(path.dirname(storePath), constants.W_OK)
    .then(() => true)
    .catch(() => false);

  const storedAuth = readStoredAuthTypes();
  const authProviders = Object.keys(storedAuth).sort();
  const authFile = process.env.OPENCODE_AUTH_FILE?.trim() ||
    path.join(
      process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"),
      "opencode",
      "auth.json",
    );

  const checks = {
    node: { ok: true, version: process.version },
    git: { ok: git },
    providers: {
      claude: { ...claude, login: "inherit from `claude auth login`" },
      codex: { ...codex, login: "inherit from `codex login`" },
      opencode: { ...opencode, login: "`opencode auth login` or provider API keys" },
      grok: { ...grok, login: "inherit from `grok login`" },
    },
    store: { ok: storeWritable, path: storePath },
    auth: {
      ok: authProviders.length > 0,
      path: authFile,
      providers: authProviders,
    },
    config: { ok: true, path: configPath, exists: configExists },
  };

  return {
    ok:
      checks.git.ok &&
      checks.store.ok &&
      (checks.providers.claude.ok ||
        checks.providers.codex.ok ||
        checks.providers.opencode.ok ||
        checks.providers.grok.ok),
    checks,
  };
}
