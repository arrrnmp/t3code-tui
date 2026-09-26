import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError } from "./errors.js";
import { parseMcpServers, type McpServerEntry } from "./mcp.js";
import { SETTING_KEYS, parseSettingValue, settingDescriptor, writeSetting } from "./configschema.js";
import type {
  ClaudeProviderConfig,
  CliConfig,
  ForgeConfig,
  GitConfig,
  InteractionMode,
  OpenMode,
  ProjectPolicy,
  RuntimeMode,
  ProvidersConfig,
  SpeedMode,
  ThreadEnvMode,
  UiConfig,
  WorkspaceMode,
} from "./types.js";

export const DEFAULT_CONFIG: CliConfig = {
  projectPolicy: "create",
  workspaceMode: "repo",
  openMode: "auto",
  threadEnvMode: "auto",
  runtimeMode: "full-access",
  interactionMode: "default",
  sessionTtl: "2m",
};

const projectPolicies = new Set<ProjectPolicy>(["create", "existing"]);
const workspaceModes = new Set<WorkspaceMode>(["repo", "folder"]);
const openModes = new Set<OpenMode>(["auto", "desktop", "browser", "none"]);
const threadEnvModes = new Set<ThreadEnvMode>(["auto", "local", "worktree"]);
const runtimeModes = new Set<RuntimeMode>([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
const interactionModes = new Set<InteractionMode>(["default", "plan"]);
const speedModes = new Set<SpeedMode>(["standard", "fast"]);

/**
 * Every settable key, straight from the schema table — the CLI and the
 * TUI therefore accept exactly the same set. Dotted paths
 * (`providers.claude.binaryPath`) are keys like any other.
 */
export const CONFIG_KEYS: readonly string[] = SETTING_KEYS;
export type ConfigKey = string;

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * The product's name on every surface that persists it: the home and
 * config directories, the env prefix, the project file and the git ref
 * namespace. One constant, so the name lives in exactly one place.
 */
export const APP_NAME = "moxen";

/** The name in prose — what an agent is told it runs in. */
export const APP_DISPLAY_NAME = "Moxen";

/** `MOXEN_<name>` from the environment. */
export function appEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`MOXEN_${name}`];
}

/** `~/.moxen` — threads, caches, attachments. */
export function appHomeDir(home: string = os.homedir()): string {
  return path.join(home, `.${APP_NAME}`);
}

function configRoot(): string {
  if (process.platform === "win32" && process.env.APPDATA) return process.env.APPDATA;
  return process.env.XDG_CONFIG_HOME
    ? path.resolve(expandHome(process.env.XDG_CONFIG_HOME))
    : path.join(os.homedir(), ".config");
}

export function defaultConfigPath(): string {
  const override = appEnv("CONFIG");
  if (override) return path.resolve(expandHome(override));
  return path.join(configRoot(), APP_NAME, "config.json");
}

function asString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliError("INVALID_CONFIG", `${key} must be a non-empty string.`);
  }
  return value.trim();
}

