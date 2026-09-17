import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

import { DEFAULT_CONFIG } from "../config.js";
import { runProcess } from "../infra/process.js";
import type { CliConfig, T3Project, T3Thread } from "../types.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return JSON.parse(body) as unknown;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export interface TestHarnessOptions {
  failTurn?: boolean;
  failCommands?: string[];
  leaveTurnsRunning?: boolean;
  suppressProjectionFor?: string[];
  serverVersion?: string;
  settings?: Record<string, unknown>;
}

export async function testHarness(
  initialProjects: T3Project[] = [],
  options: TestHarnessOptions = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "t3code-cli-service-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await runProcess("git", ["init", "-b", "main"], { cwd: root });

  const mockT3 = path.join(root, "mock-t3.mjs");
  await writeFile(
    mockT3,
    `const args = process.argv.slice(2);\nif (args.includes("issue")) process.stdout.write(JSON.stringify({sessionId:"mock-session",token:"mock-token"}));\n`,
    "utf8",
  );

  const projects = [...initialProjects];
  const threads: T3Thread[] = [];
  const commands: Array<Record<string, unknown>> = [];
  let sequence = 0;
  const server = createServer(async (request, response) => {
    if (request.url === "/.well-known/t3/environment") {
      json(response, 200, {
        environmentId: "environment-1",
        serverVersion: options.serverVersion ?? "0.0.34-nightly.20260818.1124",
        capabilities: { threadSettlement: true },
      });
      return;
    }
    if (request.headers.authorization !== "Bearer mock-token") {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    if (request.method === "GET" && request.url === "/api/orchestration/shell") {
      json(response, 200, {
        snapshotSequence: sequence,
        projects,
        threads,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/orchestration/snapshot") {
      json(response, 200, {
        snapshotSequence: sequence,
        projects,
        threads,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const detailMatch = request.url?.match(/^\/api\/orchestration\/threads\/([^?]+)/u);
    if (request.method === "GET" && detailMatch) {
      const threadId = decodeURIComponent(detailMatch[1]!);
      const thread = threads.find((candidate) => candidate.id === threadId && candidate.deletedAt == null);
      if (!thread) {
        json(response, 404, { error: "not found" });
      } else {
        // Mirror the server: detail rows never carry shell-only flags.
        const { hasPendingApprovals, hasPendingUserInput, latestUserMessageAt, ...detail } = thread as Record<string, unknown>;
        void hasPendingApprovals;
        void hasPendingUserInput;
        void latestUserMessageAt;
        json(response, 200, { snapshotSequence: sequence, thread: detail });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/api/orchestration/dispatch") {
      const command = (await bodyOf(request)) as Record<string, unknown>;
      commands.push(command);
      if (typeof command.type === "string" && (options.failCommands ?? []).includes(command.type)) {
        json(response, 500, { error: `${command.type} failed` });
        return;
      }
      sequence += 1;
      if (
        typeof command.type === "string" &&
        (options.suppressProjectionFor ?? []).includes(command.type)
      ) {
        json(response, 200, { sequence });
        return;
      }
      if (command.type === "project.create") {
        projects.push({
          id: command.projectId as string,
          title: command.title as string,
          workspaceRoot: command.workspaceRoot as string,
          defaultModelSelection: command.defaultModelSelection as T3Project["defaultModelSelection"],
          deletedAt: null,
        });
      }
      if (command.type === "thread.create") {
        const created: T3Thread = {
          id: command.threadId as string,
          projectId: command.projectId as string,
          title: command.title as string,
          archivedAt: null,
          worktreePath: null,
          createdAt: command.createdAt as string,
          updatedAt: command.createdAt as string,
          messages: [],
        };
        if (command.modelSelection !== undefined) created.modelSelection = command.modelSelection as NonNullable<T3Thread["modelSelection"]>;
        if (command.runtimeMode !== undefined) created.runtimeMode = command.runtimeMode as NonNullable<T3Thread["runtimeMode"]>;
        if (command.interactionMode !== undefined) {
          created.interactionMode = command.interactionMode as NonNullable<T3Thread["interactionMode"]>;
        }
        if (command.branch !== undefined) created.branch = command.branch as string | null;
        threads.push(created);
      }
      if (command.type === "thread.turn.start") {
        const bootstrap = command.bootstrap as
          | { createThread?: Record<string, unknown> }
          | undefined;
        const createThread = bootstrap?.createThread;
        if (createThread) {
          threads.push({
            id: command.threadId as string,
            projectId: createThread.projectId as string,
            title: createThread.title as string,
            archivedAt: null,
            messages: [],
          });
        }
        const target = threads.find((thread) => thread.id === command.threadId);
        const message = command.message as { messageId?: string; text?: string } | undefined;
        if (target && message?.messageId) {
          const createdAt = command.createdAt as string;
          const existing = (target.messages ?? []) as unknown as Array<Record<string, unknown>>;
          const turnId = `turn-${sequence}`;
          target.messages = [
            ...existing,
            {
              id: message.messageId,
              role: "user",
              text: message.text ?? "",
              turnId,
              streaming: false,
              createdAt,
              updatedAt: createdAt,
            },
          ] as unknown as NonNullable<T3Thread["messages"]>;
          if (options.leaveTurnsRunning) {
            target.latestTurn = {
              turnId,
              state: "running",
              requestedAt: createdAt,
              startedAt: createdAt,
              completedAt: null,
              assistantMessageId: null,
            };
            target.session = {
              threadId: target.id,
              status: "running",
              providerName: target.modelSelection?.instanceId ?? "codex",
              runtimeMode: target.runtimeMode ?? "full-access",
              activeTurnId: turnId,
              lastError: null,
              updatedAt: createdAt,
            };
          } else {
            const assistantId = `assistant-${sequence}`;
            target.messages = [
              ...((target.messages ?? []) as unknown as Array<Record<string, unknown>>),
              {
                id: assistantId,
                role: "assistant",
                text: `Completed: ${message.text ?? ""}`,
                turnId,
                streaming: false,
                createdAt,
                updatedAt: createdAt,
              },
            ] as unknown as NonNullable<T3Thread["messages"]>;
            target.latestTurn = {
              turnId,
              state: "completed",
              requestedAt: createdAt,
              startedAt: createdAt,
              completedAt: createdAt,
              assistantMessageId: assistantId,
            };
            target.session = {
              threadId: target.id,
              status: "ready",
              providerName: target.modelSelection?.instanceId ?? "codex",
              runtimeMode: target.runtimeMode ?? "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: createdAt,
            };
          }
          target.updatedAt = createdAt;
          (target as Record<string, unknown>).latestUserMessageAt = createdAt;
        }
      }
      if (command.type === "thread.turn.interrupt") {
        const target = threads.find((thread) => thread.id === command.threadId);
        if (target) {
          const at = new Date().toISOString();
          if (target.latestTurn?.state === "running") {
            target.latestTurn = { ...target.latestTurn, state: "interrupted", completedAt: at };
          }
          if (target.session) {
            target.session = { ...target.session, status: "interrupted", activeTurnId: null, updatedAt: at };
          }
          target.updatedAt = at;
        }
      }
      if (command.type === "thread.snooze") {
        const target = threads.find((thread) => thread.id === command.threadId);
        if (target) {
          const at = new Date().toISOString();
          (target as Record<string, unknown>).snoozedUntil = command.snoozedUntil as string;
          (target as Record<string, unknown>).snoozedAt = at;
          target.updatedAt = at;
        }
      }
      if (command.type === "thread.unsnooze") {
        const target = threads.find((thread) => thread.id === command.threadId);
        if (target) {
          (target as Record<string, unknown>).snoozedUntil = null;
          target.updatedAt = new Date().toISOString();
        }
      }
      if (command.type === "thread.delete") {
        const index = threads.findIndex((thread) => thread.id === command.threadId);
        if (index >= 0) threads.splice(index, 1);
      }
      if (command.type === "thread.settle") {
        const target = threads.find((thread) => thread.id === command.threadId);
        if (target) {
          target.settledAt = new Date().toISOString();
          target.updatedAt = target.settledAt;
        }
      }
      if (command.type === "thread.unsettle") {
        const target = threads.find((thread) => thread.id === command.threadId);
        if (target) {
          target.settledAt = null;
          target.settledOverride = "active";
          target.unsettledAt = new Date().toISOString();
          target.updatedAt = target.unsettledAt;
        }
      }
      if (command.type === "thread.turn.start" && options.failTurn) {
        const index = threads.findIndex((thread) => thread.id === command.threadId);
        if (index >= 0) threads.splice(index, 1);
        json(response, 500, { error: "turn failed" });
        return;
      }
      json(response, 200, { sequence });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");

  const origin = `http://127.0.0.1:${address.port}`;
  const stateDir = path.join(root, ".t3", "userdata");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "server-runtime.json"),
    JSON.stringify({
      version: 1,
      pid: process.pid,
      port: address.port,
      origin,
      startedAt: new Date().toISOString(),
    }),
    "utf8",
  );
  if (options.settings) {
    await writeFile(path.join(stateDir, "settings.json"), JSON.stringify(options.settings), "utf8");
  }

  const config: CliConfig = {
    ...DEFAULT_CONFIG,
    origin,
    t3Home: path.join(root, ".t3"),
    t3Command: [process.execPath, mockT3],
    openMode: "none",
    threadEnvMode: "local",
  };
  return { root, config, projects, threads, commands };
}

export type TestHarness = Awaited<ReturnType<typeof testHarness>>;
