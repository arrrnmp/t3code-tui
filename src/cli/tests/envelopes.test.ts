/**
 * Golden `--json` envelopes: the byte-level contract with scripts that
 * parse the CLI's output.
 *
 * `index.ts` hands each command's result to `writeSuccess` unchanged, so
 * the module functions' return values *are* the `data` of the envelope
 * (and a thrown `CliError`'s code/message/details are its `error`). Each
 * case runs one command against a fresh store and compares the result,
 * serialized exactly as `writeSuccess` does, with a checked-in file.
 *
 * Only the values that differ run to run are normalized — ids, times,
 * temp paths, commit hashes. Keys, key order, nesting, nulls and every
 * other value are compared as printed. A diff here means a script parsing
 * `moxen --json` would see something different.
 *
 * Commands whose output depends on the machine rather than the store
 * (`doctor`, `providers`, `config`) are not covered here.
 *
 * The whole suite runs twice against the same files: once in-process, and
 * once with every CLI call going over the wire to a server
 * (`server/transport/`). Identical bytes both ways is the transport's
 * contract — a client cannot tell which one it is talking to.
 */
import { realpath } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../../core/errors.js";
import { ensureStoredProject } from "../../core/projects/projects.js";
import { archiveThread, createThread, sendTurn } from "../../core/threads/threads.js";
import { createHandoverThread } from "../handover/handover.js";
import { ensureProject, listProjects, resolveProject } from "../projects/projects.js";
import { testHarness, type TestHarness } from "../../core/testing/harness.js";
import { DirectConnection } from "../../server/connection.js";
import { serve } from "../../server/transport/serve.js";
import { RemoteConnection } from "../../server/transport/remote.js";
import { testEndpoint } from "../../server/transport/tests/endpoint.js";
import { setClientFactory } from "../infra/client.js";
import {
  archiveThread as archiveThreadCommand,
  cancelTask,
  deleteThread as deleteThreadCommand,
  delegateTask,
  inspectThread,
  interruptThread,
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
} from "../threads/threads.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu;
const SHA = /\b[0-9a-f]{40}\b/gu;
/** Worktree branches are named after the thread id's first 8 hex digits. */
const WORKTREE_BRANCH = /\b([a-z]+)\/[0-9a-f]{8}(-\d+)?\b/gu;

