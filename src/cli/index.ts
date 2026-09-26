#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stderr as errorOutput } from "node:process";
import { createInterface } from "node:readline/promises";

import { Command, Option } from "commander";

import {
  CONFIG_KEYS,
  expandHome,
  loadConfig,
  saveConfig,
  setConfigValue,
  type ConfigKey,
} from "../core/config.js";
import { describeSettings } from "../core/configschema.js";
import type { MergeStrategy } from "../server/api.js";
import {
  commentOnForgeRequest,
  createForgeRequest,
  forgeStatus,
  gitStatus,
  listForgeRequests,
  mergeForgeRequest,
  viewForgeRequest,
} from "./git/git.js";
import { cliClient } from "./infra/client.js";
import { redactMcpServers } from "../core/mcp.js";
import { doctor } from "./doctor.js";
import { preferDirectClient } from "./infra/client.js";
import { serverStart, serverStatus, serverStop } from "./server.js";
import { CliError } from "../core/errors.js";
import { writeError, writeSuccess } from "./output.js";
import {
  createHandoverThread,
  type ThreadCreateOptions,
} from "./handover/handover.js";
import {
  ensureProject,
  listProjects,
  resolveProject,
} from "./projects/projects.js";
import {
  listEfforts,
  listModels,
  listProviders,
  listSkills,
  setModelHidden,
} from "./catalog/providers.js";
import type { ProviderUsageLimits } from "../core/catalog/summary.js";
import {
  answerQuestion,
  archiveThread,
  cancelTask,
  delegateTask,
  deleteThread,
  dismissQuestion,
  inspectThread,
  interruptThread,
  listQuestions,
  listBackgroundTasks,
  stopBackgroundTask,
  listThreads,
  readThread,
  renameThread,
  revertConversation,
  sendThreadMessage,
  settleThread,
  snoozeThread,
  taskStatus,
  unsettleThread,
  unsnoozeThread,
  type ThreadListStatus,
  type ThreadReadView,
  type ThreadSendDelivery,
} from "./threads/threads.js";
import type {
  CliConfig,
  InteractionMode,
  OpenMode,
  ProjectPolicy,
  RuntimeMode,
  SpeedMode,
  ProjectEnvelope,
  ThreadEnvelope,
  ThreadEnvMode,
  WorkspaceMode,
} from "../core/types.js";

const program = new Command();
program
  .name("moxen")
  .description("Create projects and handover threads from the current folder.")
  .version("0.1.0")
  .option("--json", "Emit stable JSON envelopes.")
  .option("--config <path>", "Use a specific config file.")
  ;

interface GlobalOptions {
  json?: boolean;
  config?: string;
}

async function commandContext(): Promise<{
  config: CliConfig;
  configPath: string;
  configExists: boolean;
  json: boolean;
}> {
  const global = program.opts<GlobalOptions>();
  const loaded = await loadConfig(global.config);
  const config = { ...loaded.config };
  preferDirectClient(global.config !== undefined);
  return { config, configPath: loaded.path, configExists: loaded.exists, json: global.json ?? false };
}

async function action(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const global = program.opts<GlobalOptions>();
    const cliError = writeError(error, { json: global.json ?? false });
    process.exitCode = cliError.exitCode;
  }
}

function addWorkspaceOptions(command: Command): Command {
  return command
    .option("--cwd <path>", "Folder to resolve (defaults to the current working directory).")
    .addOption(new Option("--workspace-mode <mode>").choices(["repo", "folder"]));
}

function addProjectPolicyOption(command: Command): Command {
  return command.addOption(
    new Option("--project-policy <policy>", "Create a missing project or require an existing one.").choices([
      "create",
      "existing",
    ]),
  );
}

function addThreadOptions(command: Command): Command {
  return addProjectPolicyOption(addWorkspaceOptions(command))
    .option("--prompt <text>", "Handover prompt.")
    .option("--prompt-file <path>", "Read the handover prompt from a UTF-8 file.")
    .option("--stdin", "Read the handover prompt from stdin.")
    .addOption(new Option("--open <mode>").choices(["auto", "desktop", "browser", "none"]))
    .option("--provider <instance-id>", "Provider instance id (for example codex or claudeAgent).")
    .option("--model <slug>", "Provider model slug.")
    .addOption(
      new Option("--speed, --speed-mode <mode>", "Model speed mode.")
        .choices(["standard", "fast"]),
    )
    .option("--thinking-effort <effort>", "Model-specific reasoning/thinking effort.")
    .addOption(
      new Option("--checkout, --env-mode <mode>", "Use the current checkout or create a new worktree.")
        .choices(["auto", "local", "current", "worktree"]),
    )
    .addOption(
      new Option("--permission, --runtime-mode <mode>", "Permission/access level.")
        .choices(["approval-required", "auto-accept-edits", "auto", "full-access"]),
    )
    .addOption(
      new Option("--mode, --interaction-mode <mode>", "Build/default or Plan mode.")
        .choices(["default", "build", "plan"]),
    )
    .option("--dry-run", "Resolve and print commands without dispatching them.")
    .option("--no-wait", "Return at turn acceptance without waiting for the provider run to settle.");
}

interface PromptOptions {
  prompt?: string;
  promptFile?: string;
  stdin?: boolean;
}

interface ThreadSendCommandOptions extends PromptOptions {
  thread?: string;
  threadId?: string;
  open?: OpenMode;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
  ifBusy?: "reject" | "inject";
  wakeSettled?: boolean;
  delivery?: ThreadSendDelivery;
  handoffNote?: string;
  dryRun?: boolean;
  /** Commander stores `--no-wait` as `wait: false` — there is no `noWait` key. */
  wait?: boolean;
  /** Hold the message until then (`--at`). */
  at?: string;
}

