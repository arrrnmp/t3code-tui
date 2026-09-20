/**
 * Codex settings + home/auth resolution. Own code shaped by T3's
 * `Layers/codexLaunchArgs.ts`, `Drivers/CodexHomeLayout.ts`, and
 * `Drivers/CodexDriver.ts`.
 *
 * Rules we keep: no own auth — the CLI's `auth.json` under `CODEX_HOME`
 * is reused as-is (Stage 3 uses the shared home directly; per-account
 * shadow homes are a follow-up). Unauthenticated → `codex login`.
 * Account types surfaced: apiKey | amazonBedrock | chatgpt.
 */
import os from "node:os";
import path from "node:path";

import { expandHome } from "../../config.js";

export type CodexAccountType = "apiKey" | "amazonBedrock" | "chatgpt" | "unknown";

export interface CodexSettings {
  readonly binaryPath: string;
  readonly homePath: string;
  /** Raw launch args string; tokenized for `codex app-server`. */
  readonly launchArgs: string;
}

export const DEFAULT_CODEX_SETTINGS: CodexSettings = {
  binaryPath: "codex",
  homePath: "",
  launchArgs: "",
};

export function normalizeCodexSettings(raw: Partial<CodexSettings> = {}): CodexSettings {
  return {
    binaryPath: raw.binaryPath?.trim() || DEFAULT_CODEX_SETTINGS.binaryPath,
    homePath: raw.homePath?.trim() ?? "",
    launchArgs: raw.launchArgs?.trim() ?? "",
  };
}

/** Minimal shell-ish tokenizer (single/double quotes + backslash escapes). */
export function tokenizeLaunchArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let pushed = false;
  const flush = (): void => {
    if (current.length > 0 || pushed) args.push(current);
    current = "";
    pushed = false;
  };
  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      pushed = true;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return args;
}

const LAUNCH_ARGS_ENV = "T3CODE_CODEX_LAUNCH_ARGS";

export function codexAppServerArgs(
  launchArgs = "",
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env[LAUNCH_ARGS_ENV]?.trim() || launchArgs.trim();
  return ["app-server", ...tokenizeLaunchArgs(raw)];
}

/** `homePath` → dir, else `CODEX_HOME`, else `~/.codex`. */
export function resolveCodexHome(
  homePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = homePath.trim();
  if (trimmed.length > 0) return path.resolve(expandHome(trimmed));
  const fromEnv = env.CODEX_HOME?.trim() ?? "";
  if (fromEnv.length > 0) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".codex");
}

const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /not logged in/i,
  /login required/i,
  /no .*auth/i,
  /auth\.json/i,
  /unauthorized/i,
  /invalid api key/i,
  /\b401\b/,
];

export function isCodexAuthErrorText(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function codexSignedOutMessage(input: { home: string }): string {
  return (
    "Codex could not authenticate. Run `codex login` on this environment's machine " +
    `(CODEX_HOME ${JSON.stringify(input.home)}), then start a new thread. ` +
    "API-key and Bedrock accounts authenticate through the CLI's own auth.json."
  );
}

export function codexAccountTypeOf(value: unknown): CodexAccountType {
  const record = value as Record<string, unknown> | null;
  const raw =
    typeof record?.["accountType"] === "string"
      ? (record["accountType"] as string)
      : typeof record?.["type"] === "string"
        ? (record["type"] as string)
        : "";
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.includes("bedrock")) return "amazonBedrock";
  if (normalized.includes("chatgpt")) return "chatgpt";
  if (normalized.includes("apikey") || normalized.includes("api")) return "apiKey";
  return "unknown";
}