/** Replaces run-specific values, numbering ids by first appearance so references still line up. */
function normalizer(roots: readonly string[]) {
  const ids = new Map<string, string>();
  const variants = [...new Set(roots.flatMap((root) => [root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")]))]
    .filter((root) => root.length > 0)
    .sort((left, right) => right.length - left.length);
  const text = (value: string): string => {
    let out = value;
    for (const root of variants) out = out.split(root).join("<root>");
    // The rest of a rooted path uses the host's separator; pin it to `/` so
    // one golden holds on Windows and POSIX alike.
    if (out.includes("<root>")) out = out.replaceAll("\\", "/");
    out = out.replace(UUID, (id) => {
      const key = id.toLowerCase();
      if (!ids.has(key)) ids.set(key, `<id-${ids.size + 1}>`);
      return ids.get(key)!;
    });
    return out.replace(ISO_TIME, "<time>").replace(SHA, "<sha>").replace(WORKTREE_BRANCH, "$1/<short>$2");
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      // Keys too: `turnModelSelections` is keyed by turn id.
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [text(key), walk(entry)]));
    }
    return value;
  };
  return walk;
}

async function roots(harness: TestHarness): Promise<string[]> {
  return [harness.root, await realpath(harness.root), harness.work, await realpath(harness.work)];
}

/** What `writeSuccess` prints for `--json`. */
async function success(harness: TestHarness, data: unknown): Promise<string> {
  return `${JSON.stringify({ ok: true, data: normalizer(await roots(harness))(data) }, null, 2)}\n`;
}

/** What `writeError` prints for `--json`. */
async function failure(harness: TestHarness, run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (cause) {
    if (!(cause instanceof CliError)) throw cause;
    const error = {
      code: cause.code,
      message: cause.message,
      ...(cause.details === undefined ? {} : { details: cause.details }),
    };
    return `${JSON.stringify({ ok: false, error: normalizer(await roots(harness))(error) }, null, 2)}\n`;
  }
  throw new Error("expected the command to fail");
}

type Mode = "direct" | "remote";
let mode: Mode = "direct";
const teardown: Array<() => Promise<void>> = [];

afterEach(async () => {
  setClientFactory(null);
  for (const step of teardown.splice(0).reverse()) await step();
});

/**
 * A fresh store; in `remote` mode also a server over it, which every CLI
 * call from here on goes through. Tests use one harness at a time, so the
 * latest one is the one being called.
 */
async function harnessFor(options: Parameters<typeof testHarness>[0] = {}): Promise<TestHarness> {
  const harness = await testHarness(options);
  if (mode === "remote") {
    const endpoint = testEndpoint();
    const api = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
    const server = await serve({ endpoint, api, onClose: () => api.close() });
    const connections: RemoteConnection[] = [];
    setClientFactory(async () => {
      const connection = await RemoteConnection.connect(endpoint);
      connections.push(connection);
      return connection;
    });
    teardown.push(async () => {
      // A remote case that never opened a connection fell back in-process
      // and proved nothing about the wire.
      expect(connections.length).toBeGreaterThan(0);
      for (const connection of connections) await connection.close();
      await server.close();
    });
  }
  return harness;
}

const golden = (name: string): string => path.join(__dirname, "envelopes", `${name}.json`);

async function seeded(options: Parameters<typeof testHarness>[0] = {}) {
  const harness = await harnessFor(options);
  await ensureStoredProject(harness.root, {
    id: "project-existing",
    title: "Existing project",
    workspaceRoot: await realpath(harness.work),
    defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
  });
  await createThread(harness.store, {
    id: "thread-existing",
    projectId: "project-existing",
    title: "Existing thread",
    modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    env: { mode: "local", path: await realpath(harness.work), branch: "main" },
  });
  return harness;
}

async function turnSettled(harness: TestHarness, threadId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const turns = await harness.store.readTurns(threadId);
    if (turns.length > 0 && turns.every((turn) => turn.status !== "running" && turn.status !== "queued")) return;
    if (Date.now() > deadline) throw new Error(`turns on ${threadId} never settled`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function suite(): void {
  describe("projects", () => {
    it("list", async () => {
      const harness = await seeded();
      await expect(await success(harness, await listProjects(harness.config))).toMatchFileSnapshot(golden("projects-list"));
    });

    it("resolve", async () => {
      const harness = await seeded();
      const result = await resolveProject(harness.config, { cwd: harness.work });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("projects-resolve"));
    });

    it("ensure (existing, new, dry run)", async () => {
      const harness = await seeded();
      const existing = await ensureProject(harness.config, { cwd: harness.work });
      await expect(await success(harness, existing)).toMatchFileSnapshot(golden("projects-ensure-existing"));

      const fresh = await harnessFor();
      const dryRun = await ensureProject(fresh.config, { cwd: fresh.work, dryRun: true });
      await expect(await success(fresh, dryRun)).toMatchFileSnapshot(golden("projects-ensure-dry-run"));
      const created = await ensureProject(fresh.config, { cwd: fresh.work });
      await expect(await success(fresh, created)).toMatchFileSnapshot(golden("projects-ensure-created"));
    });

    it("ensure under the existing policy", async () => {
      const harness = await harnessFor();
      const error = await failure(harness, () =>
        ensureProject(harness.config, { cwd: harness.work, projectPolicy: "existing" }),
      );
      await expect(error).toMatchFileSnapshot(golden("error-project-not-found"));
    });
  });

  describe("threads create", () => {
    it("local, waited", async () => {
      const harness = await harnessFor();
      const result = await createHandoverThread(harness.config, {
        cwd: harness.work,
        prompt: "Plan the release\nwith details",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-create"));
    });

    it("dry run", async () => {
      const harness = await harnessFor();
      const result = await createHandoverThread(harness.config, {
        cwd: harness.work,
        prompt: "Plan the release",
        dryRun: true,
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-create-dry-run"));
    });

    it("worktree", async () => {
      const harness = await harnessFor();
      const result = await createHandoverThread(harness.config, {
        cwd: harness.work,
        prompt: "Isolated change",
        threadEnvMode: "worktree",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-create-worktree"));
    });
  });

  describe("threads send", () => {
    it("started, waited", async () => {
      const harness = await seeded();
      const result = await sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello there",
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-send"));
    });

    it("model override and handoff note", async () => {
      const harness = await seeded();
      const result = await sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Switch it up",
        model: "gpt-5.6-terra",
        thinkingEffort: "high",
        handoffNote: "Picked up from the CLI",
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-send-override"));
    });

    it("dry run with restart delivery", async () => {
      const harness = await seeded({ leaveTurnsRunning: true });
      await sendTurn(harness.store, "thread-existing", { prompt: "First" });
      const result = await sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Start over",
        delivery: "restart",
        dryRun: true,
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-send-dry-run-restart"));
    });

    it("queued behind a busy turn", async () => {
      const harness = await seeded({ leaveTurnsRunning: true });
      await sendTurn(harness.store, "thread-existing", { prompt: "First" });
      const result = await sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Follow-up",
        delivery: "queue",
        noWait: true,
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-send-queued"));
    });

    it("refused: busy, settled, archived", async () => {
      const busy = await seeded({ leaveTurnsRunning: true });
      await sendTurn(busy.store, "thread-existing", { prompt: "First" });
      const refuse = (harness: TestHarness) => () =>
        sendThreadMessage(harness.config, {
          threadId: "thread-existing",
          prompt: "Again",
          openMode: "none",
          drivers: harness.drivers,
        });
      await expect(await failure(busy, refuse(busy))).toMatchFileSnapshot(golden("error-thread-busy"));

      const settled = await seeded();
      await settleThread(settled.config, "thread-existing");
      await expect(await failure(settled, refuse(settled))).toMatchFileSnapshot(golden("error-settled-confirmation"));

      const archived = await seeded();
      await archiveThread(archived.store, "thread-existing");
      await expect(await failure(archived, refuse(archived))).toMatchFileSnapshot(golden("error-thread-archived"));
    });
  });

  describe("threads reads", () => {
    async function withHistory() {
      const harness = await seeded();
      await sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Summarize the repo",
        openMode: "none",
        drivers: harness.drivers,
      });
      await turnSettled(harness, "thread-existing");
      return harness;
    }

    it("list", async () => {
      const harness = await withHistory();
      const result = await listThreads(harness.config, { cwd: harness.work });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-list"));
    });

    it("inspect", async () => {
      const harness = await withHistory();
      const result = await inspectThread(harness.config, "thread-existing");
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-inspect"));
    });

    it("read, every view", async () => {
      const harness = await withHistory();
      for (const view of ["messages", "turn-items", "plans", "checkpoints", "transfers"] as const) {
        const result = await readThread(harness.config, "thread-existing", { view });
        await expect(await success(harness, result)).toMatchFileSnapshot(golden(`threads-read-${view}`));
      }
      const lastTurn = await readThread(harness.config, "thread-existing", { lastTurn: true });
      await expect(await success(harness, lastTurn)).toMatchFileSnapshot(golden("threads-read-last-turn"));
    });

    it("read an unknown view", async () => {
      const harness = await seeded();
      const error = await failure(harness, () =>
        readThread(harness.config, "thread-existing", { view: "everything" as never }),
      );
      await expect(error).toMatchFileSnapshot(golden("error-invalid-view"));
    });
  });

  describe("threads lifecycle", () => {
    it("settle, unsettle, snooze, unsnooze", async () => {
      const harness = await seeded();
      const settled = await settleThread(harness.config, "thread-existing");
      await expect(await success(harness, settled)).toMatchFileSnapshot(golden("threads-settle"));
      const unsettled = await unsettleThread(harness.config, "thread-existing");
      await expect(await success(harness, unsettled)).toMatchFileSnapshot(golden("threads-unsettle"));
      const snoozed = await snoozeThread(harness.config, "thread-existing", "2099-01-01T00:00:00Z");
      await expect(await success(harness, snoozed)).toMatchFileSnapshot(golden("threads-snooze"));
      const unsnoozed = await unsnoozeThread(harness.config, "thread-existing");
      await expect(await success(harness, unsnoozed)).toMatchFileSnapshot(golden("threads-unsnooze"));
    });

    it("revert", async () => {
      const harness = await seeded();
      for (const prompt of ["First", "Second"]) {
        await sendThreadMessage(harness.config, { threadId: "thread-existing", prompt, openMode: "none", drivers: harness.drivers });
      }
      const reverted = await revertConversation(harness.config, "thread-existing", "1", { drivers: harness.drivers });
      await expect(await success(harness, reverted)).toMatchFileSnapshot(golden("threads-revert"));
      const error = await failure(harness, () =>
        revertConversation(harness.config, "thread-existing", "-1", { drivers: harness.drivers }),
      );
      await expect(error).toMatchFileSnapshot(golden("error-revert-keep"));
    });

    it("rename, archive, delete", async () => {
      const harness = await seeded();
      const renamed = await renameThread(harness.config, "thread-existing", "  Better   title ");
      await expect(await success(harness, renamed)).toMatchFileSnapshot(golden("threads-rename"));
      const archived = await archiveThreadCommand(harness.config, "thread-existing");
      await expect(await success(harness, archived)).toMatchFileSnapshot(golden("threads-archive"));
      const deleted = await deleteThreadCommand(harness.config, "thread-existing");
      await expect(await success(harness, deleted)).toMatchFileSnapshot(golden("threads-delete"));
    });

    it("interrupt: idle and running", async () => {
      const idle = await seeded();
      const none = await interruptThread(idle.config, "thread-existing");
      await expect(await success(idle, none)).toMatchFileSnapshot(golden("threads-interrupt-idle"));

      const busy = await seeded({ leaveTurnsRunning: true });
      await sendThreadMessage(busy.config, {
        threadId: "thread-existing",
        prompt: "Long job",
        noWait: true,
        openMode: "none",
        drivers: busy.drivers,
      });
      const requested = await interruptThread(busy.config, "thread-existing");
      await expect(await success(busy, requested)).toMatchFileSnapshot(golden("threads-interrupt-running"));
    });
  });

  describe("delegation", () => {
    it("delegate (waited), task status, cancel after completion", async () => {
      const harness = await seeded();
      const delegated = await delegateTask(harness.config, {
        parentThreadId: "thread-existing",
        task: "Write the changelog",
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, delegated)).toMatchFileSnapshot(golden("threads-delegate"));
      const status = await taskStatus(harness.config, "thread-existing", delegated.task.taskId);
      await expect(await success(harness, status)).toMatchFileSnapshot(golden("threads-task-status"));
      const cancelled = await cancelTask(harness.config, "thread-existing", delegated.task.taskId);
      await expect(await success(harness, cancelled)).toMatchFileSnapshot(golden("threads-task-cancel-finished"));
    });

    it("delegate without waiting, then cancel the running task", async () => {
      const harness = await seeded({ leaveTurnsRunning: true });
      const delegated = await delegateTask(harness.config, {
        parentThreadId: "thread-existing",
        task: "Long research",
        wait: false,
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, delegated)).toMatchFileSnapshot(golden("threads-delegate-no-wait"));
      const cancelled = await cancelTask(harness.config, "thread-existing", delegated.task.taskId);
      await expect(await success(harness, cancelled)).toMatchFileSnapshot(golden("threads-task-cancel-running"));
    });

    it("delegate dry run", async () => {
      const harness = await seeded();
      const result = await delegateTask(harness.config, {
        parentThreadId: "thread-existing",
        task: "Maybe later",
        dryRun: true,
        openMode: "none",
        drivers: harness.drivers,
      });
      await expect(await success(harness, result)).toMatchFileSnapshot(golden("threads-delegate-dry-run"));
    });

    it("unknown task", async () => {
      const harness = await seeded();
      const error = await failure(harness, () => taskStatus(harness.config, "thread-existing", "no-such-task"));
      await expect(error).toMatchFileSnapshot(golden("error-task-not-found"));
    });
  });
}

for (const each of ["direct", "remote"] as const) {
  describe(`--json envelopes (${each})`, () => {
    beforeEach(() => {
      mode = each;
    });
    suite();
  });
}
