import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../../core/errors.js";
import { testHarness, type TestHarness } from "../../../core/testing/harness.js";
import type { ShellFrame } from "../../api.js";
import { openClient } from "../../client.js";
import { DirectConnection } from "../../connection.js";
import { probe } from "../endpoint.js";
import { RemoteConnection } from "../remote.js";
import { serve, type ServerHandle } from "../serve.js";
import { encode, LineReader, PROTOCOL_VERSION } from "../wire.js";
import { testEndpoint } from "./endpoint.js";

const teardown: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const step of teardown.splice(0).reverse()) await step().catch(() => undefined);
});

async function served(harness: TestHarness, endpoint = testEndpoint()): Promise<ServerHandle> {
  const api = new DirectConnection({
    storeRoot: harness.root,
    drivers: harness.drivers,
    config: async () => harness.config,
    shellPollMs: 50,
  });
  const handle = await serve({ endpoint, api, onClose: () => api.close() });
  teardown.push(() => handle.close());
  return handle;
}

async function connected(endpoint: string): Promise<RemoteConnection> {
  const connection = await RemoteConnection.connect(endpoint);
  teardown.push(() => connection.close());
  return connection;
}

async function waitFor(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** One raw request on a fresh socket, for the handshake rules. */
async function raw(endpoint: string, lines: object[]): Promise<Array<Record<string, unknown>>> {
  const socket = net.connect(endpoint);
  socket.setEncoding("utf8");
  const reader = new LineReader();
  const replies: Array<Record<string, unknown>> = [];
  socket.on("data", (chunk: string) => {
    for (const line of reader.push(chunk)) replies.push(JSON.parse(line) as Record<string, unknown>);
  });
  await new Promise((resolve) => socket.once("connect", resolve));
  for (const line of lines) socket.write(encode(line as never));
  await waitFor("replies", () => replies.length >= lines.length);
  socket.destroy();
  return replies;
}

describe("transport", () => {
  it("carries commands, queries and errors — code, details and exit code intact", async () => {
    const harness = await testHarness();
    const handle = await served(harness);
    const client = await connected(handle.endpoint);
    expect(client.helloResult).toMatchObject({ protocol: PROTOCOL_VERSION, server: "moxen", pid: process.pid });

    const ensured = await client.dispatch({ type: "project.ensure", cwd: harness.work });
    expect(ensured.created).toBe(true);
    expect((await client.query({ type: "projects.list" })).projects.map((project) => project.id)).toEqual([
      ensured.project.id,
    ]);

    const error = await client.query({ type: "thread.inspect", threadId: "missing" }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: "THREAD_NOT_FOUND", exitCode: 3, details: { threadId: "missing" } });
  });

  it("requires the handshake, and refuses a client speaking another protocol", async () => {
    const harness = await testHarness();
    const handle = await served(harness);
    const [early] = await raw(handle.endpoint, [{ id: 1, method: "query", params: { type: "projects.list" } }]);
    expect(early).toMatchObject({ id: 1, error: { code: "PROTOCOL_HELLO_REQUIRED" } });
    const [mismatch] = await raw(handle.endpoint, [{ id: 1, method: "hello", params: { protocol: PROTOCOL_VERSION + 1 } }]);
    expect(mismatch).toMatchObject({ id: 1, error: { code: "PROTOCOL_MISMATCH" } });
  });

  it("allows one server per endpoint", async () => {
    const harness = await testHarness();
    const handle = await served(harness);
    await expect(served(harness, handle.endpoint)).rejects.toMatchObject({ code: "SERVER_RUNNING" });
  });

  it("resumes subscriptions after the server restarts, from a fresh snapshot", async () => {
    const harness = await testHarness();
    const endpoint = testEndpoint();
    const first = await served(harness, endpoint);
    const client = await connected(endpoint);
    const frames: ShellFrame[] = [];
    const unsubscribe = client.subscribeShell({}, (frame) => frames.push(frame), () => undefined);
    teardown.push(async () => unsubscribe());
    await waitFor("the first snapshot", () => frames.some((frame) => frame.kind === "snapshot"));

    // Work in flight when the server dies fails loudly rather than hanging.
    await client.dispatch({ type: "project.ensure", cwd: harness.work });
    await first.close();
    await expect(client.query({ type: "projects.list" })).rejects.toMatchObject({ code: "SERVER_DISCONNECTED" });

    const seen = frames.length;
    await served(harness, endpoint);
    await waitFor("a snapshot from the restarted server", () =>
      frames.slice(seen).some((frame) => frame.kind === "snapshot" && frame.snapshot.projects.length === 1),
    );
    expect((await client.query({ type: "projects.list" })).projects).toHaveLength(1);
  });

  it("picks in-process or server by mode", async () => {
    const harness = await testHarness();
    const endpoint = testEndpoint();
    const alone = await openClient({ mode: "auto", endpoint, config: harness.config });
    teardown.push(() => alone.close());
    expect(alone).toBeInstanceOf(DirectConnection);

    await served(harness, endpoint);
    const shared = await openClient({ mode: "auto", endpoint });
    teardown.push(() => shared.close());
    expect(shared).toBeInstanceOf(RemoteConnection);
    const forced = await openClient({ mode: "direct", endpoint, config: harness.config });
    teardown.push(() => forced.close());
    expect(forced).toBeInstanceOf(DirectConnection);
  });

  it("starts a detached server on demand and can stop it", async () => {
    // The spawned server inherits this test's store and (absent) config
    // through the harness environment, so it touches nothing real.
    const harness = await testHarness();
    const endpoint = testEndpoint();
    const client = await openClient({ mode: "daemon", endpoint });
    expect(client).toBeInstanceOf(RemoteConnection);
    const remote = client as RemoteConnection;
    expect(remote.helloResult?.pid).not.toBe(process.pid);
    const ensured = await remote.dispatch({ type: "project.ensure", cwd: harness.work });
    expect(ensured.project.workspaceRoot.length).toBeGreaterThan(0);

    await remote.shutdownServer();
    await remote.close();
    await waitFor("the server to stop", async () => !(await probe(endpoint)));
  }, 30_000);
});
