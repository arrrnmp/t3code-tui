import { describe, expect, it } from "vitest";

import { mapGrokBilling, probeGrokBilling } from "../usage.js";

function billingBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    config: {
      creditUsagePercent: 42,
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-27T00:00:00.000Z" },
      ...overrides,
    },
  };
}

describe("grok usage", () => {
  it("maps billing bodies to subscription windows", () => {
    expect(mapGrokBilling(billingBody())).toMatchObject({
      id: "subscription",
      label: "Weekly",
      usedPercent: 42,
      exhausted: false,
    });
    expect(
      mapGrokBilling(billingBody({ currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" } }))?.label,
    ).toBe("Monthly");
    expect(mapGrokBilling(billingBody({ creditUsagePercent: 100 }))?.exhausted).toBe(true);
    expect(mapGrokBilling({ config: {} })).toBeNull();
    expect(mapGrokBilling(null)).toBeNull();
  });

  it("skips api-key and custom deployments without touching disk", async () => {
    let reads = 0;
    const readFile = async (): Promise<string> => {
      reads += 1;
      return "{}";
    };
    await expect(probeGrokBilling({ env: { XAI_API_KEY: "sk-x" }, readFile })).resolves.toBeNull();
    await expect(
      probeGrokBilling({ env: { GROK_CLI_CHAT_PROXY_BASE_URL: "http://x" }, readFile }),
    ).resolves.toBeNull();
    expect(reads).toBe(0);
  });

  it("reads the oauth credential and maps the probe", async () => {
    const auth = JSON.stringify({
      "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": { key: "tok", auth_mode: "oauth" },
    });
    const fetchFn = (async () => new Response(JSON.stringify(billingBody()), { status: 200 })) as typeof fetch;
    const window = await probeGrokBilling({
      env: {},
      readFile: async () => auth,
      fetchFn,
      timeoutMs: 2000,
      maxRetries: 0,
    });
    expect(window).toMatchObject({ id: "subscription", label: "Weekly", usedPercent: 42 });
  });

  it("retries rate limits and rejects api_key credentials", async () => {
    const auth = JSON.stringify({
      "https://accounts.x.ai/sign-in": { key: "tok", auth_mode: "api_key" },
    });
    await expect(
      probeGrokBilling({ env: {}, readFile: async () => auth, maxRetries: 0 }),
    ).resolves.toBeNull();

    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify(billingBody()), { status: 200 });
    }) as typeof fetch;
    const oauth = JSON.stringify({
      "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": { key: "tok" },
    });
    const window = await probeGrokBilling({
      env: {},
      readFile: async () => oauth,
      fetchFn: flaky,
      timeoutMs: 2000,
      maxRetries: 2,
    });
    expect(window).toMatchObject({ id: "subscription" });
    expect(calls).toBe(2);
  });
});