interface ThreadListCommandOptions extends WorkspaceCommandOptions {
  project?: string;
  status?: ThreadListStatus;
}

interface ThreadReadCommandOptions {
  thread: string;
  lastTurn?: boolean;
  view?: ThreadReadView;
}

interface ThreadDelegateCommandOptions extends PromptOptions {
  thread?: string;
  title?: string;
  open?: OpenMode;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
  wait?: boolean;
  timeoutMs?: string;
  dryRun?: boolean;
  isolation?: "shared" | "worktree";
}

interface ThreadTaskCommandOptions {
  thread: string;
  task: string;
}

function addSendOptions(command: Command): Command {
  return command
    .option("--thread <id>", "Existing thread id to message (alias: --thread-id).")
    .option("--thread-id <id>", "Existing thread id (alias: --thread).")
    .option("--prompt <text>", "Follow-up message text.")
    .option("--prompt-file <path>", "Read the follow-up message from a UTF-8 file.")
    .option("--stdin", "Read the follow-up message from stdin.")
    .addOption(new Option("--open <mode>").choices(["auto", "desktop", "browser", "none"]))
    .option("--provider <instance-id>", "Override the thread's provider instance for this turn.")
    .option("--model <slug>", "Override the thread's model for this turn.")
    .addOption(
      new Option("--speed, --speed-mode <mode>", "Model speed mode override.")
        .choices(["standard", "fast"]),
    )
    .option("--thinking-effort <effort>", "Model-specific reasoning/thinking effort override.")
    .addOption(
      new Option("--if-busy <behavior>", "Reject a busy thread or inject into its active work.")
        .choices(["reject", "inject"])
        .default("reject"),
    )
    .option("--wake-settled", "Explicitly allow this message to wake a settled thread.")
    .addOption(
      new Option("--delivery <mode>", "Follow-up delivery policy (V1 dispatches thread.turn.start; the mode selects client-side policy and reporting).")
        .choices(["auto", "steer", "restart", "queue"])
        .default("auto"),
    )
    .option("--handoff-note <text>", "Provider-switch note recorded with the send (CLI-side metadata; V1 sends no context-transfer row).")
    .option("--dry-run", "Build the turn command without dispatching it.")
    .option("--no-wait", "Return at turn acceptance without waiting for the provider run to settle.")
    .option("--at <time>", "Schedule the message: an ISO date-time, or HH:MM (today, or tomorrow once that has passed). It queues until then.");
}

/** `--at`: an ISO date-time as given, or a bare HH:MM as the next time the clock reads it. */
function scheduledTime(raw: string, now: Date = new Date()): string {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (clock) {
    const at = new Date(now);
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }
  const parsed = Date.parse(raw.trim());
  if (!Number.isFinite(parsed)) throw new CliError("INVALID_THREAD_OPTION", "--at takes an ISO date-time or HH:MM.", { exitCode: 2 });
  return new Date(parsed).toISOString();
}

interface WorkspaceCommandOptions {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  projectPolicy?: ProjectPolicy;
  dryRun?: boolean;
}

interface ThreadCommandOptions extends WorkspaceCommandOptions {
  /** Commander stores `--no-wait` as `wait: false` — there is no `noWait` key. */
  wait?: boolean;
  prompt?: string;
  promptFile?: string;
  stdin?: boolean;
  open?: OpenMode;
  envMode?: ThreadEnvMode | "current";
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode | "build";
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
}

async function readStdin(): Promise<string> {
  input.setEncoding("utf8");
  let value = "";
  for await (const chunk of input) value += chunk;
  return value;
}

async function resolvePrompt(options: PromptOptions): Promise<string> {
  const sources = [options.prompt !== undefined, options.promptFile !== undefined, options.stdin === true].filter(Boolean);
  if (sources.length !== 1) {
    throw new CliError("PROMPT_SOURCE_REQUIRED", "Use exactly one of --prompt, --prompt-file, or --stdin.");
  }
  if (options.prompt !== undefined) return options.prompt;
  if (options.promptFile !== undefined) return await readFile(path.resolve(options.promptFile), "utf8");
  return await readStdin();
}

async function confirmSettledThread(thread: ThreadEnvelope, project: ProjectEnvelope | null): Promise<boolean> {
  if (!input.isTTY || !errorOutput.isTTY) {
    throw new CliError(
      "SETTLED_THREAD_CONFIRMATION_REQUIRED",
      `Thread ${thread.id} is settled. Re-run with --wake-settled to send and wake it.`,
      { exitCode: 4, details: { threadId: thread.id, settledAt: thread.settledAt } },
    );
  }
  const readline = createInterface({ input, output: errorOutput });
  try {
    const projectLabel = project ? ` in ${project.title}` : "";
    const answer = await readline.question(
      `Thread “${thread.title}”${projectLabel} is settled. Send this message and wake it? [y/N] `,
    );
    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    readline.close();
  }
}

function threadCreateOptions(options: ThreadCommandOptions, prompt: string): ThreadCreateOptions {
  return {
    prompt,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.workspaceMode ? { workspaceMode: options.workspaceMode } : {}),
    ...(options.projectPolicy ? { projectPolicy: options.projectPolicy } : {}),
    ...(options.open ? { openMode: options.open } : {}),
    ...(options.envMode ? { threadEnvMode: options.envMode === "current" ? "local" : options.envMode } : {}),
    ...(options.runtimeMode ? { runtimeMode: options.runtimeMode } : {}),
    ...(options.interactionMode
      ? { interactionMode: options.interactionMode === "build" ? "default" : options.interactionMode }
      : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.speedMode ? { speedMode: options.speedMode } : {}),
    ...(options.thinkingEffort ? { thinkingEffort: options.thinkingEffort } : {}),
    ...(options.dryRun ? { dryRun: true } : {}),
    ...(options.wait === false ? { noWait: true } : {}),
  };
}

