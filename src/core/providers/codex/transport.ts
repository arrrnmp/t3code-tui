/**
 * Codex transport seam: spawning `codex app-server` is injected, so tests
 * run a scripted peer over a linked pair instead of a real CLI. Only the
 * default spawner touches `node:child_process` (via the shared peer).
 */
import { JsonRpcPeer, nodeProcessSpawner, type ProcessSpawner } from "../stdio.js";
import { codexAppServerArgs, resolveCodexHome, type CodexSettings } from "./config.js";

export interface CodexSpawnOptions {
  readonly settings: CodexSettings;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly spawner?: ProcessSpawner;
}

export interface CodexTransport {
  startPeer(options: CodexSpawnOptions): JsonRpcPeer;
}

export class SpawnCodexTransport implements CodexTransport {
  startPeer(options: CodexSpawnOptions): JsonRpcPeer {
    const spawner = options.spawner ?? nodeProcessSpawner();
    const baseEnv = options.env ?? process.env;
    const home = resolveCodexHome(options.settings.homePath, baseEnv);
    const child = spawner.spawn(options.settings.binaryPath, codexAppServerArgs(options.settings.launchArgs, baseEnv), {
      cwd: options.cwd,
      env: { ...baseEnv, CODEX_HOME: home },
    });
    // One app-server per session; the peer owns its lifetime.
    return new JsonRpcPeer(child, { forceKillAfterMs: 2000 });
  }
}
