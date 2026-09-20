import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { CliError } from "../../errors.js";
import { discoverRuntime } from "../../cli/infra/runtime.js";
import { testHarness } from "../../cli/testing/harness.js";
import { createBackend } from "../backend.js";
import { T3Backend } from "../t3.js";

async function seededBackend() {
  const harness = await testHarness();
  const workspaceRoot = await realpath(harness.root);
  harness.projects.push({
    id: "project-existing",
    title: "Existing project",
    workspaceRoot,
    defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    deletedAt: null,
  });
  harness.threads.push({
    id: "thread-existing",
    projectId: "project-existing",
    title: "Existing thread",
    archivedAt: null,
    modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
  });
  const runtime = await discoverRuntime(harness.config, { startDesktopIfNeeded: false });
  return { harness, backend: new T3Backend(runtime, harness.config) };
}

describe("T3Backend facade", () => {
  it("reports the t3 kind", async () => {
    const { backend } = await seededBackend();
    expect(backend.kind).toBe("t3");
  });

  it("lists the catalog through the T3 server", async () => {
    const { backend } = await seededBackend();
    const catalog = await backend.catalog();
    expect(catalog.threads.map((thread) => thread.id)).toEqual(["thread-existing"]);
    expect(catalog.projects.map((project) => project.id)).toEqual(["project-existing"]);
  });

  it("inspects a thread through the T3 server", async () => {
    const { backend } = await seededBackend();
    const detail = await backend.inspectThread("thread-existing");
    expect(detail.thread.id).toBe("thread-existing");
    expect(typeof detail.snapshotSequence).toBe("number");
  });

  it("surfaces unknown threads as THREAD_NOT_FOUND", async () => {
    const { backend } = await seededBackend();
    const error = await backend.inspectThread("thread-missing").catch((cause) => cause);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("THREAD_NOT_FOUND");
  });

  it("creates backends from the factory and rejects unknown kinds", async () => {
    const harness = await testHarness();
    const runtime = await discoverRuntime(harness.config, { startDesktopIfNeeded: false });
    expect(createBackend("t3", runtime, harness.config)).toBeInstanceOf(T3Backend);
    expect(() =>
      createBackend("cursor" as never, runtime, harness.config),
    ).toThrowError(CliError);
  });

  it("sends a turn through the T3 server with message-id verification", async () => {
    const { harness, backend } = await seededBackend();
    const sent = await backend.send("thread-existing", { prompt: "Hello direct" });
    expect(sent.threadId).toBe("thread-existing");
    expect(sent.delivery).toBe("started");
    expect(sent.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
  });
});
