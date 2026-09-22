/**
 * Plugin entry module for the vendored xAI auth plugin.
 *
 * `opencode serve` loads file plugins through `getLegacyPlugins`
 * (`packages/opencode/src/plugin/index.ts:99-124`), which walks
 * `Object.values(mod)` and calls *every* export as
 * `server(input, options)`, pushing whatever comes back into the shared
 * `hooks[]`. Upstream's own `plugin/xai.ts` never goes through that path
 * — it is imported directly — so its test helpers (`requestDeviceCode`,
 * `accessTokenIsExpiring`, …) are harmless there and fatal here: one
 * helper returns a non-hook (`false`), which then breaks every later
 * `hook.config?.()` / `hook.event?.()` / prompt dispatch with
 * `undefined is not an object`, and another throws, aborting the loop
 * before the real plugin registers. The server survives boot and then
 * fails every `prompt_async` in a fiber we never see — the silent stall.
 *
 * So the file we hand the server exports exactly one thing: the factory.
 * Keep it that way (`tests/entry.test.ts` enforces it) and keep the
 * vendored sources byte-faithful to upstream behind it.
 */
export { XaiAuthPlugin } from "./xai.js";
