/**
 * The settings schema: one declarative table describing every key the
 * config file accepts.
 *
 * This exists so the CLI and the TUI cannot drift. `moxen config set` used
 * to validate against a flat `CONFIG_KEYS` tuple while nothing else knew
 * what a key meant — no label, no range, no idea whether it was an enum.
 * A TUI settings page built against that would have had to restate all of
 * it, and the two would have disagreed by the second change. Here the
 * table *is* the contract: the CLI derives its key list from it, the TUI
 * renders a control per descriptor, and adding a setting is one entry.
 *
 * It lives in the shared kernel (`src/core/config*`) on purpose — a client
 * may read vocabulary directly, and a setting's type and choices are
 * vocabulary. Applying a change still goes through `ClientApi`, because a
 * server outlives any one client and owns the file.
 *
 * Keys are dotted paths (`providers.claude.binaryPath`) resolved against
 * the config object; `readSetting` / `writeSetting` below are the only
 * things that walk them.
 */
import { CliError } from "./errors.js";
import type { CliConfig } from "./types.js";

/** Where a setting shows up. Order is the order a settings page renders. */
export const SETTING_SECTIONS = [
  "general",
  "turns",
  "model",
  "interface",
  "git",
  "provider:claude",
] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];

export const SECTION_LABEL: Record<SettingSection, string> = {
  general: "General",
  turns: "Turns",
  model: "Model defaults",
  interface: "Interface",
  git: "Git and forges",
  "provider:claude": "Claude Code",
};

export interface SettingChoice {
  readonly value: string;
  readonly label: string;
  /** One line on what picking this does; shown beside the choice. */
  readonly description?: string;
}

export type SettingKind =
  | { readonly type: "enum"; readonly choices: readonly SettingChoice[] }
  | { readonly type: "boolean" }
  | { readonly type: "string"; readonly placeholder?: string; readonly multiline?: boolean }
  /** `unit` is appended when the value is shown ("20" -> "20s"). */
  | { readonly type: "integer"; readonly min: number; readonly max: number; readonly unit?: string }
  /** A duration string the session layer parses (`"2m"`, `"45s"`). */
  | { readonly type: "duration" };

export type SettingValue = string | boolean | number | undefined;

export interface SettingDescriptor {
  /** Dotted path into the config object, and the id `config set` takes. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly section: SettingSection;
  readonly kind: SettingKind;
  /** The value in force when the key is absent. `undefined` means "unset". */
  readonly defaultValue: SettingValue;
  /**
   * Read at driver construction, so a change reaches only sessions started
   * after it. Surfaced to the user rather than silently half-applied.
   */
  readonly restartRequired?: boolean;
  /** `MOXEN_<name>` overrides this key; shown so an ignored edit is explicable. */
  readonly envOverride?: string;
}

const choice = (value: string, label: string, description?: string): SettingChoice =>
  description === undefined ? { value, label } : { value, label, description };

