/**
 * Grok usage: a billing probe against the CLI chat proxy, plus generic
 * retry/backoff T3 never had. The probe reads the OAuth credential for the
 * Grok-CLI client id out of `~/.grok/auth.json` (never an arbitrary account)
 * and maps `creditUsagePercent` + the current period to a single
 * `subscription` window. API-key and custom deployments report unavailable.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface GrokBillingWindow {
  readonly id: "subscription";
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  readonly exhausted: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Map the billing response body; null when it carries no usable percent. */
export function mapGrokBilling(body: unknown): GrokBillingWindow | null {
  const config = asRecord(asRecord(body)?.["config"]);
  const percent = num(config?.["creditUsagePercent"]);
  if (percent === null) return null;
  const period = asRecord(config?.["currentPeriod"]);
  const periodType = (typeof period?.["type"] === "string" ? (period["type"] as string) : "").replace(
    /^USAGE_PERIOD_TYPE_/,
    "",
  );
  const kind = periodType === "WEEKLY" ? "weekly" : periodType === "MONTHLY" ? "monthly" : "other";
  const label = kind === "weekly" ? "Weekly" : kind === "monthly" ? "Monthly" : "Subscription";
  const end = typeof period?.["end"] === "string" ? (period["end"] as string) : null;
  const resetsAt = end && Number.isFinite(Date.parse(end)) ? new Date(Date.parse(end)).toISOString() : null;
  return {
    id: "subscription",
    label,
    usedPercent: Math.min(100, Math.max(0, percent)),
    resetsAt,
    exhausted: percent >= 100,
  };
}

const CUSTOM_DEPLOYMENT_ENV = [
  "GROK_OIDC_ISSUER",
  "GROK_OIDC_CLIENT_ID",
  "GROK_OAUTH2_ISSUER",
  "GROK_OAUTH2_CLIENT_ID",
  "GROK_OAUTH2_PRINCIPAL_TYPE",
  "GROK_OAUTH2_PRINCIPAL_ID",
  "GROK_AUTH_PROVIDER_COMMAND",
  "GROK_LOCAL_AUTH",
  "GROK_CLI_CHAT_PROXY_BASE_URL",
  "GROK_MODELS_BASE_URL",
  "GROK_CONFIG",
  "GROK_CONFIG_PATH",
];

const GROK_HOME_CANDIDATES = ["GROK_HOME"];
const OAUTH_CLIENT_KEY = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const SIGNIN_KEY = "https://accounts.x.ai/sign-in";
const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

export interface GrokBillingProbeInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly readFile?: (path: string) => Promise<string>;
  readonly fetchFn?: typeof fetch;
}

function grokHome(env: NodeJS.ProcessEnv): string {
  for (const name of GROK_HOME_CANDIDATES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  const base = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(base, ".grok");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Probe the subscription window. Returns null when limits don't apply
 * (API key, custom deployments, missing credentials) or the probe fails.
 */
export async function probeGrokBilling(input: GrokBillingProbeInput = {}): Promise<GrokBillingWindow | null> {
  const env = input.env ?? process.env;
  if (env.XAI_API_KEY?.trim()) return null;
  if (CUSTOM_DEPLOYMENT_ENV.some((name) => env[name]?.trim())) return null;
  const read = input.readFile ?? ((file: string) => readFile(file, "utf8"));
  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxRetries = input.maxRetries ?? 2;

  let contents: string;
  if (env.GROK_AUTH?.trim()) {
    contents = env.GROK_AUTH.trim();
  } else {
    try {
      contents = await read(path.join(grokHome(env), "auth.json"));
    } catch {
      return null;
    }
  }
  let credentials: unknown;
  try {
    credentials = JSON.parse(contents) as unknown;
  } catch {
    return null;
  }
  const accounts = asRecord(credentials);
  const credential =
    asRecord(accounts?.[OAUTH_CLIENT_KEY]) ?? asRecord(accounts?.[SIGNIN_KEY]) ?? null;
  if (credential?.["auth_mode"] === "api_key") return null;
  const token = typeof credential?.["key"] === "string" ? (credential["key"] as string).trim() : "";
  if (!token) return null;

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(BILLING_URL, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt >= maxRetries) return null;
        attempt += 1;
        await sleep(500 * attempt * 3);
        continue;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as unknown;
      return mapGrokBilling(body);
    } catch {
      if (attempt >= maxRetries) return null;
      attempt += 1;
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}