export function normalizeConfig(raw: unknown): CliConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError("INVALID_CONFIG", "The config file must contain a JSON object.");
  }
  const input = raw as Record<string, unknown>;
  const result: CliConfig = { ...DEFAULT_CONFIG };

  if (input.projectPolicy !== undefined) {
    const value = asString(input.projectPolicy, "projectPolicy") as ProjectPolicy;
    if (!projectPolicies.has(value)) throw new CliError("INVALID_CONFIG", "projectPolicy must be create or existing.");
    result.projectPolicy = value;
  }
  if (input.workspaceMode !== undefined) {
    const value = asString(input.workspaceMode, "workspaceMode") as WorkspaceMode;
    if (!workspaceModes.has(value)) throw new CliError("INVALID_CONFIG", "workspaceMode must be repo or folder.");
    result.workspaceMode = value;
  }
  if (input.openMode !== undefined) {
    const value = asString(input.openMode, "openMode") as OpenMode;
    if (!openModes.has(value)) throw new CliError("INVALID_CONFIG", "openMode is invalid.");
    result.openMode = value;
  }
  if (input.threadEnvMode !== undefined) {
    const value = asString(input.threadEnvMode, "threadEnvMode") as ThreadEnvMode;
    if (!threadEnvModes.has(value)) throw new CliError("INVALID_CONFIG", "threadEnvMode is invalid.");
    result.threadEnvMode = value;
  }
  if (input.runtimeMode !== undefined) {
    const value = asString(input.runtimeMode, "runtimeMode") as RuntimeMode;
    if (!runtimeModes.has(value)) throw new CliError("INVALID_CONFIG", "runtimeMode is invalid.");
    result.runtimeMode = value;
  }
  if (input.interactionMode !== undefined) {
    const value = asString(input.interactionMode, "interactionMode") as InteractionMode;
    if (!interactionModes.has(value)) throw new CliError("INVALID_CONFIG", "interactionMode is invalid.");
    result.interactionMode = value;
  }
  if (input.provider !== undefined) result.provider = asString(input.provider, "provider");
  if (input.model !== undefined) result.model = asString(input.model, "model");
  if (input.speedMode !== undefined) {
    const value = asString(input.speedMode, "speedMode") as SpeedMode;
    if (!speedModes.has(value)) throw new CliError("INVALID_CONFIG", "speedMode must be standard or fast.");
    result.speedMode = value;
  }
  if (input.thinkingEffort !== undefined) {
    result.thinkingEffort = asString(input.thinkingEffort, "thinkingEffort");
  }
  if (input.sessionTtl !== undefined) result.sessionTtl = asString(input.sessionTtl, "sessionTtl");
  if (input.instructions !== undefined) {
    const value = asString(input.instructions, "instructions").trim();
    if (value) result.instructions = value;
  }
  if (input.autoContinueAtUsageLimit !== undefined) {
    // A boolean in the file; `config set` hands it over as text.
    const raw: unknown = input.autoContinueAtUsageLimit;
    const value = raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : null;
    if (value === null) throw new CliError("INVALID_CONFIG", "autoContinueAtUsageLimit must be true or false.");
    if (value) result.autoContinueAtUsageLimit = true;
  }
  if (input.mcpServers !== undefined) {
    const servers = parseMcpServers(input.mcpServers, "config") as Record<string, McpServerEntry>;
    if (Object.keys(servers).length > 0) result.mcpServers = servers;
  }
  const ui = normalizeSection<UiConfig>(input.ui, "ui", ["backdrop", "defaultSidePanel", "contextRefreshSeconds", "usageRefreshSeconds"]);
  if (ui) result.ui = ui;
  const git = normalizeSection<GitConfig>(input.git, "git", ["historyLimit", "autoFetch"]);
  if (git) result.git = git;
  const forge = normalizeSection<ForgeConfig>(input.forge, "forge", ["enabled", "ghPath", "glabPath"]);
  if (forge) result.forge = forge;
  const providers = normalizeProviders(input.providers);
  if (providers) result.providers = providers;
  return applyEnvironmentOverrides(result);
}

