import path from "node:path";

import { selectModel, selectProvider, type ProviderSummary } from "../../core/catalog/summary.js";
import type { CliConfig } from "../../core/types.js";
import { cliClient } from "../infra/client.js";
import { directAuth, directRuntime } from "../infra/direct.js";

export async function listProviders(config: CliConfig, options: { refresh?: boolean }) {
  void options;
  // Every call probes live sources; failures degrade into each entry's
  // `status`, so there is never a stale cache to refresh.
  const { providers } = await (await cliClient(config)).query({ type: "providers.list" });
  return { runtime: directRuntime(), auth: directAuth(), refreshed: true, providers: [...providers] };
}

/** Skills and slash commands one provider resolves for a directory (the cwd by default). */
export async function listSkills(config: CliConfig, options: { provider: string; cwd?: string }) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const inventory = await (await cliClient(config)).query({ type: "skills.list", instanceId: options.provider, cwd });
  return { runtime: directRuntime(), auth: directAuth(), provider: options.provider, cwd, ...inventory };
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

/**
 * Hide (or show) one model slug on one provider instance. Hidden models
 * stay selectable when named explicitly and stay visible when a thread
 * already runs on them — they only leave the pickers (`offerableModels`).
 * Writes `model-prefs.json` in the store root.
 */
export async function setModelHidden(
  config: CliConfig,
  options: { provider: string; model: string; hidden: boolean },
) {
  const client = await cliClient(config);
  const { providers } = await client.query({ type: "providers.list" });
  const provider = selectProvider([...providers], options.provider);
  const model = selectModel(provider, options.model);
  const { hidden } = await client.dispatch({
    type: "model.visibility.set",
    instanceId: provider.instanceId,
    model: model.slug,
    hidden: options.hidden,
  });
  return {
    provider: { instanceId: provider.instanceId },
    model: { slug: model.slug, name: model.name },
    hidden,
  };
}
