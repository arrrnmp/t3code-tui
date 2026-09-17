import { access } from "node:fs/promises";

import { commandExists, resolveT3Invocation } from "./infra/process.js";
import { hasProtocolHandler } from "./infra/platformOpen.js";
import { discoverRuntime, resolveT3Home } from "./infra/runtime.js";
import type { CliConfig } from "./types.js";

export async function doctor(config: CliConfig, configPath: string, configExists: boolean) {
  const [git, invocation, desktopProtocol, exactThreadProtocol, t3HomeExists, runtime] =
    await Promise.all([
      commandExists("git"),
      resolveT3Invocation(config.t3Command).catch((error: unknown) => ({ error })),
      hasProtocolHandler("t3code"),
      hasProtocolHandler("t3"),
      access(resolveT3Home(config))
        .then(() => true)
        .catch(() => false),
      discoverRuntime(config, { startDesktopIfNeeded: false }).catch(() => null),
    ]);

  const invocationResult = "error" in invocation
    ? { available: false, source: null, version: null }
    : { available: true, source: invocation.source, version: invocation.version };
  const checks = {
    node: { ok: true, version: process.version },
    git: { ok: git },
    t3Cli: { ok: invocationResult.available, ...invocationResult },
    t3Home: { ok: t3HomeExists, path: resolveT3Home(config) },
    t3Server: {
      ok: runtime !== null,
      origin: runtime?.origin ?? null,
      environmentId: runtime?.environmentId ?? null,
      version: runtime?.serverVersion ?? null,
    },
    desktopProtocol: { ok: desktopProtocol, scheme: "t3code" },
    exactThreadProtocol: { ok: exactThreadProtocol, scheme: "t3" },
    config: { ok: true, path: configPath, exists: configExists },
  };

  return {
    ok: checks.git.ok && checks.t3Cli.ok && checks.t3Server.ok,
    checks,
  };
}