program
  .command("tui")
  .description("Open the terminal UI for threads.")
  .action(() =>
    action(async () => {
      const context = await commandContext();
      const { runTui } = await import("../tui/index.js");
      await runTui(context.config, context.configPath);
    }),
  );

const server = program
  .command("server")
  .description("Run the moxen server: one process owning every provider session, shared by all clients.");

server
  .command("start")
  .description("Run the server in the foreground until Ctrl-C or `moxen server stop`.")
  .action(() =>
    action(async () => {
      const context = await commandContext();
      await serverStart(context, (result) => writeSuccess(result, context, `moxen server listening at ${result.endpoint} (pid ${result.pid}).`));
    }),
  );

server
  .command("status")
  .description("Report whether a server is running, and which protocol it speaks.")
  .action(() =>
    action(async () => {
      const context = await commandContext();
      const result = await serverStatus();
      writeSuccess(
        result,
        context,
        result.running ? `moxen server running at ${result.endpoint} (pid ${result.pid}).` : `No moxen server at ${result.endpoint}.`,
      );
    }),
  );

server
  .command("stop")
  .description("Stop the running server; its provider sessions end with it.")
  .action(() =>
    action(async () => {
      const context = await commandContext();
      const result = await serverStop();
      writeSuccess(result, context, result.stopped ? `Stopped the moxen server at ${result.endpoint}.` : `No moxen server at ${result.endpoint}.`);
    }),
  );

program.command("doctor").description("Check provider binaries, auth, store, and config.").action(() =>
  action(async () => {
    const context = await commandContext();
    const result = await doctor(context.config, context.configPath, context.configExists);
    writeSuccess(result, context, result.ok ? "moxen CLI is ready." : "moxen CLI has failing checks.");
    if (!result.ok) process.exitCode = 1;
  }),
);

/** Config as shown: MCP `env`/`headers` values may be secrets. */
function displayConfig(config: CliConfig): CliConfig {
  return config.mcpServers ? { ...config, mcpServers: redactMcpServers(config.mcpServers) } : config;
}

const configCommand = program.command("config").description("Inspect or update moxen settings.");
configCommand.command("path").action(() =>
  action(async () => {
    const context = await commandContext();
    writeSuccess({ path: context.configPath }, context, context.configPath);
  }),
);
configCommand.command("show").action(() =>
  action(async () => {
    const context = await commandContext();
    writeSuccess({ path: context.configPath, exists: context.configExists, config: displayConfig(context.config) }, context);
  }),
);
configCommand
  .command("set")
  .argument("<key>", `Setting key: ${CONFIG_KEYS.join(", ")}`)
  .argument("<value>")
  .action((key: string, value: string) =>
    action(async () => {
      if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
        throw new CliError("INVALID_CONFIG_KEY", `Unknown config key: ${key}`);
      }
      const context = await commandContext();
      const next = setConfigValue(context.config, key as ConfigKey, value);
      await saveConfig(context.configPath, next);
      writeSuccess({ path: context.configPath, config: displayConfig(next) }, context, `Saved ${key}=${value}.`);
    }),
  );

configCommand
  .command("list")
  .description("Every setting, with its current value and what it accepts.")
  .action(() =>
    action(async () => {
      const context = await commandContext();
      // Straight off the schema table, so this listing and the TUI
      // settings page can never describe a key differently.
      const settings = describeSettings(context.config).map((view) => ({
        key: view.descriptor.key,
        section: view.descriptor.section,
        label: view.descriptor.label,
        description: view.descriptor.description,
        type: view.descriptor.kind.type,
        ...(view.descriptor.kind.type === "enum"
          ? { choices: view.descriptor.kind.choices.map((choice) => choice.value) }
          : {}),
        value: view.value ?? null,
        explicit: view.explicit,
        ...(view.descriptor.restartRequired === true ? { restartRequired: true } : {}),
      }));
      writeSuccess(
        { path: context.configPath, exists: context.configExists, settings },
        context,
        settings
          .map((setting) => `${setting.key.padEnd(34)} ${String(setting.value ?? "—")}`)
          .join("\n"),
      );
    }),
  );

const git = program.command("git").description("Read this thread's checkout, and its pull or merge requests.");
git
  .command("status")
  .requiredOption("--thread <id>", "Thread whose checkout to read.")
  .option("--branch <name>", "Read history for this branch instead of the checked-out one.")
  .option("--limit <count>", "How many commits to read.", (value: string) => Number.parseInt(value, 10))
  .action((options: { thread: string; branch?: string; limit?: number }) =>
    action(async () => {
      const context = await commandContext();
      const result = await gitStatus(context.config, {
        threadId: options.thread,
        ...(options.branch !== undefined ? { branch: options.branch } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      });
      writeSuccess(result, context);
    }),
  );

const forge = program.command("pr").description("Pull requests (GitHub) or merge requests (GitLab), via gh or glab.");
forge
  .command("status")
  .requiredOption("--thread <id>", "Thread whose remote to inspect.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      writeSuccess(await forgeStatus(context.config, options.thread), context);
    }),
  );
forge
  .command("list")
  .requiredOption("--thread <id>", "Thread whose remote to read.")
  .option("--state <state>", "open, closed, merged or all.")
  .option("--limit <count>", "How many to read.", (value: string) => Number.parseInt(value, 10))
  .action((options: { thread: string; state?: "open" | "closed" | "merged" | "all"; limit?: number }) =>
    action(async () => {
      const context = await commandContext();
      const result = await listForgeRequests(context.config, {
        threadId: options.thread,
        ...(options.state !== undefined ? { state: options.state } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      });
      writeSuccess(result, context);
    }),
  );
forge
  .command("view")
  .requiredOption("--thread <id>", "Thread whose remote to read.")
  .argument("<number>")
  .action((number: string, options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      writeSuccess(
        await viewForgeRequest(context.config, { threadId: options.thread, number: Number.parseInt(number, 10) }),
        context,
      );
    }),
  );
