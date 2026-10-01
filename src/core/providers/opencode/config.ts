/**
 * OpenCode driver settings: own the serve spawn, never the auth.
 *
 * Auth is the `opencode` CLI's own: `opencode auth login` for OAuth (v2 has
 * built-in ChatGPT Pro/Plus, `opencode auth login openai`, and SuperGrok,
 * `opencode auth login xai`, logins), provider API keys via env. We spawn
 * `opencode serve` ourselves and always give it a password, because v2 puts
 * every `/api/*` route behind HTTP Basic auth. Version gating keeps the API
 * surface we call (OpenCode v2, `@opencode/client`) in reach.
 * See the providers table in ARCHITECTURE.md.
 */
import { randomBytes } from "node:crypto";

export const OPENCODE_DEFAULT_BINARY = "opencode";
export const OPENCODE_MIN_VERSION = "2.0.0";
/** The line `opencode serve` prints once it accepts connections (v1 prefixed it with `opencode `). The terminating whitespace keeps a chunk split mid-URL from matching. */
export const OPENCODE_SERVER_READY_PATTERN = /server listening on (https?:\/\/\S+)\s/;
export const OPENCODE_SERVER_START_TIMEOUT_MS = 30_000;
export const OPENCODE_DEFAULT_HOSTNAME = "127.0.0.1";

export interface OpencodeSettings {
  readonly binaryPath: string;
  /** Blank = spawn a server per working directory; set = use an external one. */
  readonly serverUrl: string;
  /** Password for an external server (never inherited from env there). */
  readonly serverPassword: string;
  readonly minVersion: string;
}

export function normalizeOpencodeSettings(raw: Partial<OpencodeSettings> = {}): OpencodeSettings {
  const binaryPath = raw.binaryPath?.trim() ? raw.binaryPath.trim() : OPENCODE_DEFAULT_BINARY;
  return {
    binaryPath,
    serverUrl: raw.serverUrl?.trim() ?? "",
    serverPassword: raw.serverPassword ?? "",
    minVersion: raw.minVersion?.trim() ? raw.minVersion.trim() : OPENCODE_MIN_VERSION,
  };
}

/**
 * Password for a *spawned* server, never empty: the explicit setting wins,
 * else the env the server itself honors (`OPENCODE_PASSWORD`, then
 * `OPENCODE_SERVER_PASSWORD`), else a fresh random one. v2 always
 * authenticates, and without one it invents a password and prints it on
 * stdout, which we would then have to scrape. External servers never inherit
 * the env password — leaking an ambient secret to a URL we didn't spawn would
 * be a confused-deputy grant.
 */
export function resolveSpawnedServerPassword(
  settings: OpencodeSettings,
  env: NodeJS.ProcessEnv,
  generate: () => string = () => randomBytes(32).toString("base64url"),
): string {
  if (settings.serverPassword.trim().length > 0) return settings.serverPassword;
  for (const name of ["OPENCODE_PASSWORD", "OPENCODE_SERVER_PASSWORD"] as const) {
    const value = env[name];
    if (value !== undefined && value.trim().length > 0) return value;
  }
  return generate();
}

/**
 * The `OPENCODE_CONFIG_CONTENT` for a spawned server: the user's own content
 * plus `share: "disabled"` and `update: "disable"` (we never share sessions or
 * let the server update itself under us). Every other user key is kept as is.
 * Permissions are deliberately not injected: v2's default (allow all) matches
 * what moxen has always run with.
 * Unparseable content is replaced, not merged — a corrupt config would
 * break the server boot either way, and replacing keeps the failure
 * legible at our layer instead of deep in the server.
 */
export function buildServerConfigContent(existing: string | undefined): string {
  let parsed: Record<string, unknown> = {};
  if (existing && existing.trim().length > 0) {
    try {
      const decoded = JSON.parse(existing) as unknown;
      if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
        parsed = decoded as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }
  return JSON.stringify({ ...parsed, share: "disabled", update: "disable" });
}

export function parseSemver(raw: string): [number, number, number] | null {
  const match = raw.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `have < want`. Unparseable `have` reads as too old. */
export function compareSemver(have: string, want: string): number {
  const parsedHave = parseSemver(have);
  const parsedWant = parseSemver(want);
  if (!parsedHave) return -1;
  if (!parsedWant) return 0;
  for (let index = 0; index < 3; index += 1) {
    const delta = (parsedHave[index] ?? 0) - (parsedWant[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

const AUTH_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /401/,
  /unauthorized/i,
  /not authenticated/i,
  /invalid api key/i,
  /authentication required/i,
];

export function isOpencodeAuthErrorText(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function opencodeSignedOutMessage({ cwd }: { cwd: string }): string {
  return (
    `OpenCode is not authenticated for ${cwd}. ` +
    `Run \`opencode auth login\` (or set the provider API key), then retry. ` +
    `ChatGPT Pro/Plus (\`opencode auth login openai\`) and SuperGrok (\`opencode auth login xai\`) ` +
    `subscriptions are built in once connected.`
  );
}