export const SETTINGS: readonly SettingDescriptor[] = [
  // -- general ---------------------------------------------------------------
  {
    key: "projectPolicy",
    label: "Unknown folders",
    description: "What happens when a prompt names a folder that is not a project yet.",
    section: "general",
    kind: {
      type: "enum",
      choices: [
        choice("create", "Create the project", "Register the folder and carry on."),
        choice("existing", "Require an existing project", "Refuse rather than register anything."),
      ],
    },
    defaultValue: "create",
    envOverride: "MOXEN_PROJECT_POLICY",
  },
  {
    key: "workspaceMode",
    label: "Workspace root",
    description: "Whether a project's root is the enclosing git repository or the folder itself.",
    section: "general",
    kind: {
      type: "enum",
      choices: [
        choice("repo", "Repository root", "Walk up to the git root."),
        choice("folder", "The folder itself", "Take the path as given."),
      ],
    },
    defaultValue: "repo",
    envOverride: "MOXEN_WORKSPACE_MODE",
  },
  {
    key: "openMode",
    label: "Open links in",
    description: "Where `open` sends a thread deep link.",
    section: "general",
    kind: {
      type: "enum",
      choices: [
        choice("auto", "Whatever is available"),
        choice("desktop", "The desktop app"),
        choice("browser", "A browser"),
        choice("none", "Nowhere", "Print the link instead of opening it."),
      ],
    },
    defaultValue: "auto",
    envOverride: "MOXEN_OPEN_MODE",
  },
  {
    key: "threadEnvMode",
    label: "Thread environment",
    description: "Whether a new thread works in the project checkout or gets its own git worktree.",
    section: "general",
    kind: {
      type: "enum",
      choices: [
        choice("auto", "Decide per thread", "Worktree for delegated work, local otherwise."),
        choice("local", "The project checkout"),
        choice("worktree", "Always a worktree"),
      ],
    },
    defaultValue: "auto",
    envOverride: "MOXEN_THREAD_ENV_MODE",
  },

  // -- turns -----------------------------------------------------------------
  {
    key: "runtimeMode",
    label: "Tool permissions",
    description: "How much a session may do without asking. Each provider maps this onto its own native mode.",
    section: "turns",
    kind: {
      type: "enum",
      choices: [
        choice("approval-required", "Ask for everything"),
        choice("auto-accept-edits", "Auto-accept edits", "Edits go through; commands still ask."),
        choice("auto", "Provider's auto mode", "Let the provider judge each call."),
        choice("full-access", "Full access", "No prompts at all."),
      ],
    },
    defaultValue: "full-access",
    envOverride: "MOXEN_RUNTIME_MODE",
  },
  {
    key: "interactionMode",
    label: "Interaction mode",
    description: "Whether new threads start in plan mode.",
    section: "turns",
    kind: {
      type: "enum",
      choices: [choice("default", "Normal"), choice("plan", "Plan first")],
    },
    defaultValue: "default",
    envOverride: "MOXEN_INTERACTION_MODE",
  },
  {
    key: "sessionTtl",
    label: "Idle session lifetime",
    description: "How long a provider session stays warm after its last turn.",
    section: "turns",
    kind: { type: "duration" },
    defaultValue: "2m",
  },
  {
    key: "autoContinueAtUsageLimit",
    label: "Continue after a usage limit",
    description:
      "When a plan limit stops a turn, schedule a continue for just after it resets (at most twice in a row). Off by default: it runs work while nobody is watching.",
    section: "turns",
    kind: { type: "boolean" },
    defaultValue: false,
  },
  {
    key: "instructions",
    label: "Extra instructions",
    description: "Appended to every provider session's system prompt.",
    section: "turns",
    kind: { type: "string", placeholder: "Appended to every session", multiline: true },
    defaultValue: undefined,
  },

  // -- model -----------------------------------------------------------------
  {
    key: "provider",
    label: "Default provider",
    description: "Which provider a new thread uses when nothing else names one.",
    section: "model",
    kind: { type: "string", placeholder: "claude" },
    defaultValue: undefined,
    envOverride: "MOXEN_PROVIDER",
  },
  {
    key: "model",
    label: "Default model",
    description: "Which model a new thread uses when nothing else names one.",
    section: "model",
    kind: { type: "string", placeholder: "the provider's own default" },
    defaultValue: undefined,
    envOverride: "MOXEN_MODEL",
  },
  {
    key: "speedMode",
    label: "Speed",
    description: "Providers that offer a faster lane use it when this is set to fast.",
    section: "model",
    kind: { type: "enum", choices: [choice("standard", "Standard"), choice("fast", "Fast")] },
    defaultValue: undefined,
    envOverride: "MOXEN_SPEED_MODE",
  },
  {
    key: "thinkingEffort",
    label: "Thinking effort",
    description: "The reasoning effort a session starts at, for providers that take one.",
    section: "model",
    kind: { type: "string", placeholder: "the provider's own default" },
    defaultValue: undefined,
    envOverride: "MOXEN_THINKING_EFFORT",
  },

  // -- interface -------------------------------------------------------------
  {
    key: "ui.backdrop",
    label: "Backdrop",
    description: "The animated field behind the thread list. Turn it off on a slow terminal or over SSH.",
    section: "interface",
    kind: {
      type: "enum",
      choices: [
        choice("animated", "Animated"),
        choice("static", "Static", "Drawn once, never redrawn."),
        choice("off", "Off"),
      ],
    },
    defaultValue: "animated",
  },
  {
    key: "ui.defaultSidePanel",
    label: "Side panel on open",
    description: "Which tab the side panel shows the first time it is opened in a session.",
    section: "interface",
    kind: {
      type: "enum",
      choices: [
        choice("context", "Context"),
        choice("git", "Git"),
        choice("agents", "Agents"),
        choice("background", "Background"),
      ],
    },
    defaultValue: "context",
  },
  {
    key: "ui.contextRefreshSeconds",
    label: "Context refresh",
    description: "How often an open Context tab re-reads the live breakdown.",
    section: "interface",
    kind: { type: "integer", min: 1, max: 600, unit: "s" },
    defaultValue: 5,
  },
  {
    key: "ui.usageRefreshSeconds",
    label: "Usage refresh",
    description: "How often plan usage windows are re-read.",
    section: "interface",
    kind: { type: "integer", min: 5, max: 3600, unit: "s" },
    defaultValue: 20,
  },

  // -- git and forges --------------------------------------------------------
  {
    key: "git.historyLimit",
    label: "Commits to load",
    description: "How many commits the Git panel reads per branch.",
    section: "git",
    kind: { type: "integer", min: 10, max: 1000 },
    defaultValue: 50,
  },
  {
    key: "git.autoFetch",
    label: "Fetch before listing",
    description:
      "Run `git fetch` before reading history, so remote branches are current. Off by default: it touches the network on a panel open.",
    section: "git",
    kind: { type: "boolean" },
    defaultValue: false,
  },
  {
    key: "forge.enabled",
    label: "Forge integration",
    description:
      "Use `gh` or `glab` for pull and merge requests when the remote points at GitHub or GitLab. Moxen never handles their credentials — each CLI owns its own login.",
    section: "git",
    kind: { type: "boolean" },
    defaultValue: true,
  },
  {
    key: "forge.ghPath",
    label: "gh executable",
    description: "Path to the GitHub CLI, if it is not on PATH.",
    section: "git",
    kind: { type: "string", placeholder: "gh" },
    defaultValue: "gh",
  },
  {
    key: "forge.glabPath",
    label: "glab executable",
    description: "Path to the GitLab CLI, if it is not on PATH.",
    section: "git",
    kind: { type: "string", placeholder: "glab" },
    defaultValue: "glab",
  },

  // -- Claude Code -----------------------------------------------------------
  {
    key: "providers.claude.binaryPath",
    label: "Claude executable",
    description: "The `claude` binary to spawn. On Windows an npm shim is followed to the real package entry.",
    section: "provider:claude",
    kind: { type: "string", placeholder: "claude" },
    defaultValue: "claude",
    restartRequired: true,
  },
  {
    key: "providers.claude.homePath",
    label: "Claude config directory",
    description:
      "Sets CLAUDE_CONFIG_DIR for spawned sessions, to run against a separate Claude home. Left empty, the CLI's own is inherited. HOME is never overridden — that would break keychain login on macOS.",
    section: "provider:claude",
    kind: { type: "string", placeholder: "~/.claude" },
    defaultValue: "",
    restartRequired: true,
  },
  {
    key: "providers.claude.thinkingDisplay",
    label: "Thinking display",
    description:
      "How extended thinking comes back. Claude Code's `highlights` is not offered: the API allows it only for sessions Anthropic hosts, and any other client silently falls back to no thinking text at all.",
    section: "provider:claude",
    kind: {
      type: "enum",
      choices: [
        choice("summarized", "Readable summaries"),
        choice("omitted", "No thinking text"),
      ],
    },
    defaultValue: "summarized",
    restartRequired: true,
  },
  {
    key: "providers.claude.promptSuggestions",
    label: "Suggest the next prompt",
    description: "Ask for one predicted next prompt after each turn, offered in the composer.",
    section: "provider:claude",
    kind: { type: "boolean" },
    defaultValue: true,
    restartRequired: true,
  },
  {
    key: "providers.claude.partialMessages",
    label: "Stream token by token",
    description:
      "Take the CLI's partial-message stream so text appears as it is written. Turning it off leaves whole messages arriving at once, which is quieter over a slow link.",
    section: "provider:claude",
    kind: { type: "boolean" },
    defaultValue: true,
    restartRequired: true,
  },
];