forge
  .command("create")
  .description("Open a request. This publishes to the remote.")
  .requiredOption("--thread <id>", "Thread whose checkout to open it from.")
  .requiredOption("--title <title>")
  .option("--body <text>")
  .option("--base <branch>", "Branch to merge into.")
  .option("--head <branch>", "Branch to merge from.")
  .option("--draft")
  .action((options: { thread: string; title: string; body?: string; base?: string; head?: string; draft?: boolean }) =>
    action(async () => {
      const context = await commandContext();
      const result = await createForgeRequest(context.config, {
        threadId: options.thread,
        title: options.title,
        ...(options.body !== undefined ? { body: options.body } : {}),
        ...(options.base !== undefined ? { targetBranch: options.base } : {}),
        ...(options.head !== undefined ? { sourceBranch: options.head } : {}),
        ...(options.draft !== undefined ? { draft: options.draft } : {}),
      });
      writeSuccess(result, context, result.url ?? "Opened.");
    }),
  );
forge
  .command("comment")
  .description("Post a comment. This publishes to the remote.")
  .requiredOption("--thread <id>")
  .requiredOption("--body <text>")
  .argument("<number>")
  .action((number: string, options: { thread: string; body: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await commentOnForgeRequest(context.config, {
        threadId: options.thread,
        number: Number.parseInt(number, 10),
        body: options.body,
      });
      writeSuccess(result, context, `Commented on #${result.number}.`);
    }),
  );
forge
  .command("merge")
  .description("Merge a request. This changes the remote's default branch history.")
  .requiredOption("--thread <id>")
  .option("--strategy <strategy>", "merge, squash or rebase.")
  .option("--delete-branch", "Delete the source branch afterwards.")
  .argument("<number>")
  .action((number: string, options: { thread: string; strategy?: MergeStrategy; deleteBranch?: boolean }) =>
    action(async () => {
      const context = await commandContext();
      const result = await mergeForgeRequest(context.config, {
        threadId: options.thread,
        number: Number.parseInt(number, 10),
        ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
        ...(options.deleteBranch !== undefined ? { deleteBranch: options.deleteBranch } : {}),
      });
      writeSuccess(result, context, `Merged #${result.number} (${result.strategy}).`);
    }),
  );

const projects = program.command("projects").description("Resolve and manage projects.");
projects.command("list").action(() =>
  action(async () => {
    const context = await commandContext();
    const result = await listProjects(context.config);
    const lines = result.projects.map((project) => `${project.id}\t${project.workspaceRoot}\t${project.title}`);
    writeSuccess(result, context, lines.length > 0 ? lines.join("\n") : "No active projects.");
  }),
);
addWorkspaceOptions(projects.command("resolve"))
  .description("Resolve a folder/repository to an existing project.")
  .action((options: WorkspaceCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const result = await resolveProject(context.config, options);
      writeSuccess(
        result,
        context,
        result.project
          ? `${result.project.id}\t${result.project.workspaceRoot}\t${result.project.title}`
          : `No project for ${result.workspace.workspaceRoot}.`,
      );
    }),
  );
addProjectPolicyOption(addWorkspaceOptions(projects.command("ensure")))
  .description("Resolve a project and create it when policy permits.")
  .option("--dry-run", "Do not dispatch project.create.")
  .action((options: WorkspaceCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const result = await ensureProject(context.config, options);
      writeSuccess(
        result,
        context,
        `${result.created ? "Created" : "Resolved"} ${result.project.id} (${result.project.title}) at ${result.project.workspaceRoot}.`,
      );
    }),
  );

const threads = program.command("threads").description("Create, inspect, and message threads.");
threads.command("list")
  .description("List active and settled threads.")
  .option("--cwd <path>", "Filter by the project resolved from this folder.")
  .addOption(new Option("--workspace-mode <mode>").choices(["repo", "folder"]))
  .option("--project <project-id>", "Filter by an exact project id.")
  .addOption(
    new Option("--status <status>", "Filter by thread lifecycle status.")
      .choices(["active", "settled", "snoozed", "all"])
      .default("all"),
  )
  .action((options: ThreadListCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const result = await listThreads(context.config, options);
      const projectById = new Map(result.projects.map((project) => [project.id, project]));
      const lines = result.threads.map((thread) => {
        const project = projectById.get(thread.projectId);
        return [
          thread.status,
          thread.id,
          project?.title ?? thread.projectId,
          thread.title,
          thread.modelSelection?.model ?? "unknown-model",
          thread.updatedAt ?? "unknown-time",
        ].join("\t");
      });
      writeSuccess(result, context, lines.length > 0 ? lines.join("\n") : "No matching threads.");
    }),
  );

threads
  .command("inspect")
  .description("Inspect a thread before targeting it.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await inspectThread(context.config, options.thread);
      const latestTurn = result.thread.latestTurn as { state?: string; turnId?: string } | null | undefined;
      const snoozedUntil = (result.thread as { snoozedUntil?: string | null }).snoozedUntil ?? null;
      writeSuccess(
        result,
        context,
        [
          `Thread: ${result.thread.id}`,
          `Title: ${result.thread.title}`,
          `Project: ${result.project?.title ?? result.thread.projectId}`,
          `Status: ${result.thread.status}`,
          ...(snoozedUntil ? [`Snoozed until: ${snoozedUntil}`] : []),
          `Model: ${result.thread.modelSelection?.instanceId ?? "unknown"}/${result.thread.modelSelection?.model ?? "unknown"}`,
          `Session: ${result.thread.session?.status ?? "none"}`,
          `Latest turn: ${latestTurn ? `${latestTurn.state} (${latestTurn.turnId})` : "none"}`,
          `Updated: ${result.thread.updatedAt ?? "unknown"}`,
        ].join("\n"),
      );
    }),
  );

