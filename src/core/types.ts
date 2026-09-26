import type { McpServerEntry } from "./mcp.js";

export type ProjectPolicy = "create" | "existing";
export type WorkspaceMode = "repo" | "folder";
export type OpenMode = "auto" | "desktop" | "browser" | "none";
export type ThreadEnvMode = "auto" | "local" | "worktree";
export type EffectiveThreadEnvMode = Exclude<ThreadEnvMode, "auto">;
export type RuntimeMode = "approval-required" | "auto" | "auto-accept-edits" | "full-access";
export type InteractionMode = "default" | "plan";
export type SpeedMode = "standard" | "fast";

export interface CliConfig {
  projectPolicy: ProjectPolicy;
  workspaceMode: WorkspaceMode;
  openMode: OpenMode;
  threadEnvMode: ThreadEnvMode;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  sessionTtl: string;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
  /** MCP servers injected into every provider session (`core/mcp.ts`). */
  mcpServers?: Record<string, McpServerEntry>;
  /** Appended to every provider session's system prompt (`core/threads/instructions.ts`). */
  instructions?: string;
  /**
   * When a plan usage limit stops a turn, schedule a "continue" for just
   * after the limit resets (at most twice in a row). Off unless set: it runs
   * work while nobody is watching.
   */
  autoContinueAtUsageLimit?: boolean;
  /** TUI presentation; ignored by the CLI, which has no panels. */
  ui?: UiConfig;
  git?: GitConfig;
  forge?: ForgeConfig;
  /** Per-provider settings, read when that provider's driver is built. */
  providers?: ProvidersConfig;
}

export type BackdropMode = "animated" | "static" | "off";

export interface UiConfig {
  backdrop?: BackdropMode;
  defaultSidePanel?: "context" | "git" | "agents" | "background";
  contextRefreshSeconds?: number;
  usageRefreshSeconds?: number;
}

export interface GitConfig {
  historyLimit?: number;
  /** Fetch before reading history; off by default because it hits the network. */
  autoFetch?: boolean;
}

/**
 * Forge access is executable paths and an off switch, nothing more: `gh`
 * and `glab` own their own logins, and we only ever observe that they are
 * present and authenticated. No token ever lands in this file.
 */
export interface ForgeConfig {
  enabled?: boolean;
  ghPath?: string;
  glabPath?: string;
}

export interface ProvidersConfig {
  claude?: ClaudeProviderConfig;
}

export interface ClaudeProviderConfig {
  binaryPath?: string;
  homePath?: string;
  launchArgs?: readonly string[];
  thinkingDisplay?: "summarized" | "omitted";
  promptSuggestions?: boolean;
  partialMessages?: boolean;
}

export interface RuntimeState {
  version: 1;
  pid: number;
  host?: string;
  port: number;
  origin: string;
  startedAt: string;
}

export interface RuntimeEnvelope {
  origin: string;
  stateDir: string | null;
  runtimeStatePath: string | null;
  settingsPath: string | null;
  environmentId: string;
  serverVersion: string;
  capabilities: {
    threadSettlement?: boolean;
    [key: string]: unknown;
  };
}

export interface ModelSelection {
  instanceId: string;
  model: string;
  options?: ProviderOptionSelection[];
}

export interface ProviderOptionSelection {
  id: string;
  value: string | boolean;
}

export interface ProjectEnvelope {
  id: string;
  title: string;
  workspaceRoot: string;
  defaultModelSelection: ModelSelection | null;
  defaultThreadEnvMode?: EffectiveThreadEnvMode | null;
  deletedAt?: string | null;
  [key: string]: unknown;
}

export interface ActivityEnvelope {
  id: string;
  tone: string;
  kind: string;
  summary: string;
  turnId: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface CheckpointEnvelope {
  turnId: string;
  status: string;
  [key: string]: unknown;
}

export interface ProposedPlanEnvelope {
  id: string;
  turnId: string | null;
  [key: string]: unknown;
}

export interface ThreadEnvelope {
  id: string;
  projectId: string;
  title: string;
  modelSelection?: ModelSelection;
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  branch?: string | null;
  worktreePath?: string | null;
  latestTurn?: LatestTurnEnvelope | null;
  session?: SessionEnvelope | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt: string | null;
  settledOverride?: "settled" | "active" | null;
  settledAt?: string | null;
  unsettledAt?: string | null;
  snoozedUntil?: string | null;
  snoozedAt?: string | null;
  latestUserMessageAt?: string | null;
  hasPendingApprovals?: boolean;
  hasPendingUserInput?: boolean;
  messages?: MessageEnvelope[];
  activities?: ActivityEnvelope[];
  checkpoints?: CheckpointEnvelope[];
  proposedPlans?: ProposedPlanEnvelope[];
  /**
   * The model each turn ran on, by turn id — `modelSelection` above is only
   * the thread's *current* choice. Turns recorded before per-turn models
   * were stored are absent; read those as the thread's selection.
   */
  turnModelSelections?: Record<string, ModelSelection>;
  /**
   * Messages waiting their turn, oldest first: queued behind the running
   * turn, or scheduled for later (`scheduledFor`). Absent when there are none.
   */
  queuedTurns?: QueuedTurnEnvelope[];
  /** The thread that delegated this one, for a delegated task; absent otherwise. */
  parentThreadId?: string;
  deletedAt?: string | null;
  [key: string]: unknown;
}

export interface QueuedTurnEnvelope {
  turnId: string;
  messageId: string;
  scheduledFor: string | null;
  scheduleReason: "user" | "usage-reset" | "usage-hold" | null;
}

export interface LatestTurnEnvelope {
  turnId: string;
  state: "running" | "interrupted" | "completed" | "error";
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: string | null;
  [key: string]: unknown;
}

export interface SessionEnvelope {
  threadId: string;
  status: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";
  providerName: string | null;
  providerInstanceId?: string;
  runtimeMode: RuntimeMode;
  activeTurnId: string | null;
  lastError: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface MessageEnvelope {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  turnId: string | null;
  streaming: boolean;
  createdAt: string;
  updatedAt: string;
  /** Persisted attachments; inline uploads may carry these without context records. */
  attachments?: unknown;
  [key: string]: unknown;
}

export interface OrchestrationSnapshot {
  snapshotSequence: number;
  projects: ProjectEnvelope[];
  threads: ThreadEnvelope[];
  updatedAt: string;
}

export interface ThreadDetailSnapshot {
  snapshotSequence: number;
  thread: ThreadEnvelope;
  page?: {
    beforeCursor: string | null;
    hasMore: boolean;
    snapshotSequence: number;
    threadSequence?: number;
  };
}

export interface OpenResult {
  mode: OpenMode;
  kind: "thread-deep-link" | "desktop-reveal" | "browser" | "none";
  url: string | null;
  exactThread: boolean;
}

export interface WorkspaceResolution {
  inputPath: string;
  workspaceRoot: string;
  mode: WorkspaceMode;
  isGitRepository: boolean;
  branch: string | null;
}
