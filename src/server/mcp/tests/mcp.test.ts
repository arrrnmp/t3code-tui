import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { testHarness } from "../../../core/testing/harness.js";
import { DirectConnection } from "../../connection.js";
import { openThreadStore } from "../../../core/threads/store.js";
import { serveMcp } from "../stdio.js";
import { callMoxenTool } from "../tools.js";

async function setup(harnessOptions: Parameters<typeof testHarness>[0] = {}) {
  const starts: Array<Record<string, unknown>> = [];
  const harness = await testHarness({ ...harnessOptions, onStartSession: (input) => starts.push(input) });
  const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers, config: async () => harness.config });
  const parent = await connection.dispatch({
    type: "thread.handover",
    cwd: harness.work,
    prompt: "Parent",
    // A parent whose turns never settle must not be waited on either.
    wait: harnessOptions.leaveTurnsRunning !== true,
    threadEnvMode: "local",
  });
  return { harness, connection, parentThreadId: parent.threadId, starts };
}

/** One MCP session over in-memory pipes: send requests, read each reply line. */
function mcpSession(connection: DirectConnection, parentThreadId: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const served = serveMcp({ api: connection, parentThreadId, input, output });
  const replies = new Map<number, (value: Record<string, unknown>) => void>();
  let buffer = "";
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const message = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      buffer = buffer.slice(newline + 1);
      replies.get(message.id as number)?.(message);
      newline = buffer.indexOf("\n");
    }
  });
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = nextId++;
      replies.set(id, resolve);
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const close = async () => {
    input.end();
    await served;
  };
  return { request, notify: (method: string) => input.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`), close };
}

describe("moxen MCP server", () => {
  it("speaks MCP: negotiates a version, lists its tools, rejects unknown methods", async () => {
    const { connection, parentThreadId } = await setup();
    const mcp = mcpSession(connection, parentThreadId);
    try {
      const init = await mcp.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t" } });
      expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "moxen" } });
      const unknownVersion = await mcp.request("initialize", { protocolVersion: "1999-01-01" });
      expect((unknownVersion.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
      mcp.notify("notifications/initialized");
      const listed = await mcp.request("tools/list");
      expect((listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
        "delegate",
        "task_status",
        "models",
        "task_cancel",
      ]);
      expect((await mcp.request("ping")).result).toEqual({});
      expect((await mcp.request("resources/list")).error).toMatchObject({ code: -32601 });
    } finally {
      await mcp.close();
      await connection.close();
    }
  });

  it("delegates into a worktree by default and reports the subagent's result", async () => {
    const { connection, parentThreadId, starts } = await setup();
    const mcp = mcpSession(connection, parentThreadId);
    try {
      const called = await mcp.request("tools/call", { name: "delegate", arguments: { task: "Write the changelog" } });
      const result = called.result as { content: Array<{ text: string }>; isError: boolean };
      expect(result.isError).toBe(false);
      const delegated = JSON.parse(result.content[0]!.text) as { taskId: string; isolation: string; branch: string };
      expect(delegated.isolation).toBe("worktree");
      expect(delegated.branch).toMatch(/^moxen\//);

      const status = await mcp.request("tools/call", { name: "task_status", arguments: { taskId: delegated.taskId, waitMs: 5000 } });
      const report = JSON.parse((status.result as { content: Array<{ text: string }> }).content[0]!.text);
      expect(report).toMatchObject({ status: "completed", finished: true, report: "Completed: Write the changelog", branch: delegated.branch });

      // The parent's session carries the tools; the subagent's does not.
      const names = (input: Record<string, unknown> | undefined) =>
        ((input?.mcpServers as Array<{ name: string }> | undefined) ?? []).map((server) => server.name);
      expect(names(starts.find((input) => input.threadId === parentThreadId))).toContain("moxen");
      expect(names(starts.find((input) => input.threadId === delegated.taskId))).not.toContain("moxen");
    } finally {
      await mcp.close();
      await connection.close();
    }
  });

  it("tells the parent thread when a delegated task settles, with its facts for a card", async () => {
    const { harness, connection, parentThreadId } = await setup();
    try {
      const delegated = JSON.parse(
        (await callMoxenTool(connection, parentThreadId, "delegate", { task: "Write the changelog", title: "changelog", isolation: "shared" })).text,
      ) as { taskId: string };
      // The task settles, then the batch window passes and the parent hears of it.
      const store = await openThreadStore(harness.root);
      const deadline = Date.now() + 8000;
      let notification: Record<string, unknown> | undefined;
      while (Date.now() < deadline && notification === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const messages = (await store.readMessages(parentThreadId)) as unknown as Array<Record<string, unknown>>;
        notification = messages.find((message) => message.origin === "task-notification");
      }
      expect(notification).toBeDefined();
      expect(notification!.text).toContain(`Task "changelog" (taskId ${delegated.taskId}) finished`);
      expect(notification!.text).toContain("Headline: Completed: Write the changelog");
      expect(notification!.notification).toMatchObject({
        tasks: [{ taskId: delegated.taskId, title: "changelog", status: "completed", headline: "Completed: Write the changelog" }],
      });
    } finally {
      await connection.close();
    }
  }, 15_000);

  it("forks: the task resumes a copy of the parent's conversation, in the parent's checkout", async () => {
    const { connection, parentThreadId, starts } = await setup();
    try {
      const delegated = JSON.parse(
        (await callMoxenTool(connection, parentThreadId, "delegate", { task: "What did we decide about caching?", fork: true })).text,
      ) as { taskId: string; isolation: string };
      expect(delegated.isolation).toBe("shared");
      const childStart = starts.find((input) => input.threadId === delegated.taskId);
      expect(childStart?.resumeCursor).toBe(`fork-of-harness-session-${parentThreadId}`);
      const inWorktree = await callMoxenTool(connection, parentThreadId, "delegate", { task: "x", fork: true, isolation: "worktree" });
      expect(inWorktree).toMatchObject({ isError: true, text: expect.stringContaining("FORK_NEEDS_SHARED") });
    } finally {
      await connection.close();
    }
  });

  it("answers bad input and unknown tasks as tool errors, not protocol errors", async () => {
    const { connection, parentThreadId } = await setup();
    try {
      expect(await callMoxenTool(connection, parentThreadId, "delegate", {})).toMatchObject({ isError: true, text: expect.stringContaining("task is required") });
      expect(await callMoxenTool(connection, parentThreadId, "delegate", { task: "x", isolation: "sideways" })).toMatchObject({ isError: true });
      expect(await callMoxenTool(connection, parentThreadId, "task_status", { taskId: "nope", waitMs: 0 })).toMatchObject({
        isError: true,
        text: expect.stringContaining("TASK_NOT_FOUND"),
      });
      expect(await callMoxenTool(connection, parentThreadId, "frobnicate", {})).toMatchObject({ isError: true });
    } finally {
      await connection.close();
    }
  });

  it("returns a running task after the wait instead of blocking", async () => {
    const { connection, parentThreadId } = await setup({ leaveTurnsRunning: true });
    try {
      const delegated = JSON.parse(
        (await callMoxenTool(connection, parentThreadId, "delegate", { task: "Long job", isolation: "shared" })).text,
      ) as { taskId: string };
      const sleeps: number[] = [];
      const status = await callMoxenTool(connection, parentThreadId, "task_status", { taskId: delegated.taskId, waitMs: 0 }, {
        sleep: async (ms) => void sleeps.push(ms),
      });
      expect(JSON.parse(status.text)).toMatchObject({ status: "running", finished: false });
      const cancelled = await callMoxenTool(connection, parentThreadId, "task_cancel", { taskId: delegated.taskId });
      expect(JSON.parse(cancelled.text)).toMatchObject({ cancelRequested: true });
    } finally {
      await connection.close();
    }
  });

  it("can be switched off per project with moxen.json", async () => {
    const { harness, connection, starts } = await setup();
    try {
      await writeFile(path.join(harness.work, "moxen.json"), JSON.stringify({ mcpServers: { moxen: null } }));
      const other = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Again", wait: true, threadEnvMode: "local" });
      const start = starts.find((input) => input.threadId === other.threadId);
      expect(start).not.toHaveProperty("mcpServers");
    } finally {
      await connection.close();
    }
  });

  it("is hosted in-process unless the project points the name at a server of its own", async () => {
    const { harness, connection, starts, parentThreadId } = await setup();
    try {
      const first = starts.find((input) => input.threadId === parentThreadId) as { mcpServers: Array<{ name: string; type: string }> };
      expect(first.mcpServers.find((server) => server.name === "moxen")?.type).toBe("in-process");
      await writeFile(path.join(harness.work, "moxen.json"), JSON.stringify({ mcpServers: { moxen: { command: "my-moxen" } } }));
      const other = await connection.dispatch({ type: "thread.handover", cwd: harness.work, prompt: "Again", wait: true, threadEnvMode: "local" });
      const start = starts.find((input) => input.threadId === other.threadId) as { mcpServers: Array<Record<string, unknown>> };
      expect(start.mcpServers.find((server) => server.name === "moxen")).toMatchObject({ type: "stdio", command: "my-moxen" });
    } finally {
      await connection.close();
    }
  });
});
