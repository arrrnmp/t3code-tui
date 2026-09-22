/**
 * Direct-backend envelope stubs. Every CLI command used to report the
 * runtime it talked to (`RuntimeEnvelope`) and the invocation its bearer came
 * from (`auth`). With no server there is no bearer and no origin, but the
 * envelope keys stay so `--json` consumers keep parsing: values say
 * `direct` instead of naming a remote origin/version.
 */
import type { RuntimeEnvelope } from "../../core/types.js";

export function directRuntime(): RuntimeEnvelope {
  return {
    origin: "direct",
    stateDir: null,
    runtimeStatePath: null,
    settingsPath: null,
    environmentId: "direct",
    serverVersion: "direct",
    capabilities: { threadSettlement: true },
  };
}

export function directAuth(): { source: "direct"; version: null } {
  return { source: "direct", version: null };
}
