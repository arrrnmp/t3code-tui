/**
 * What a provider session starts with beyond its model — runtime
 * instructions — and delegation into a worktree of its own, observed
 * through the same `ClientApi` every client uses.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "../../core/infra/process.js";
import { testHarness } from "../../core/testing/harness.js";
import { DirectConnection } from "../connection.js";

async function connected(config: Record<string, unknown> = {}) {
  const starts: Array<Record<string, unknown>> = [];
  const harness = await testHarness({ onStartSession: (input) => starts.push(input) });
  const connection = new DirectConnection({
    storeRoot: harness.root,
    drivers: harness.drivers,
    config: async () => ({ ...harness.config, ...config }),
  });
  const startOf = (threadId: string) => starts.find((input) => input.threadId === threadId);
  return { harness, connection, startOf };
}

describe("skills.list", () => {
  it("answers with the provider's inventory, or an empty one for a driver without one", async () => {
    const { harness, connection } = await connected();
    try {
      // The harness driver has no inventory of its own.
      expect(await connection.query({ type: "skills.list", instanceId: "codex", cwd: harness.work })).toEqual({
        trigger: "/",
        skills: [],
        commands: [],
      });
      await expect(
        connection.query({ type: "skills.list", instanceId: "codex" } as unknown as { type: "skills.list"; instanceId: string; cwd: string }),
      ).rejects.toMatchObject({ code: expect.any(String) });
    } finally {
      await connection.close();
    }
  });
});

describe("session setup", () => {
  it("sends no instructions to a plain local thread", async () => {
    const { harness, connection, startOf } = await connected();
    try {
      const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Hi", wait: true, threadEnvMode: "local" });
      expect(startOf(done.threadId)).toBeDefined();
      expect(startOf(done.threadId)).not.toHaveProperty("instructions");
    } finally {
      await connection.close();
    }
  });

  it("appends config instructions, then the project's moxen.json", async () => {
    const { harness, connection, startOf } = await connected({ instructions: "Config rule." });
    try {
      await writeFile(path.join(harness.work, "moxen.json"), JSON.stringify({ instructions: "Project rule." }));
      const done = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Hi", wait: true, threadEnvMode: "local" });
      expect(startOf(done.threadId)?.instructions).toBe("Config rule.\n\nProject rule.");
    } finally {
      await connection.close();
    }
  });

  it("delegates into the child's own worktree and tells the child it is a delegated task", async () => {
    const { harness, connection, startOf } = await connected();
    try {
      const parent = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Parent", wait: true, threadEnvMode: "local" });
      const delegated = await connection.dispatch({
        type: "thread.delegate",
        parentThreadId: parent.threadId,
        task: "Sub task",
        isolation: "worktree",
      });
      expect(delegated.task).toMatchObject({ status: "completed" });
      const worktree = delegated.worktree!;
      expect(worktree.baseBranch).toBe("main");
      expect(worktree.branch).toMatch(/^moxen\//);
      expect(existsSync(worktree.path!)).toBe(true);
      // A real branch in the parent's repository, cut from its branch.
      const branches = await runProcess("git", ["branch", "--list", worktree.branch!], { cwd: harness.work });
      expect(branches.stdout).toContain(worktree.branch!);

      const child = startOf(delegated.child.id)!;
      expect(child.workingDirectory).toBe(worktree.path);
      expect(child.instructions).toContain("subagent");
      expect(child.instructions).toContain(`Commit your work on ${worktree.branch}`);
    } finally {
      await connection.close();
    }
  });

  it("dry-runs worktree isolation as a plan, provisioning nothing", async () => {
    const { harness, connection } = await connected();
    try {
      const parent = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Parent", wait: true, threadEnvMode: "local" });
      const plan = await connection.dispatch({
        type: "thread.delegate",
        parentThreadId: parent.threadId,
        task: "Sub task",
        isolation: "worktree",
        dryRun: true,
      });
      expect(plan.worktree).toEqual({ path: null, branch: null, baseBranch: "main" });
      const branches = await runProcess("git", ["branch", "--list", "moxen/*"], { cwd: harness.work });
      expect(branches.stdout.trim()).toBe("");
    } finally {
      await connection.close();
    }
  });
});
