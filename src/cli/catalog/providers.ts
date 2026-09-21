import { buildDirectProviders } from "./direct.js";
import { selectModel, selectProvider, type ProviderSummary } from "./catalog.js";
import type { CliConfig } from "../../types.js";
import { directAuth, directRuntime } from "../infra/direct.js";

export async function listProviders(config: CliConfig, options: { refresh?: boolean }) {
  void config;
  void options;
  // No server, no runtime discovery, no WS RPC. Every call probes live
  // sources; failures degrade into each entry's `status`.
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    refreshed: true,
    providers: await buildDirectProviders(),
  };
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