threads
  .command("btw")
  .description("Ask a side question on a copy of the thread's context: no tools, and never recorded in the thread. Runs alongside a turn in progress.")
  .requiredOption("--thread <thread-id>", "The thread whose context to ask from.")
  .argument("<question...>")
  .action((question: string[], options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const client = await cliClient(context.config);
      const answer = await client.dispatch({ type: "thread.side-question", threadId: options.thread, question: question.join(" ") });
      writeSuccess({ thread: options.thread, ...answer }, context, answer.text);
    }),
  );

threads
  .command("continue")
  .description("Continue a thread in a new one: same project, model and checkout, opened with a handoff written from the old thread.")
  .requiredOption("--thread <thread-id>", "The thread to continue.")
  .option("--at <time>", "Hold the handoff until then (e.g. just after a usage limit resets): an ISO date-time, or HH:MM.")
  .action((options: { thread: string; at?: string }) =>
    action(async () => {
      const context = await commandContext();
      const client = await cliClient(context.config);
      const result = await client.dispatch({
        type: "thread.continue",
        threadId: options.thread,
        ...(options.at ? { scheduledFor: scheduledTime(options.at) } : {}),
      });
      const { accepted: _accepted, ...envelope } = result;
      writeSuccess(
        { from: options.thread, ...envelope },
        context,
        envelope.scheduledFor === null
          ? `Continued in ${envelope.threadId} ("${envelope.title}").`
          : `Continues in ${envelope.threadId} ("${envelope.title}") at ${envelope.scheduledFor}.`,
      );
    }),
  );

threads
  .command("read")
  .description("Read a thread projection without truncation.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .option("--last-turn", "Return only entries assigned to the latest turn (messages and turn-items views).")
  .addOption(
    new Option("--view <view>", "Which thread projection to read.")
      .choices(["messages", "turn-items", "plans", "checkpoints", "transfers"])
      .default("messages"),
  )
  .action((options: ThreadReadCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const result = await readThread(context.config, options.thread, {
        lastTurn: options.lastTurn === true,
        ...(options.view ? { view: options.view } : {}),
      });
      const thread = result.thread as unknown as {
        id: string;
        title: string;
        projectId: string;
        view?: string;
        messageFilter?: { turnId?: string | null };
        messageCount?: number;
        messages?: Array<{ role: string; turnId: string | null; text: string }>;
        itemCount?: number;
        items?: Array<{ kind: string; summary: string; turnId?: string | null }>;
        planCount?: number;
        plans?: Array<{ id: string; turnId?: string | null }>;
        checkpointCount?: number;
        checkpoints?: Array<{ turnId: string; status: string }>;
        transferCount?: number;
        note?: string;
      };
      const header = [
        `Thread: ${thread.id}`,
        `Title: ${thread.title}`,
        `Project: ${result.project?.title ?? thread.projectId}`,
        ...(thread.messageFilter ? [`Turn: ${thread.messageFilter.turnId ?? "none"}`] : []),
      ];
      if (thread.view === "turn-items") {
        const lines = (thread.items ?? []).map(
          (item) => `[${item.kind}${item.turnId ? ` turn=${item.turnId}` : ""}]\n${item.summary}`,
        );
        writeSuccess(
          result,
          context,
          [...header, `Items: ${thread.itemCount ?? 0}`, "", lines.join("\n\n") || "No turn items."].join("\n"),
        );
        return;
      }
      if (thread.view === "plans") {
        const lines = (thread.plans ?? []).map(
          (plan) => `- ${plan.id}${plan.turnId ? ` (turn=${plan.turnId})` : ""}`,
        );
        writeSuccess(
          result,
          context,
          [...header, `Plans: ${thread.planCount ?? 0}`, "", lines.join("\n") || "No plans."].join("\n"),
        );
        return;
      }
      if (thread.view === "checkpoints") {
        const lines = (thread.checkpoints ?? []).map(
          (checkpoint) => `- turn=${checkpoint.turnId} status=${checkpoint.status}`,
        );
        writeSuccess(
          result,
          context,
          [...header, `Checkpoints: ${thread.checkpointCount ?? 0}`, "", lines.join("\n") || "No checkpoints."].join("\n"),
        );
        return;
      }
      if (thread.view === "transfers") {
        writeSuccess(
          result,
          context,
          [...header, `Transfers: ${thread.transferCount ?? 0}`, "", thread.note ?? "No transfers."].join("\n"),
        );
        return;
      }
      const transcript = (thread.messages ?? [])
        .map((message) => {
          const turn = message.turnId === null ? "" : ` turn=${message.turnId}`;
          return `[${message.role}${turn}]\n${message.text}`;
        })
        .join("\n\n");
      writeSuccess(
        result,
        context,
        [...header, `Messages: ${thread.messageCount ?? 0}`, "", transcript || "No messages."].join("\n"),
      );
    }),
  );

addThreadOptions(threads.command("create"))
  .description("Create a new project thread and start its first turn.")
  .action((options: ThreadCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const prompt = await resolvePrompt(options);
      const result = await createHandoverThread(context.config, threadCreateOptions(options, prompt));
      writeSuccess(
        result,
        context,
        `${result.dryRun ? "Would create" : "Created"} thread ${result.thread.id} in ${result.project.title}.`,
      );
    }),
  );
