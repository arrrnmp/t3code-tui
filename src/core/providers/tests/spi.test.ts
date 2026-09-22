import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import {
  isProviderDriverKind,
  PROVIDER_DRIVER_KINDS,
  type ProviderAdapter,
} from "../spi.js";

function stubAdapter(): ProviderAdapter {
  const unsupported = (): Effect.Effect<never, Error> =>
    Effect.die(new Error("not implemented"));
  return {
    provider: "codex",
    capabilities: { sessionModelSwitch: "unsupported" },
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => Effect.void as Effect.Effect<void, Error>,
    respondToRequest: () => Effect.void as Effect.Effect<void, Error>,
    respondToUserInput: () => Effect.void as Effect.Effect<void, Error>,
    stopSession: () => Effect.void as Effect.Effect<void, Error>,
    listSessions: () => Effect.succeed([]),
    hasSession: () => Effect.succeed(false),
    readThread: () => unsupported(),
    rollbackThread: () => unsupported(),
    stopAll: () => Effect.void as Effect.Effect<void, Error>,
    streamEvents: Stream.empty,
  };
}

describe("provider SPI", () => {
  it("names exactly the four owned surfaces", () => {
    expect([...PROVIDER_DRIVER_KINDS]).toEqual(["claude", "codex", "grok", "opencode"]);
  });

  it("guards driver kinds", () => {
    expect(isProviderDriverKind("claude")).toBe(true);
    expect(isProviderDriverKind("codex")).toBe(true);
    expect(isProviderDriverKind("grok")).toBe(true);
    expect(isProviderDriverKind("opencode")).toBe(true);
    expect(isProviderDriverKind("cursor")).toBe(false);
    expect(isProviderDriverKind("t3")).toBe(false);
    expect(isProviderDriverKind(undefined)).toBe(false);
  });

  it("accepts a stub implementing the full adapter shape", () => {
    const adapter = stubAdapter();
    for (const key of [
      "startSession",
      "sendTurn",
      "interruptTurn",
      "respondToRequest",
      "respondToUserInput",
      "stopSession",
      "listSessions",
      "hasSession",
      "readThread",
      "rollbackThread",
      "stopAll",
      "streamEvents",
    ] as const) {
      expect(adapter[key]).toBeDefined();
    }
    expect(adapter.provider).toBe("codex");
  });

  it("runs trivial effects against the upgraded Effect runtime", async () => {
    const adapter = stubAdapter();
    await expect(Effect.runPromise(adapter.hasSession("thread-1"))).resolves.toBe(false);
    await expect(Effect.runPromise(adapter.listSessions())).resolves.toEqual([]);
  });
});
