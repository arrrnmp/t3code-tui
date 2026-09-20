import { describe, expect, it } from "vitest";

import { createLinkedPair, JsonRpcPeer } from "../stdio.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("stdio JSON-RPC peer", () => {
  it("routes requests, notifications, and server requests over a linked pair", async () => {
    const { client, server } = createLinkedPair();
    const clientPeer = new JsonRpcPeer(client, { forceKillAfterMs: 0 });
    const serverPeer = new JsonRpcPeer(server, { forceKillAfterMs: 0 });

    const notifications: Array<{ method: string; params: unknown }> = [];
    serverPeer.onNotification((method, params) => {
      notifications.push({ method, params });
    });
    serverPeer.onRequest(async (method, params) => {
      if (method === "add") {
        const { a, b } = params as { a: number; b: number };
        return a + b;
      }
      throw new Error(`unknown ${method}`);
    });

    const serverRequests: Array<{ method: string; params: unknown }> = [];
    clientPeer.onRequest(async (method, params) => {
      serverRequests.push({ method, params });
      return { ok: true };
    });

    await expect(clientPeer.request("add", { a: 2, b: 3 })).resolves.toBe(5);
    clientPeer.notify("event/happened", { n: 1 });
    await sleep(20);
    expect(notifications).toEqual([{ method: "event/happened", params: { n: 1 } }]);

    await expect(serverPeer.request("client/ping", {})).resolves.toEqual({ ok: true });
    expect(serverRequests).toEqual([{ method: "client/ping", params: {} }]);

    await expect(clientPeer.request("nope", {}, 50)).rejects.toMatchObject({
      code: "PEER_REQUEST_FAILED",
    });
  });

  it("times out and closes cleanly", async () => {
    const { client, server } = createLinkedPair();
    const clientPeer = new JsonRpcPeer(client, { forceKillAfterMs: 0 });
    const serverPeer = new JsonRpcPeer(server, { forceKillAfterMs: 0 });
    serverPeer.onRequest(async () => {
      await sleep(500);
      return null;
    });
    await expect(clientPeer.request("slow", {}, 30)).rejects.toMatchObject({
      code: "PEER_REQUEST_TIMEOUT",
    });

    let exitCode: number | null | undefined;
    clientPeer.onExit((code) => {
      exitCode = code;
    });
    clientPeer.close();
    expect(clientPeer.closed).toBe(true);
    await expect(clientPeer.request("late", {})).rejects.toMatchObject({ code: "PEER_CLOSED" });
    expect(exitCode).toBeUndefined();
  });

  it("delivers bursts of notifications in order", async () => {
    const { client, server } = createLinkedPair();
    const clientPeer = new JsonRpcPeer(client, { forceKillAfterMs: 0 });
    const serverPeer = new JsonRpcPeer(server, { forceKillAfterMs: 0 });
    const received: unknown[] = [];
    serverPeer.onNotification((_method, params) => {
      received.push(params);
    });
    clientPeer.notify("m", { v: 1 });
    clientPeer.notify("m", { v: 2 });
    clientPeer.notify("m", { v: 3 });
    await sleep(20);
    expect(received).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    clientPeer.close();
    serverPeer.close();
  });
});