addSendOptions(threads.command("send"))
  .description("Send a follow-up message to an existing thread.")
  .action((options: ThreadSendCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const prompt = await resolvePrompt(options);
      const rawThreadId = options.thread ?? options.threadId;
      const threadId = rawThreadId?.trim();
      if (!threadId) {
        throw new CliError("THREAD_ID_REQUIRED", "Use --thread <id> or --thread-id <id> with a non-empty thread id.", { exitCode: 2 });
      }
      if (
        options.thread !== undefined &&
        options.threadId !== undefined &&
        options.thread.trim() !== options.threadId.trim()
      ) {
        throw new CliError("INVALID_THREAD_OPTION", "--thread and --thread-id must match when both are provided.");
      }
      const result = await sendThreadMessage(context.config, {
        threadId,
        prompt,
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.speedMode ? { speedMode: options.speedMode } : {}),
        ...(options.thinkingEffort ? { thinkingEffort: options.thinkingEffort } : {}),
        ...(options.open ? { openMode: options.open } : {}),
        ...(options.ifBusy ? { ifBusy: options.ifBusy } : {}),
        ...(options.wakeSettled ? { wakeSettled: true } : {}),
        ...(options.delivery ? { delivery: options.delivery } : {}),
        ...(options.handoffNote ? { handoffNote: options.handoffNote } : {}),
        ...(options.at ? { scheduledFor: scheduledTime(options.at) } : {}),
        ...(!context.json && !options.stdin ? { confirmSettled: confirmSettledThread } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.wait === false ? { noWait: true } : {}),
      });
      const projectLabel = result.project ? ` in ${result.project.title}` : "";
      writeSuccess(
        result,
        context,
        `${result.dryRun ? "Would send to" : "Sent to"} thread ${result.thread.id}${projectLabel}.`,
      );
    }),
  );

threads
  .command("settle")
  .description("Mark a thread as settled after verifying it can be settled.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await settleThread(context.config, options.thread);
      writeSuccess(
        result,
        context,
        `Settled thread ${result.thread.id}.`,
      );
    }),
  );

threads
  .command("unsettle")
  .description("Mark a settled thread as active without starting a turn.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await unsettleThread(context.config, options.thread);
      writeSuccess(
        result,
        context,
        `Marked thread ${result.thread.id} active.`,
      );
    }),
  );

threads
  .command("background")
  .description("List the background work in a thread's live session, or stop one task.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .option("--stop <task-id>", "Stop this background task instead of listing.")
  .action((options: { thread: string; stop?: string }) =>
    action(async () => {
      const context = await commandContext();
      if (options.stop) {
        const stopped = await stopBackgroundTask(context.config, options.thread, options.stop);
        writeSuccess(stopped, context, `Stopped background task ${stopped.taskId}.`);
        return;
      }
      const result = await listBackgroundTasks(context.config, options.thread);
      const lines = result.tasks.map((task) => `${task.taskId}\t${task.taskType ?? "-"}\t${task.description}`);
      writeSuccess(
        result,
        context,
        !result.live
          ? `No live session for thread ${result.threadId} here.`
          : lines.length > 0
            ? lines.join("\n")
            : "No background tasks running.",
      );
    }),
  );

threads
  .command("questions")
  .description("List the questions a running turn is waiting on.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await listQuestions(context.config, options.thread);
      const lines = result.requests.flatMap((request) => [
        `Request ${request.requestId}:`,
        ...request.questions.map(
          (question, index) =>
            `  ${index + 1}. ${question.question}${question.options.length > 0 ? ` [${question.options.map((option) => option.label).join(" | ")}]` : ""}`,
        ),
      ]);
      writeSuccess(result, context, lines.length > 0 ? lines.join("\n") : `Thread ${result.thread.id} is not waiting on a question.`);
    }),
  );

threads
  .command("answer")
  .description("Answer the question a running turn is waiting on (one --answer per question, in order).")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .option("--request <request-id>", "Which open question, when there is more than one.")
  .requiredOption(
    "--answer <text>",
    "An answer; repeat for each question. Comma-separate a multi-select.",
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .action((options: { thread: string; request?: string; answer: string[] }) =>
    action(async () => {
      const context = await commandContext();
      const result = await answerQuestion(context.config, options.thread, {
        ...(options.request !== undefined ? { requestId: options.request } : {}),
        answers: options.answer,
      });
      writeSuccess(result, context, `Answered ${result.request.requestId} on thread ${result.thread.id}.`);
    }),
  );

threads
  .command("dismiss")
  .description("Decline the question a running turn is waiting on; the agent carries on without an answer.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .option("--request <request-id>", "Which open question, when there is more than one.")
  .action((options: { thread: string; request?: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await dismissQuestion(context.config, options.thread, {
        ...(options.request !== undefined ? { requestId: options.request } : {}),
      });
      writeSuccess(result, context, `Dismissed ${result.request.requestId} on thread ${result.thread.id}.`);
    }),
  );

threads
  .command("revert")
  .description("Revert the conversation to its first N turns. Files are left as they are unless --restore-files.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .requiredOption("--keep <turns>", "How many turns to keep (0 clears the conversation).")
  .option("--restore-files", "Also put the files back to how they were before the first dropped turn (untracked ones included).")
  .action((options: { thread: string; keep: string; restoreFiles?: boolean }) =>
    action(async () => {
      const context = await commandContext();
      const result = await revertConversation(context.config, options.thread, options.keep, {
        ...(options.restoreFiles === true ? { restoreFiles: true } : {}),
      });
      writeSuccess(
        result,
        context,
        result.removedTurns === 0
          ? `Thread ${result.thread.id} already has ${result.keptTurns} turn(s); nothing to revert.`
          : `Reverted thread ${result.thread.id} to ${result.keptTurns} turn(s), dropping ${result.removedTurns}.`,
      );
    }),
  );

threads
  .command("archive")
  .description("Archive a thread: it leaves the lists and refuses new turns.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await archiveThread(context.config, options.thread);
      writeSuccess(result, context, `Archived thread ${result.thread.id}.`);
    }),
  );

threads
  .command("delete")
  .description("Delete a thread. Its ledger stays on disk, marked deleted.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await deleteThread(context.config, options.thread);
      writeSuccess(result, context, `Deleted thread ${result.thread.id}.`);
    }),
  );

