/**
 * The `getConfig` wire payload.
 *
 * This lived in the CLI's catalog module, which meant `server/` imported a
 * client to answer its own contract call — the inverted edge that let the
 * layering drift in the first place. The *builder* is domain logic and
 * moved to `core/catalog/direct.ts`; only this reshaping step is server
 * business, because only `ClientApi.getConfig` has this shape.
 */
import type { ProviderSummary } from "../core/catalog/summary.js";
import type { ConfigPayload } from "./protocol.js";

/**
 * Translate direct summaries into the `server.getConfig` payload shape so
 * the TUI's `extractProviders` keeps working unmodified — including
 * effort descriptors, which become `capabilities.optionDescriptors`.
 * Hidden-model preferences have no direct equivalent yet: nothing is
 * hidden. Consumed by `server/connection.ts` `getConfig`.
 */
export function toWsConfigPayload(providers: ReadonlyArray<ProviderSummary>): ConfigPayload {
  return {
    providers: providers.map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      displayName: provider.displayName,
      enabled: provider.enabled,
      installed: provider.installed,
      status: provider.status,
      auth: { status: provider.authStatus },
      models: provider.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        isCustom: model.isCustom,
        isDefault: model.isDefault,
        capabilities: {
          optionDescriptors: model.efforts.map((effort) => ({
            id: effort.id,
            label: effort.label,
            type: "select" as const,
            options: effort.choices.map((choice) => ({
              id: choice.id,
              label: choice.label,
              isDefault: choice.isDefault,
            })),
            currentValue: effort.currentValue,
          })),
        },
      })),
      supportedRuntimeModes: provider.supportedRuntimeModes,
      usageLimits: provider.usageLimits,
      skills: provider.skills,
    })),
    settings: {},
  };
}