const BY_KEY: ReadonlyMap<string, SettingDescriptor> = new Map(
  SETTINGS.map((descriptor) => [descriptor.key, descriptor]),
);

export function settingDescriptor(key: string): SettingDescriptor | undefined {
  return BY_KEY.get(key);
}

/** Every key, in table order — what `config set` accepts and lists on error. */
export const SETTING_KEYS: readonly string[] = SETTINGS.map((descriptor) => descriptor.key);

export function settingsInSection(section: SettingSection): readonly SettingDescriptor[] {
  return SETTINGS.filter((descriptor) => descriptor.section === section);
}

// -- reading and writing dotted paths ----------------------------------------

function walk(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * The value in force for a key: what the config holds, else the
 * descriptor's default. Unknown keys read as `undefined` rather than
 * throwing, so a config written by a newer build stays readable.
 */
export function readSetting(config: CliConfig, key: string): SettingValue {
  const raw = walk(config, key.split("."));
  if (raw === undefined || raw === null) return settingDescriptor(key)?.defaultValue;
  if (typeof raw === "string" || typeof raw === "boolean" || typeof raw === "number") return raw;
  return undefined;
}

/** Parse one `config set` argument against its descriptor. */
export function parseSettingValue(descriptor: SettingDescriptor, raw: string): SettingValue {
  const text = raw.trim();
  switch (descriptor.kind.type) {
    case "enum": {
      const match = descriptor.kind.choices.find((option) => option.value === text);
      if (!match) {
        const allowed = descriptor.kind.choices.map((option) => option.value).join(", ");
        throw new CliError("INVALID_CONFIG", `${descriptor.key} must be one of: ${allowed}.`);
      }
      return match.value;
    }
    case "boolean": {
      if (text === "true") return true;
      if (text === "false") return false;
      throw new CliError("INVALID_CONFIG", `${descriptor.key} must be true or false.`);
    }
    case "integer": {
      const value = Number(text);
      if (!Number.isInteger(value) || value < descriptor.kind.min || value > descriptor.kind.max) {
        throw new CliError(
          "INVALID_CONFIG",
          `${descriptor.key} must be a whole number between ${descriptor.kind.min} and ${descriptor.kind.max}.`,
        );
      }
      return value;
    }
    case "duration": {
      if (!/^\d+(?:ms|s|m|h)$/.test(text)) {
        throw new CliError("INVALID_CONFIG", `${descriptor.key} must be a duration such as 45s, 2m or 1h.`);
      }
      return text;
    }
    case "string":
      return text;
  }
}

/**
 * A copy of `config` with `key` set, creating intermediate objects as
 * needed. An empty string clears a key that has no meaningful empty value,
 * so `config set model ""` goes back to the provider's default rather than
 * pinning the empty string.
 */
export function writeSetting(config: CliConfig, key: string, value: SettingValue): CliConfig {
  const descriptor = settingDescriptor(key);
  if (!descriptor) throw new CliError("INVALID_CONFIG_KEY", `Unknown config key: ${key}`);
  const clears = value === "" && descriptor.defaultValue !== "";
  const path = key.split(".");
  const next = { ...config } as Record<string, unknown>;
  let cursor = next;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    const branch = existing !== null && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
    cursor[segment] = branch;
    cursor = branch;
  }
  const leaf = path[path.length - 1]!;
  if (clears) delete cursor[leaf];
  else cursor[leaf] = value;
  return next as unknown as CliConfig;
}

/** Every setting with its current value — what a settings page renders from. */
export interface SettingView {
  readonly descriptor: SettingDescriptor;
  readonly value: SettingValue;
  /** True when the config file pins it, rather than it falling back to the default. */
  readonly explicit: boolean;
}

export function describeSettings(config: CliConfig): readonly SettingView[] {
  return SETTINGS.map((descriptor) => ({
    descriptor,
    value: readSetting(config, descriptor.key),
    explicit: walk(config, descriptor.key.split(".")) !== undefined,
  }));
}