threads
  .command("rename")
  .description("Change a thread's title.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .requiredOption("--title <title>", "New title.")
  .action((options: { thread: string; title: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await renameThread(context.config, options.thread, options.title);
      writeSuccess(result, context, `Renamed thread ${result.thread.id} to "${result.thread.title}".`);
    }),
  );

threads
  .command("snooze")
  .description("Snooze an active thread until an ISO-8601 datetime.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .requiredOption("--until <datetime>", "Wake time as an ISO-8601 datetime.")
  .action((options: { thread: string; until: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await snoozeThread(context.config, options.thread, options.until);
      writeSuccess(
        result,
        context,
        `Snoozed thread ${result.thread.id} until ${result.thread.snoozedUntil}.`,
      );
    }),
  );

threads
  .command("unsnooze")
  .description("Clear the snooze on a thread.")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .action((options: { thread: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await unsnoozeThread(context.config, options.thread);
      writeSuccess(
        result,
        context,
        `Unsnoozed thread ${result.thread.id}.`,
      );
    }),
  );

threads
  .command("interrupt")
  .description("Interrupt the active turn on a thread (dispatches thread.turn.interrupt).")
  .requiredOption("--thread <thread-id>", "Exact thread id.")
  .option("--run <turn-id>", "Interrupt a specific turn; omit to target the active turn.")
  .action((options: { thread: string; run?: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await interruptThread(context.config, options.thread, {
        ...(options.run ? { run: options.run } : {}),
      });
      writeSuccess(
        result,
        context,
        result.result === "no_active_run"
          ? `Thread ${result.thread.id} has no active turn; nothing was dispatched.`
          : `Interrupted thread ${result.thread.id}.`,
      );
    }),
  );

threads
  .command("delegate")
  .description("Delegate a self-contained task to a new child thread in the same project, then wait for its terminal turn.")
  .requiredOption("--thread <thread-id>", "Parent thread id that owns the delegated task.")
  .option("--prompt <text>", "Task prompt for the child thread.")
  .option("--prompt-file <path>", "Read the task prompt from a UTF-8 file.")
  .option("--stdin", "Read the task prompt from stdin.")
  .option("--title <title>", "Child thread title (defaults to the task's first line).")
  .addOption(new Option("--open <mode>").choices(["auto", "desktop", "browser", "none"]))
  .option("--provider <instance-id>", "Override the inherited provider instance for the child.")
  .option("--model <slug>", "Override the inherited model for the child.")
  .addOption(
    new Option("--speed, --speed-mode <mode>", "Model speed mode override.")
      .choices(["standard", "fast"]),
  )
  .option("--thinking-effort <effort>", "Model-specific reasoning/thinking effort override.")
  .option("--no-wait", "Return after dispatching without waiting for the child's terminal turn.")
  .option("--timeout-ms <ms>", "Wait budget in milliseconds (default 600000). Expiring it ends the wait without cancelling the child.")
  .option("--dry-run", "Build the child thread commands without dispatching them.")
  .addOption(
    new Option("--isolation <mode>", "shared: the parent's checkout (default). worktree: the child's own git worktree, on a branch cut from the parent's.")
      .choices(["shared", "worktree"]),
  )
  .action((options: ThreadDelegateCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const prompt = await resolvePrompt(options);
      const rawThreadId = options.thread?.trim();
      if (!rawThreadId) {
        throw new CliError("THREAD_ID_REQUIRED", "Use --thread <id> with a non-empty parent thread id.", { exitCode: 2 });
      }
      const rawTimeout = options.timeoutMs?.trim();
      const result = await delegateTask(context.config, {
        parentThreadId: rawThreadId,
        task: prompt,
        ...(options.title ? { title: options.title } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.speedMode ? { speedMode: options.speedMode } : {}),
        ...(options.thinkingEffort ? { thinkingEffort: options.thinkingEffort } : {}),
        ...(options.wait === false ? { wait: false } : {}),
        ...(rawTimeout !== undefined && rawTimeout.length > 0 ? { timeoutMs: Number(rawTimeout) } : {}),
        ...(options.open ? { openMode: options.open } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.isolation ? { isolation: options.isolation } : {}),
      });
      const task = result.task as { status: string; waitTimedOut: boolean };
      writeSuccess(
        result,
        context,
        result.dryRun
          ? `Would delegate to thread ${result.child.id} in ${result.project?.title ?? result.child.projectId}.`
          : task.waitTimedOut
            ? `Delegated to thread ${result.child.id}; wait timed out (status ${task.status}). Re-poll with task-status.`
            : `Delegated to thread ${result.child.id}; child turn ${task.status}.`,
      );
    }),
  );

threads
  .command("task-status")
  .description("Read a delegated task's status from its parent thread and child thread id.")
  .requiredOption("--thread <thread-id>", "Parent thread id that owns the delegated task.")
  .requiredOption("--task <task-id>", "Delegated task id (the child thread id).")
  .action((options: ThreadTaskCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const result = await taskStatus(context.config, options.thread, options.task);
      const task = result.task as { status: string; workState: string };
      writeSuccess(
        result,
        context,
        `Task ${result.task.taskId} is ${task.status} (${task.workState}).`,
      );
    }),
  );

