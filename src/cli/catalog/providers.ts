import { resolveBackendKind } from "../../backend/backend.js";
import { discoverRuntime } from "../infra/runtime.js";
import { buildDirectProviders } from "./direct.js";
import { withWsRpc } from "./t3ws.js";
import {
  extractProviders,
  selectModel,
  selectProvider,
  type ProviderSummary,
} from "./catalog.js";
import type { CliConfig } from "../../types.js";

export async function listProviders(config: CliConfig, options: { refresh?: boolean }) {
  // Direct backends never touch the T3 server: no runtime discovery (which
  // would boot the desktop), no WS RPC. Envelopes keep their shape; only
  // the values say `direct` instead of naming a T3 origin/version.
  if (resolveBackendKind() === "direct") {
    return {
      runtime: {
        origin: "direct",
        stateDir: null,
        runtimeStatePath: null,
        settingsPath: null,
        environmentId: "direct",
        serverVersion: "direct",
        capabilities: {},
      },
      auth: { source: "path" as const, version: null },
      refreshed: true,
      providers: await buildDirectProviders(),
    };
  }
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  return await withWsRpc(runtime, config, async (call, invocation) => {
    // `server.refreshProviders` reports fresh provider/model status but carries
    // no `settings`, so it alone would make every model report `isHidden: false`
    // after a refresh. Pair it with `server.getConfig` for the hidden-model
    // preferences and merge, so `--refresh` doesn't silently lose that field.
    const response = options.refresh === true
      ? await Promise.all([call("server.refreshProviders", {}), call("server.getConfig", {})]).then(
          ([refreshed, current]) => ({
            providers: (refreshed as { providers?: unknown }).providers,
            settings: (current as { settings?: unknown }).settings,
          }),
        )
      : await call("server.getConfig", {});
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      refreshed: options.refresh === true,
      providers: extractProviders(response),
    };
  });
}

export async function listModels(
  config: CliConfig,
  options: { provider?: string; refresh?: boolean },
) {
  const { runtime, auth, refreshed, providers } = await listProviders(config, {
    ...(options.refresh === true ? { refresh: true } : {}),
  });
  const scoped: readonly ProviderSummary[] = options.provider === undefined
    ? providers
    : [selectProvider(providers, options.provider)];
  return {
    runtime,
    auth,
    refreshed,
    providers: scoped.map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      displayName: provider.displayName,
      enabled: provider.enabled,
      models: provider.models,
    })),
  };
}

export async function listEfforts(
  config: CliConfig,
  options: { provider: string; model: string; refresh?: boolean },
) {
  const { runtime, auth, refreshed, providers } = await listProviders(config, {
    ...(options.refresh === true ? { refresh: true } : {}),
  });
  const provider = selectProvider(providers, options.provider);
  const model = selectModel(provider, options.model);
  return {
    runtime,
    auth,
    refreshed,
    provider: { instanceId: provider.instanceId, driver: provider.driver },
    model: { slug: model.slug, name: model.name, efforts: model.efforts },
  };
}
