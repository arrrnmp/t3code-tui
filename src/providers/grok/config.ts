/**
 * Grok settings + spawn/auth resolution. Own code shaped by T3's
 * `acp/GrokAcpSupport.ts` (spawn argv per mode, referrer env, auth switch).
 *
 * Rules we keep: per-mode argv (`approval-required→--permission-mode
 * default`, `full-access→--always-approve`), `GROK_OAUTH2_REFERRER=t3code`
 * injected, auth switch (`XAI_API_KEY` set → `xai.api_key`, else the CLI's
 * `cached_token`) — never our own OAuth. Unauthenticated → `grok login`.
 * The `grok-build` slug means "the CLI's current model" and is never sent
 * over the wire.
 */
import type { RuntimeMode } from "../../types.js";

export interface GrokSettings {
  readonly binaryPath: string;
}

export const DEFAULT_GROK_SETTINGS: GrokSettings = {
  binaryPath: "grok",
};

export function normalizeGrokSettings(raw: Partial<GrokSettings> = {}): GrokSettings {
  return { binaryPath: raw.binaryPath?.trim() || DEFAULT_GROK_SETTINGS.binaryPath };
}

export const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
export const GROK_REFERRER = "t3code";
export const GROK_API_KEY_ENV = "XAI_API_KEY";
export const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
export const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";

export const GROK_DEFAULT_MODEL_SLUG = "grok-build";

/** Per-mode argv for `grok agent stdio` (mirrors grokAcpSpawnArgs). */
export function grokAcpSpawnArgs(runtimeMode?: RuntimeMode): string[] {
  switch (runtimeMode) {
    case "approval-required":
      return ["--permission-mode", "default", "agent", "stdio"];
    case "auto-accept-edits":
      return ["--permission-mode", "acceptEdits", "agent", "stdio"];
    case "auto":
      return ["--permission-mode", "auto", "agent", "stdio"];
    case "full-access":
      return ["agent", "--always-approve", "stdio"];
    default:
      return ["agent", "stdio"];
  }
}

export function makeGrokEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...baseEnv, [GROK_OAUTH2_REFERRER_ENV]: GROK_REFERRER };
}

export function resolveGrokAuthMethod(environment: NodeJS.ProcessEnv = process.env): string {
  return environment[GROK_API_KEY_ENV]?.trim() ? GROK_AUTH_METHOD_API_KEY : GROK_AUTH_METHOD_CACHED_TOKEN;
}

/** `grok-build` (or blank) keeps the session model; anything else is sent. */
export function resolveGrokModelId(model: string | null | undefined): string | null {
  const trimmed = model?.trim() ?? "";
  if (!trimmed || trimmed === GROK_DEFAULT_MODEL_SLUG) return null;
  return trimmed;
}

const REASONING_EFFORT_TOKEN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

export function normalizeGrokReasoningEffort(value: string | undefined): string | undefined {
  const effort = value?.trim() ?? "";
  return effort && REASONING_EFFORT_TOKEN.test(effort) ? effort : undefined;
}

const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /not logged in/i,
  /login required/i,
  /unauthorized/i,
  /invalid.*token/i,
  /token.*expir/i,
  /expir/i,
  /\b401\b/,
];

export function isGrokAuthErrorText(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function grokSignedOutMessage(): string {
  return (
    "Grok could not authenticate. Run `grok login` on this environment's machine, " +
    "then start a new thread. API-key deployments authenticate via XAI_API_KEY."
  );
}