threads
  .command("task-cancel")
  .description("Interrupt a delegated task's active turn.")
  .requiredOption("--thread <thread-id>", "Parent thread id that owns the delegated task.")
  .requiredOption("--task <task-id>", "Delegated task id (the child thread id).")
  .action((options: ThreadTaskCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const result = await cancelTask(context.config, options.thread, options.task);
      const task = result.task as { status: string };
      writeSuccess(
        result,
        context,
        `Task ${result.task.taskId} cancel result: ${task.status}.`,
      );
    }),
  );

addThreadOptions(program.command("handover"))
  .description("Resolve the current repo, ensure its project, and start a new thread.")
  .action((options: ThreadCommandOptions) =>
    action(async () => {
      const context = await commandContext();
      const prompt = await resolvePrompt(options);
      const result = await createHandoverThread(context.config, threadCreateOptions(options, prompt));
      writeSuccess(
        result,
        context,
        `${result.dryRun ? "Would hand over to" : "Handed over to"} thread ${result.thread.id} in ${result.project.title}.`,
      );
    }),
  );

function formatUsageSummary(usage: ProviderUsageLimits | null): string {
  if (!usage) return "-";
  if (usage.unavailable) return `unavailable (${usage.unavailable.reason})`;
  if (usage.windows.length === 0) return "-";
  return usage.windows.map((window) => `${window.label} ${Math.round(window.usedPercent)}%`).join(", ");
}

const providers = program.command("providers").description("List configured provider instances.");
providers
  .command("list")
  .description("List provider instances with live status.")
  .option("--refresh", "Probe providers for fresh status before listing.")
  .action((options: { refresh?: boolean }) =>
    action(async () => {
      const context = await commandContext();
      const result = await listProviders(context.config, options);
      const lines = result.providers.map(
        (provider) =>
          `${provider.instanceId}\t${provider.driver}\t${provider.displayName ?? "-"}\t${provider.enabled ? "enabled" : "disabled"}\t${provider.status ?? "-"}\t${provider.authStatus ?? "-"}\t${provider.models.length} models\t${formatUsageSummary(provider.usageLimits)}`,
      );
      writeSuccess(result, context, lines.length > 0 ? lines.join("\n") : "No provider instances.");
    }),
  );

providers
  .command("skills")
  .description("List the skills and slash commands a provider resolves for a directory.")
  .requiredOption("--provider <instance-id>", "Provider instance id (claudeAgent, codex, grok, opencode, …).")
  .option("--cwd <path>", "Directory to resolve for (defaults to the current working directory).")
  .action((options: { provider: string; cwd?: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await listSkills(context.config, options);
      const lines = [
        ...result.skills.map((skill) => `skill\t${result.trigger}${skill.name}\t${skill.shortDescription ?? skill.description ?? ""}`),
        ...result.commands.map((command) => `command\t/${command.name}\t${command.description ?? ""}`),
      ];
      writeSuccess(result, context, lines.length > 0 ? lines.join("\n") : "No skills or commands.");
    }),
  );

const models = program.command("models").description("List models on configured provider instances.");
models
  .command("list")
  .description("List models with their effort-option descriptors.")
  .option("--provider <instance-id>", "Only list models on this provider instance.")
  .option("--refresh", "Probe providers for fresh status before listing.")
  .action((options: { provider?: string; refresh?: boolean }) =>
    action(async () => {
      const context = await commandContext();
      const result = await listModels(context.config, options);
      const lines = result.providers.flatMap((provider) =>
        provider.models.map(
          (model) =>
            `${provider.instanceId}\t${model.slug}\t${model.name}\t${model.isCustom ? "custom" : "built-in"}\t${model.isDefault === true ? "default" : "-"}\t${model.isHidden ? "hidden" : "-"}`,
        ),
      );
      writeSuccess(result, context, lines.length > 0 ? lines.join("\n") : "No models.");
    }),
  );
models
  .command("hide")
  .description("Hide a model slug from the pickers (still usable when named explicitly).")
  .requiredOption("--provider <instance-id>", "Provider instance id.")
  .requiredOption("--model <slug>", "Model slug.")
  .action((options: { provider: string; model: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await setModelHidden(context.config, { ...options, hidden: true });
      writeSuccess(result, context, `Hid ${result.model.slug} on ${result.provider.instanceId}.`);
    }),
  );
models
  .command("show")
  .description("Show a hidden model slug in the pickers again.")
  .requiredOption("--provider <instance-id>", "Provider instance id.")
  .requiredOption("--model <slug>", "Model slug.")
  .action((options: { provider: string; model: string }) =>
    action(async () => {
      const context = await commandContext();
      const result = await setModelHidden(context.config, { ...options, hidden: false });
      writeSuccess(result, context, `Showing ${result.model.slug} on ${result.provider.instanceId}.`);
    }),
  );

const efforts = program.command("efforts").description("List effort options for a provider model.");
efforts
  .command("list")
  .description("List the selectable effort/option values a model supports.")
  .requiredOption("--provider <instance-id>", "Provider instance id.")
  .requiredOption("--model <slug>", "Model slug.")
  .option("--refresh", "Probe providers for fresh status before listing.")
  .action((options: { provider: string; model: string; refresh?: boolean }) =>
    action(async () => {
      const context = await commandContext();
      const result = await listEfforts(context.config, options);
      const lines = result.model.efforts.map(
        (effort) =>
          `${effort.id}\t${effort.label}\t${effort.currentValue ?? "-"}\t${effort.choices.map((choice) => `${choice.id}${choice.isDefault === true ? "*" : ""}`).join(",")}`,
      );
      writeSuccess(
        result,
        context,
        lines.length > 0 ? lines.join("\n") : `No effort options for ${options.model}.`,
      );
    }),
  );

await program.parseAsync(process.argv);
process.exit(process.exitCode ?? 0);
