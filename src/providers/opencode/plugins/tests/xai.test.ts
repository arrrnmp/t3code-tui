import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accessTokenIsExpiring,
  pollDeviceCodeToken,
  requestDeviceCode,
  XaiAuthPlugin,
  type DeviceCodeResponse,
} from "../xai.js";

function jwtWithExp(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function errJson(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("xai accessTokenIsExpiring", () => {
  it("flags tokens expiring within the skew window", () => {
    expect(accessTokenIsExpiring(jwtWithExp(Math.floor(Date.now() / 1000) + 60))).toBe(true);
    expect(accessTokenIsExpiring(jwtWithExp(Math.floor(Date.now() / 1000) + 3600))).toBe(false);
  });

  it("ignores opaque and malformed tokens", () => {
    expect(accessTokenIsExpiring(undefined)).toBe(false);
    expect(accessTokenIsExpiring("opaque-token")).toBe(false);
    expect(accessTokenIsExpiring("a.b.c")).toBe(false);
    expect(accessTokenIsExpiring(jwtWithExp(NaN as number))).toBe(false);
  });
});

describe("xai requestDeviceCode", () => {
  it("rejects incomplete device-code payloads", async () => {
    vi.stubGlobal("fetch", async () => okJson({ device_code: "d" }));
    await expect(requestDeviceCode({})).rejects.toThrow("missing device_code");
  });

  it("surfaces HTTP failures", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        ({ ok: false, status: 500, text: async () => "boom" }) as Response,
    );
    await expect(requestDeviceCode({})).rejects.toThrow("xAI device code request failed (500): boom");
  });
});

describe("xai pollDeviceCodeToken", () => {
  const device: DeviceCodeResponse = {
    device_code: "device-1",
    user_code: "ABCD-1234",
    verification_uri: "https://auth.x.ai/device",
    expires_in: 300,
    interval: 5,
  };

  it("polls through authorization_pending to success", async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      calls.push(args);
      if (calls.length < 3) return errJson(400, { error: "authorization_pending" });
      return okJson({ access_token: "a", refresh_token: "r", expires_in: 3600 });
    });
    let now = 1_000_000;
    const tokens = await pollDeviceCodeToken(device, {
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    });
    expect(tokens.access_token).toBe("a");
    expect(calls.length).toBe(3);
  });

  it("backs off on slow_down and fails terminally on denial", async () => {
    const sleeps: number[] = [];
    vi.stubGlobal("fetch", async () => errJson(400, { error: "slow_down" }));
    let now = 0;
    await expect(
      pollDeviceCodeToken({ ...device, expires_in: 30 }, { sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      }, now: () => now }),
    ).rejects.toThrow("timed out");
    expect(sleeps[0]).toBeGreaterThan(sleeps.length > 1 ? 0 : -1);
    expect(sleeps[0]).toBe(5000 + 5000 + 3000);

    vi.stubGlobal("fetch", async () => errJson(400, { error: "access_denied" }));
    await expect(pollDeviceCodeToken(device, { sleep: async () => {}, now: () => 0 })).rejects.toThrow("denied");

    vi.stubGlobal("fetch", async () => errJson(400, { error: "expired_token" }));
    await expect(pollDeviceCodeToken(device, { sleep: async () => {}, now: () => 0 })).rejects.toThrow("expired");
  });
});

describe("xai plugin shape", () => {
  it("exposes oauth + api methods with a non-oauth loader passthrough", async () => {
    const hooks = await XaiAuthPlugin({ client: { auth: { set: async () => undefined } } });
    expect(hooks.auth?.provider).toBe("xai");
    expect(hooks.auth?.methods.map((method) => method.type)).toEqual(["oauth", "api"]);
    const loaded = await hooks.auth?.loader?.(async () => ({ type: "api", key: "k" }), { models: {} });
    expect(loaded).toEqual({});
  });
});
