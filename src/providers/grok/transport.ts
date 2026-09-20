/**
 * Grok transport seam: spawning `grok agent stdio` is injected, so tests
 * run a scripted ACP peer over a linked pair instead of a real CLI.
 */
import { JsonRpcPeer, nodeProcessSpawner, type ProcessSpawner } from "../stdio.js";
import { grokAcpSpawnArgs, makeGrokEnv, type GrokSettings } from "./config.js";
import type { RuntimeMode } from "../../types.js";

export interface GrokSpawnOptions {
  readonly settings: GrokSettings;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly runtimeMode?: RuntimeMode;
  readonly spawner?: ProcessSpawner;
  /** Probe a binary+argv pair without starting a session (version/models). */
  readonly probe?: (command: string, args: readonly string[], options: { timeoutMs: number }) => Promise<string>;
}

export interface GrokTransport {
  startPeer(options: GrokSpawnOptions): JsonRpcPeer;
}

export class SpawnGrokTransport implements GrokTransport {
  startPeer(options: GrokSpawnOptions): JsonRpcPeer {
    const spawner = options.spawner ?? nodeProcessSpawner();
    const child = spawner.spawn(
      options.settings.binaryPath,
      grokAcpSpawnArgs(options.runtimeMode),
      { cwd: options.cwd, env: makeGrokEnv(options.env ?? process.env) },
    );
    return new JsonRpcPeer(child, { forceKillAfterMs: 2000 });
  }
}
