/**
 * Claude settings + executable/env resolution. Own code shaped by T3's
 * `Drivers/ClaudeDriver.ts`, `Drivers/ClaudeExecutable.ts`, and
 * `Drivers/ClaudeHome.ts`.
 *
 * Rules we keep: no own OAuth (settings carry no apiKey — only
 * binaryPath/homePath/launchArgs/autoCompactWindow); inject
 * `CLAUDE_CONFIG_DIR` only, never override `HOME` (breaks macOS keychain
 * OAuth lookup); on Windows resolve npm shims to the real package entry
 * because the SDK spawns shell-less. Signed-out → point at
 * `claude auth login`.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expandHome } from "../../config.js";

export interface ClaudeSettings {
  readonly binaryPath: string;
  readonly homePath: string;
  readonly launchArgs: readonly string[];
  readonly autoCompactWindow: number | null;
}

export const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  binaryPath: "claude",
  homePath: "",
  launchArgs: [],
  autoCompactWindow: null,
};

export function normalizeClaudeSettings(raw: Partial<ClaudeSettings> = {}): ClaudeSettings {
  return {
    binaryPath: raw.binaryPath?.trim() || DEFAULT_CLAUDE_SETTINGS.binaryPath,
    homePath: raw.homePath?.trim() ?? "",
    launchArgs: raw.launchArgs ?? [],
    autoCompactWindow: raw.autoCompactWindow ?? null,
  };
}

const WINDOWS_SHIM_EXTENSIONS: ReadonlySet<string> = new Set([".cmd", ".bat", ".ps1"]);

const NPM_PACKAGE_ENTRY_CANDIDATES: ReadonlyArray<ReadonlyArray<string>> = [
  ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"],
  ["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
];

export interface ExecutableResolutionEnv {
  readonly platform?: NodeJS.Platform;
  readonly pathDirs?: string[];
  readonly pathExts?: string[];
  readonly isFile?: (filePath: string) => boolean;
}

function defaultPathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  // The platform override governs path semantics so win32 emulation works on
  // posix hosts (and vice versa); never use the host `path.delimiter` here.
  const delimiter = platform === "win32" ? ";" : ":";
  return raw.split(delimiter).filter((dir) => dir.length > 0);
}

function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  isFile: (filePath: string) => boolean,
  platform: NodeJS.Platform,
): string | null {
  if (command.includes("/") || command.includes("\\")) {
    return isFile(command) ? command : null;
  }
  const exts = (env.PATHEXT ?? ".EXE").split(";").filter((ext) => ext.length > 0);
  for (const dir of defaultPathDirs(env, platform)) {
    for (const ext of ["", ...exts]) {
      const candidate = path.win32.join(dir, `${command}${ext}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve the configured binary into something the Agent SDK can spawn
 * directly (`pathToClaudeCodeExecutable`). Off Windows the value passes
 * through; on Windows an npm launcher shim is followed to the real
 * package entry (`bin/claude.exe`, else `cli.js`).
 */
export function resolveClaudeExecutable(
  binaryPath: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: ExecutableResolutionEnv = {},
): string {
  const platform = overrides.platform ?? process.platform;
  if (platform !== "win32") return binaryPath;
  const isFile = overrides.isFile ?? existsSync;
  const resolved = findOnPath(binaryPath, env, isFile, platform) ?? binaryPath;
  if (!WINDOWS_SHIM_EXTENSIONS.has(path.win32.extname(resolved).toLowerCase())) {
    return resolved;
  }
  const shimDirectory = path.win32.dirname(resolved);
  for (const segments of NPM_PACKAGE_ENTRY_CANDIDATES) {
    const candidate = path.win32.join(shimDirectory, ...segments);
    if (isFile(candidate)) return candidate;
  }
  return binaryPath;
}

/** `homePath` → `CLAUDE_CONFIG_DIR`, else inherit; `~` expands. */
export function resolveClaudeHomePath(
  homePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = homePath.trim();
  if (trimmed.length > 0) return path.resolve(expandHome(trimmed));
  const inherited = env.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (inherited.length > 0) return path.resolve(inherited);
  return path.join(os.homedir(), ".claude");
}

/**
 * Instance env: only adds `CLAUDE_CONFIG_DIR` when `homePath` is set,
 * otherwise returns the base untouched. Never overrides HOME.
 */
export function makeClaudeEnv(
  settings: Pick<ClaudeSettings, "homePath">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (settings.homePath.trim().length === 0) return baseEnv;
  return { ...baseEnv, CLAUDE_CONFIG_DIR: resolveClaudeHomePath(settings.homePath, baseEnv) };
}

export interface ParsedLaunchArgs {
  readonly permissionMode: string | null;
  readonly skipPermissions: boolean;
}

/**
 * Fold the permission-relevant launch args into the mode the driver sends
 * (the CLI resolves both together, so argv order never lets a flag win).
 * Anything else is ignored: the SDK offers no generic argv passthrough.
 */
export function parseClaudeLaunchArgs(args: readonly string[]): ParsedLaunchArgs {
  let permissionMode: string | null = null;
  let skipPermissions = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--permission-mode" && index + 1 < args.length) {
      permissionMode = args[index + 1]!;
      index += 1;
    } else if (arg.startsWith("--permission-mode=")) {
      permissionMode = arg.slice("--permission-mode=".length);
    } else if (arg === "--dangerously-skip-permissions") {
      skipPermissions = true;
    }
  }
  return { permissionMode, skipPermissions };
}

const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /not logged in/i,
  /authentication_failed/i,
  /oauth/i,
  /invalid api key/i,
  /api key.*missing/i,
  /cloud_credential_error/i,
  /\b401\b/,
];

export function isClaudeAuthErrorText(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function claudeSignedOutMessage(input: { configDir?: string; cwd: string }): string {
  const configuration =
    input.configDir !== undefined
      ? ` from ${JSON.stringify(input.cwd)}, with CLAUDE_CONFIG_DIR set to ${JSON.stringify(input.configDir)}`
      : "";
  return (
    "Claude could not authenticate. For subscription login, run `claude auth login` " +
    `on this environment's machine${configuration}, then start a new thread. ` +
    "For API-key authentication, check this instance's configured credentials."
  );
}
