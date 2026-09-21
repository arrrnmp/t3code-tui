import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
import { ensureStoredProject, listStoredProjects } from "../../../projects/projects.js";
import { readThread } from "../../../threads/threads.js";
import { testHarness } from "../../testing/harness.js";
import { createHandoverThread } from "../handover.js";

function storeRoot(): string {
  return process.env.T3CODE_STORE_ROOT!;
}

describe("createHandoverThread", () => {
  it("creates a missing project, thread, and first turn", async () => {
    const harness = await testHarness();

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Continue the implementation from this handover.",
      openMode: "none",
      drivers: harness.drivers,
    });

    expect(result.projectCreated).toBe(true);
    expect(result.workspace.workspaceRoot).toBe(await realpath(harness.work));
    expect(result.projectCommand).toMatchObject({ type: "project.create" });
    const createThread = result.thread.createCommand;
    expect(createThread).toMatchObject({ projectId: result.project.id, branch: "main" });
    expect(result.thread.command).toMatchObject({
      type: "thread.turn.start",
      message: { text: "Continue the implementation from this handover." },
    });
    expect(createThread.projectId).toBe(result.project.id);
    expect(createThread.branch).toBe("main");
    expect(createThread.modelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-5.4",
    });
    expect(createThread.modelSelection.options).toBeUndefined();
    expect(createThread.runtimeMode).toBe("full-access");
    expect(result.thread.command).toMatchObject({ runtimeMode: "full-access" });
    expect(result.opened.kind).toBe("none");
  });

  it("inherits an existing project's pre-configured model and options", async () => {
    const harness = await testHarness();
    await ensureStoredProject(storeRoot(), {
      id: "project-existing",
      title: "Existing project",
      workspaceRoot: await realpath(harness.work),
      defaultModelSelection: {
        instanceId: "claudeAgent",
        model: "claude-sonnet-5",
        options: [{ id: "effort", value: "max" }],
      },
    });

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      openMode: "none",
      drivers: harness.drivers,
    });

    expect(result.projectCreated).toBe(false);
    const expectedSelection = {
      instanceId: "claudeAgent",
      model: "claude-sonnet-5",
      options: [{ id: "effort", value: "max" }],
    };
    expect(result.thread.createCommand).toMatchObject({
      modelSelection: expectedSelection,
      runtimeMode: "full-access",
    });
    expect(result.thread.command).toMatchObject({
      modelSelection: expectedSelection,
      runtimeMode: "full-access",
    });
  });

  it("honors existing-only project policy", async () => {
    const harness = await testHarness();

    await expect(
      createHandoverThread(harness.config, {
        cwd: harness.work,
        prompt: "Handover",
        projectPolicy: "existing",
        openMode: "none",
        drivers: harness.drivers,
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" } satisfies Partial<CliError>);
    expect(await listStoredProjects(storeRoot())).toHaveLength(0);
  });

  it("supports a no-write dry run", async () => {
    const harness = await testHarness();

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      dryRun: true,
      openMode: "none",
    });

    expect(result.dryRun).toBe(true);
    expect(result.projectCommand).toMatchObject({ type: "project.create" });
    expect(result.thread.createCommand).toMatchObject({ type: "thread.create" });
    expect(result.thread.command).toMatchObject({ type: "thread.turn.start" });
    expect(await listStoredProjects(storeRoot())).toHaveLength(0);
  });

  it("uses the process working directory when cwd is omitted", async () => {
    const harness = await testHarness();

    const result = await createHandoverThread(harness.config, {
      prompt: "Handover",
      dryRun: true,
      openMode: "none",
    });

    expect(result.workspace.inputPath).toBe(await realpath(process.cwd()));
  });

  it("applies provider, model, speed, effort, permission, and interaction selections", async () => {
    const harness = await testHarness();

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      provider: "codex",
      model: "gpt-5.3-codex",
      speedMode: "fast",
      thinkingEffort: "high",
      runtimeMode: "approval-required",
      interactionMode: "plan",
      openMode: "none",
      drivers: harness.drivers,
    });

    const createThread = result.thread.createCommand;
    const turn = result.thread.command;
    expect(createThread.modelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-5.3-codex",
    });
    expect(createThread.modelSelection.options).toEqual(
      expect.arrayContaining([
        { id: "serviceTier", value: "fast" },
        { id: "fastMode", value: true },
        { id: "reasoningEffort", value: "high" },
        { id: "effort", value: "high" },
        { id: "reasoning", value: "high" },
      ]),
    );
    expect(createThread.runtimeMode).toBe("approval-required");
    expect(createThread.interactionMode).toBe("plan");
    expect(turn.modelSelection).toEqual(createThread.modelSelection);
  });

  it("provisions a local worktree and records it on the thread", async () => {
    const harness = await testHarness();

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      threadEnvMode: "worktree",
      openMode: "none",
      drivers: harness.drivers,
    });

    expect(result.thread.createCommand).toMatchObject({ type: "thread.create" });
    expect(result.thread.command).toMatchObject({ type: "thread.turn.start" });
    expect(result.thread.command).not.toHaveProperty("bootstrap");
    expect(result.worktree).toMatchObject({
      baseBranch: "main",
      startFromOrigin: true,
    });
    expect(result.worktree?.branch?.startsWith("t3code/")).toBe(true);
    expect(result.thread.createCommand.worktreePath).toBe(result.worktree?.path);
    const stored = await readThread(harness.store, result.thread.id);
    expect(stored.thread.env.mode).toBe("worktree");
    expect(stored.thread.env.path).toBe(result.worktree?.path);
  });

  it("uses explicit installation defaults", async () => {
    const harness = await testHarness();

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      threadEnvMode: "worktree",
      openMode: "none",
      dryRun: true,
    });

    expect(result.projectCommand).toMatchObject({ defaultModelSelection: null });
    expect(result.thread.command).toMatchObject({
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    });
    expect(result.worktree).toMatchObject({ startFromOrigin: true });
  });

  it("prefers a project's checkout setting over t3.json and the global setting", async () => {
    const harness = await testHarness();
    await writeFile(
      path.join(harness.work, "t3.json"),
      JSON.stringify({ defaultThreadEnvMode: "worktree" }),
      "utf8",
    );
    await ensureStoredProject(storeRoot(), {
      id: "project-existing",
      title: "Existing project",
      workspaceRoot: await realpath(harness.work),
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      defaultThreadEnvMode: "local",
    });
    harness.config.threadEnvMode = "t3";

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      dryRun: true,
      openMode: "none",
    });

    expect(result.settings).toMatchObject({
      effectiveThreadEnvMode: "local",
      threadEnvModeSource: "project",
    });
    expect(result.worktree).toBeNull();
  });

  it("prefers t3.json's checkout setting over the global setting", async () => {
    const harness = await testHarness();
    await writeFile(
      path.join(harness.work, "t3.json"),
      JSON.stringify({ defaultThreadEnvMode: "local" }),
      "utf8",
    );
    harness.config.threadEnvMode = "t3";

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      dryRun: true,
      openMode: "none",
    });

    expect(result.settings).toMatchObject({
      effectiveThreadEnvMode: "local",
      threadEnvModeSource: "t3.json",
    });
    expect(result.worktree).toBeNull();
  });

  it("uses the global checkout setting when the project and t3.json do not set one", async () => {
    const harness = await testHarness();
    harness.config.threadEnvMode = "worktree";

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      dryRun: true,
      openMode: "none",
    });

    expect(result.settings).toMatchObject({
      effectiveThreadEnvMode: "worktree",
      threadEnvModeSource: "global",
    });
    expect(result.worktree).toMatchObject({ baseBranch: "main" });
  });

  it("accepts the handover and records a later driver failure in the ledger", async () => {
    const harness = await testHarness({ failTurns: true });

    const result = await createHandoverThread(harness.config, {
      cwd: harness.work,
      prompt: "Handover",
      openMode: "none",
      drivers: harness.drivers,
    });
    expect(result.thread.id).toBeTruthy();

    const deadline = Date.now() + 5000;
    for (;;) {
      const read = await readThread(harness.store, result.thread.id);
      const last = read.turns[read.turns.length - 1];
      if (last?.status === "failed") break;
      if (Date.now() > deadline) throw new Error("turn did not fail");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const stored = await readThread(harness.store, result.thread.id);
    expect(stored.turns).toHaveLength(1);
  });
});
