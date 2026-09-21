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
} from "../config.js";
import { doctor } from "./doctor.js";
import { CliError } from "../errors.js";
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
} from "./catalog/providers.js";
import type { ProviderUsageLimits } from "./catalog/catalog.js";
import {
  cancelTask,
  delegateTask,
  inspectThread,
  interruptThread,
  listThreads,
  readThread,
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
  T3Project,
  T3Thread,
  ThreadEnvMode,
  WorkspaceMode,
} from "../types.js";

const program = new Command();
program
  .name("t3code")
  .description("Create projects and handover threads from the current folder.")
  .version("0.1.0")
  .option("--json", "Emit stable JSON envelopes.")
  .option("--config <path>", "Use a specific config file.")
  .option("--t3-home <path>", "Deprecated no-op (kept for script compatibility).")
  .option("--origin <url>", "Deprecated no-op (kept for script compatibility).");

interface GlobalOptions {
  json?: boolean;
  config?: string;
  t3Home?: string;
  origin?: string;
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
  if (global.t3Home) config.t3Home = path.resolve(expandHome(global.t3Home));
  if (global.origin) config.origin = new URL(global.origin).origin;
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
        .choices(["t3", "local", "current", "worktree"]),
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
  noWait?: boolean;
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
    .option("--no-wait", "Return at turn acceptance without waiting for the provider run to settle.");
}

interface WorkspaceCommandOptions {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  projectPolicy?: ProjectPolicy;
  dryRun?: boolean;
}

interface ThreadCommandOptions extends WorkspaceCommandOptions {
  noWait?: boolean;
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

async function confirmSettledThread(thread: T3Thread, project: T3Project | null): Promise<boolean> {
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
    ...(options.noWait ? { noWait: true } : {}),
  };
}

program
  .command("tui")
  .description("Open the terminal UI for threads.")
  .action(() =>
    action(async () => {
      const context = await commandContext();
      const { runTui } = await import("../tui/index.js");
      await runTui(context.config);
    }),
  );

program.command("doctor").description("Check provider binaries, auth, store, and config.").action(() =>
  action(async () => {
    const context = await commandContext();
    const result = await doctor(context.config, context.configPath, context.configExists);
    writeSuccess(result, context, result.ok ? "t3code CLI is ready." : "t3code CLI has failing checks.");
    if (!result.ok) process.exitCode = 1;
  }),
);

const configCommand = program.command("config").description("Inspect or update t3code-cli settings.");
configCommand.command("path").action(() =>
  action(async () => {
    const context = await commandContext();
    writeSuccess({ path: context.configPath }, context, context.configPath);
  }),
);
configCommand.command("show").action(() =>
  action(async () => {
    const context = await commandContext();
    writeSuccess({ path: context.configPath, exists: context.configExists, config: context.config }, context);
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
      writeSuccess({ path: context.configPath, config: next }, context, `Saved ${key}=${value}.`);
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
        ...(!context.json && !options.stdin ? { confirmSettled: confirmSettledThread } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.noWait ? { noWait: true } : {}),
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
