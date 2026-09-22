import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError } from "./errors.js";
import type {
  CliConfig,
  InteractionMode,
  OpenMode,
  ProjectPolicy,
  RuntimeMode,
  SpeedMode,
  ThreadEnvMode,
  WorkspaceMode,
} from "./types.js";

export const DEFAULT_CONFIG: CliConfig = {
  projectPolicy: "create",
  workspaceMode: "repo",
  openMode: "auto",
  threadEnvMode: "t3",
  runtimeMode: "full-access",
  interactionMode: "default",
  sessionTtl: "2m",
};

const projectPolicies = new Set<ProjectPolicy>(["create", "existing"]);
const workspaceModes = new Set<WorkspaceMode>(["repo", "folder"]);
const openModes = new Set<OpenMode>(["auto", "desktop", "browser", "none"]);
const threadEnvModes = new Set<ThreadEnvMode>(["t3", "local", "worktree"]);
const runtimeModes = new Set<RuntimeMode>([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
const interactionModes = new Set<InteractionMode>(["default", "plan"]);
const speedModes = new Set<SpeedMode>(["standard", "fast"]);

export const CONFIG_KEYS = [
  "projectPolicy",
  "workspaceMode",
  "openMode",
  "threadEnvMode",
  "runtimeMode",
  "interactionMode",
  "provider",
  "model",
  "speedMode",
  "thinkingEffort",
  "sessionTtl",
  "t3Home",
  "origin",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function defaultConfigPath(): string {
  const override = process.env.MONVEX_CONFIG ?? process.env.T3CODE_CLI_CONFIG;
  if (override) return path.resolve(expandHome(override));
  const dir = (name: string): string => {
    if (process.platform === "win32" && process.env.APPDATA) {
      return path.join(process.env.APPDATA, name, "config.json");
    }
    const root = process.env.XDG_CONFIG_HOME
      ? path.resolve(expandHome(process.env.XDG_CONFIG_HOME))
      : path.join(os.homedir(), ".config");
    return path.join(root, name, "config.json");
  };
  const current = dir("monvex");
  if (fs.existsSync(current)) return current;
  // An existing install keeps its settings without a migration step.
  const legacy = dir("t3code-cli");
  return fs.existsSync(legacy) ? legacy : current;
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
  if (input.t3Home !== undefined) result.t3Home = path.resolve(expandHome(asString(input.t3Home, "t3Home")));
  if (input.origin !== undefined) result.origin = new URL(asString(input.origin, "origin")).origin;
  if (input.t3Command !== undefined) {
    if (!Array.isArray(input.t3Command) || !input.t3Command.every((value) => typeof value === "string" && value.length > 0)) {
      throw new CliError("INVALID_CONFIG", "t3Command must be an array of command arguments.");
    }
    result.t3Command = [...input.t3Command];
  }
  return applyEnvironmentOverrides(result);
}

/**
 * `MONVEX_*` wins; the pre-rebrand `T3CODE_*` spelling is still honoured
 * so existing shell profiles and scripts keep working. Reading both is
 * the whole migration - nothing to run, nothing to edit.
 */
function envOverride(name: string): string | undefined {
  return process.env[`MONVEX_${name}`] ?? process.env[`T3CODE_CLI_${name}`];
}

function applyEnvironmentOverrides(config: CliConfig): CliConfig {
  const next = { ...config };
  const home = process.env.MONVEX_HOME ?? process.env.T3CODE_HOME;
  if (home) next.t3Home = path.resolve(expandHome(home));
  const origin = envOverride("ORIGIN");
  if (origin) next.origin = new URL(origin).origin;
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
  const command = envOverride("T3_COMMAND");
  if (command) {
    const parsed = JSON.parse(command) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      throw new CliError("INVALID_CONFIG", "MONVEX_T3_COMMAND must be a JSON string array.");
    }
    next.t3Command = parsed;
  }
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

export function setConfigValue(config: CliConfig, key: ConfigKey, rawValue: string): CliConfig {
  const input = { ...config, [key]: rawValue };
  return normalizeConfig(input);
}
