/**
 * OpenCode driver settings: own the serve spawn, never the auth.
 *
 * Auth is the `opencode` CLI's own (`opencode auth login` for OAuth,
 * provider API keys via env) plus our two vendored subscription plugins
 * (`plugins/xai.ts`, `plugins/codex.ts`), which the spawned server loads
 * through `OPENCODE_CONFIG_CONTENT`. Version gating mirrors T3's
 * `MINIMUM_OPENCODE_VERSION` so the SDK surface we call exists.
 * See DECOUPLE.md §8.
 */
import { fileURLToPath } from "node:url";

export const OPENCODE_DEFAULT_BINARY = "opencode";
export const OPENCODE_MIN_VERSION = "1.14.19";
export const OPENCODE_SERVER_READY_PREFIX = "opencode server listening";
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
 * Password for a *spawned* server: explicit setting wins, else the env
 * convention the server itself honors. External servers never inherit the
 * env password (T3's `resolveOpenCodeServerPassword` rule) — leaking a
 * ambient secret to a URL we didn't spawn would be a confused-deputy grant.
 */
export function resolveSpawnedServerPassword(settings: OpencodeSettings, env: NodeJS.ProcessEnv): string {
  if (settings.serverPassword.trim().length > 0) return settings.serverPassword;
  return env.OPENCODE_SERVER_PASSWORD ?? "";
}

/** Absolute paths of the vendored auth plugins to inject into the server. */
export function resolveVendoredPluginPaths(): string[] {
  // `tsc` emits sibling `.js` for these `.ts` sources, so resolve with the
  // calling module's own extension: `.ts` under bun/vitest, `.js` in dist.
  const ext = new URL(import.meta.url).pathname.endsWith(".ts") ? "xai.ts" : "xai.js";
  const codex = new URL(import.meta.url).pathname.endsWith(".ts") ? "codex.ts" : "codex.js";
  return [
    fileURLToPath(new URL(`./plugins/${ext}`, import.meta.url)),
    fileURLToPath(new URL(`./plugins/${codex}`, import.meta.url)),
  ];
}

/**
 * Merge plugin paths into an `OPENCODE_CONFIG_CONTENT` JSON object without
 * clobbering anything the user configured (T3's must-not-clobber rule).
 * Unparseable content is replaced, not merged — a corrupt config would
 * break the server boot either way, and replacing keeps the failure
 * legible at our layer instead of deep in the server.
 */
export function buildServerConfigContent(
  existing: string | undefined,
  pluginPaths: ReadonlyArray<string>,
): string {
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
  const current = Array.isArray(parsed.plugin) ? parsed.plugin.filter((entry) => typeof entry === "string") : [];
  const merged = [...current];
  for (const pluginPath of pluginPaths) {
    if (!merged.includes(pluginPath)) merged.push(pluginPath);
  }
  return JSON.stringify({ ...parsed, plugin: merged });
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
    `ChatGPT Plus/Pro and SuperGrok subscriptions work through the bundled plugins once connected.`
  );
}
