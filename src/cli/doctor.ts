/**
 * `moxen doctor`: the server's diagnosis of the machine that runs provider
 * sessions (`core/diagnostics/doctor.ts`, via the `doctor` query), plus
 * the two things only this invocation knows — which config file it read,
 * and whether it is talking to a shared server.
 *
 * Envelope: `{ ok, checks }`, with `checks` keeping its keys and their
 * order (node, git, providers, store, auth, config); `server` is added
 * after them.
 */
import type { CliConfig } from "../core/types.js";
import { serverMode } from "../server/client.js";
import { defaultEndpoint, probe } from "../server/transport/endpoint.js";
import { cliClient } from "./infra/client.js";

export async function doctor(config: CliConfig, configPath: string, configExists: boolean) {
  const endpoint = defaultEndpoint();
  const [diagnosis, running] = await Promise.all([
    (await cliClient(config)).query({ type: "doctor" }),
    probe(endpoint),
  ]);
  const checks = {
    ...diagnosis,
    config: { ok: true, path: configPath, exists: configExists },
    server: { ok: true, mode: serverMode(), endpoint, running },
  };
  const { providers } = checks;
  return {
    ok:
      checks.git.ok &&
      checks.store.ok &&
      (providers.claude.ok || providers.codex.ok || providers.opencode.ok || providers.grok.ok),
    checks,
  };
}