function asSection(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("INVALID_CONFIG", `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validate one nested section against the schema, field by field. Values
 * arrive either already typed (from the file) or as text (`config set`
 * hands everything over as a string), so each goes through the
 * descriptor's own parser. Unknown fields are dropped rather than
 * rejected: a config written by a newer build must stay loadable.
 */
function normalizeSection<T>(raw: unknown, prefix: string, fields: readonly string[]): T | undefined {
  if (raw === undefined) return undefined;
  const input = asSection(raw, prefix);
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    const descriptor = settingDescriptor(`${prefix}.${field}`);
    if (!descriptor) continue;
    out[field] = typeof value === "string" ? parseSettingValue(descriptor, value) : checkTyped(descriptor.kind.type, value, `${prefix}.${field}`);
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined;
}

/** A non-string value straight from the file still has to match its kind. */
function checkTyped(kind: string, value: unknown, label: string): unknown {
  if (kind === "boolean") {
    if (typeof value !== "boolean") throw new CliError("INVALID_CONFIG", `${label} must be true or false.`);
    return value;
  }
  if (kind === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new CliError("INVALID_CONFIG", `${label} must be a whole number.`);
    }
    return value;
  }
  throw new CliError("INVALID_CONFIG", `${label} must be a string.`);
}

function normalizeProviders(raw: unknown): ProvidersConfig | undefined {
  if (raw === undefined) return undefined;
  const input = asSection(raw, "providers");
  if (input.claude === undefined) return undefined;
  const claude = normalizeSection<ClaudeProviderConfig>(input.claude, "providers.claude", [
    "binaryPath",
    "homePath",
    "thinkingDisplay",
    "promptSuggestions",
    "partialMessages",
  ]);
  const launchArgs = asSection(input.claude, "providers.claude").launchArgs;
  const args = Array.isArray(launchArgs) && launchArgs.every((entry) => typeof entry === "string") ? (launchArgs as string[]) : undefined;
  if (!claude && !args) return undefined;
  return { claude: { ...(claude ?? {}), ...(args ? { launchArgs: args } : {}) } };
}

function envOverride(name: string): string | undefined {
  return appEnv(name);
}

function applyEnvironmentOverrides(config: CliConfig): CliConfig {
  const next = { ...config };
  const projectPolicy = envOverride("PROJECT_POLICY");
  if (projectPolicy) next.projectPolicy = projectPolicy as ProjectPolicy;
  const workspaceMode = envOverride("WORKSPACE_MODE");
  if (workspaceMode) next.workspaceMode = workspaceMode as WorkspaceMode;
  const openMode = envOverride("OPEN_MODE");
  if (openMode) next.openMode = openMode as OpenMode;
  const threadEnvMode = envOverride("THREAD_ENV_MODE");
  if (threadEnvMode) next.threadEnvMode = threadEnvMode as ThreadEnvMode;
  const runtimeMode = envOverride("RUNTIME_MODE");
  if (runtimeMode) next.runtimeMode = runtimeMode as RuntimeMode;
  const interactionMode = envOverride("INTERACTION_MODE");
  if (interactionMode) next.interactionMode = interactionMode as InteractionMode;
  const provider = envOverride("PROVIDER");
  if (provider) next.provider = provider;
  const model = envOverride("MODEL");
  if (model) next.model = model;
  const speedMode = envOverride("SPEED_MODE");
  if (speedMode) next.speedMode = speedMode as SpeedMode;
  const thinkingEffort = envOverride("THINKING_EFFORT");
  if (thinkingEffort) next.thinkingEffort = thinkingEffort;
  return normalizeConfigValues(next);
}

function normalizeConfigValues(config: CliConfig): CliConfig {
  const withoutEnvironment = { ...config };
  if (!projectPolicies.has(withoutEnvironment.projectPolicy)) throw new CliError("INVALID_CONFIG", "Invalid project policy override.");
  if (!workspaceModes.has(withoutEnvironment.workspaceMode)) throw new CliError("INVALID_CONFIG", "Invalid workspace mode override.");
  if (!openModes.has(withoutEnvironment.openMode)) throw new CliError("INVALID_CONFIG", "Invalid open mode override.");
  if (!threadEnvModes.has(withoutEnvironment.threadEnvMode)) throw new CliError("INVALID_CONFIG", "Invalid thread env mode override.");
  if (!runtimeModes.has(withoutEnvironment.runtimeMode)) throw new CliError("INVALID_CONFIG", "Invalid runtime mode override.");
  if (!interactionModes.has(withoutEnvironment.interactionMode)) throw new CliError("INVALID_CONFIG", "Invalid interaction mode override.");
  if (withoutEnvironment.speedMode !== undefined && !speedModes.has(withoutEnvironment.speedMode)) {
    throw new CliError("INVALID_CONFIG", "Invalid speed mode override.");
  }
  return withoutEnvironment;
}

export async function loadConfig(explicitPath?: string): Promise<{ config: CliConfig; path: string; exists: boolean }> {
  const configPath = path.resolve(expandHome(explicitPath ?? defaultConfigPath()));
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return { config: normalizeConfig(raw), path: configPath, exists: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { config: applyEnvironmentOverrides({ ...DEFAULT_CONFIG }), path: configPath, exists: false };
    if (error instanceof CliError) throw error;
    throw new CliError("CONFIG_READ_FAILED", `Could not read config at ${configPath}.`, { cause: error });
  }
}

export async function saveConfig(configPath: string, config: CliConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Apply one `key=value` edit. The value is parsed against the key's
 * descriptor first — so a bad enum fails with the allowed set rather than
 * being written and rejected on the next load — then the whole config is
 * re-normalized, which is what catches combinations no single key can.
 */
export function setConfigValue(config: CliConfig, key: ConfigKey, rawValue: string): CliConfig {
  const descriptor = settingDescriptor(key);
  if (!descriptor) throw new CliError("INVALID_CONFIG_KEY", `Unknown config key: ${key}`);
  return normalizeConfig(writeSetting(config, key, parseSettingValue(descriptor, rawValue)));
}
