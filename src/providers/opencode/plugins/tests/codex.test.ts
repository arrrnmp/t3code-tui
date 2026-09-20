import { describe, expect, it } from "vitest";

import {
  CodexAuthPlugin,
  extractAccountId,
  extractAccountIdFromClaims,
  extractResidency,
  parseJwtClaims,
  renderOAuthError,
} from "../codex.js";
import type { PluginModelInfo } from "../shims.js";

function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

function model(id: string, reasoningMode?: string): PluginModelInfo {
  return {
    id,
    api: { id },
    options: reasoningMode === undefined ? {} : { reasoningMode },
    limit: { context: 1 },
    cost: { input: 1 },
  };
}

describe("codex JWT helpers", () => {
  it("parses claims and prefers direct, namespaced, then org account ids", () => {
    expect(parseJwtClaims("not-a-jwt")).toBeUndefined();
    expect(parseJwtClaims("a.b")).toBeUndefined();
    expect(parseJwtClaims(jwt({ chatgpt_account_id: "acc-1" }))?.chatgpt_account_id).toBe("acc-1");
    expect(
      extractAccountIdFromClaims({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-2" } }),
    ).toBe("acc-2");
    expect(extractAccountIdFromClaims({ organizations: [{ id: "org-1" }] })).toBe("org-1");
    expect(extractAccountIdFromClaims({})).toBeUndefined();
  });

  it("extracts the account id from id_token first, then access_token", () => {
    expect(extractAccountId({ id_token: jwt({ chatgpt_account_id: "a" }), access_token: "", refresh_token: "" })).toBe(
      "a",
    );
    expect(
      extractAccountId({ id_token: "", access_token: jwt({ organizations: [{ id: "o" }] }), refresh_token: "" }),
    ).toBe("o");
    expect(extractAccountId({ id_token: "", access_token: "", refresh_token: "" })).toBeUndefined();
  });

  it("extracts residency except when unconstrained", () => {
    expect(extractResidency(jwt({ chatgpt_compute_residency: "eu" }))).toBe("eu");
    expect(extractResidency(jwt({ chatgpt_compute_residency: "no_constraint" }))).toBeUndefined();
    expect(extractResidency(jwt({}))).toBeUndefined();
    expect(extractResidency("garbage")).toBeUndefined();
  });

  it("renders the loopback error page", () => {
    expect(renderOAuthError("boom")).toContain("boom");
  });
});

describe("codex provider.models allowlist", () => {
  const models: Record<string, PluginModelInfo> = {
    spark: model("gpt-5.3-codex-spark"),
    mini: model("gpt-5.4-mini"),
    pro: model("gpt-5.5-pro"),
    future: model("gpt-6-astra"),
    old: model("gpt-4.1"),
    other: model("claude-sonnet-4-5"),
    proMode: model("gpt-5.4", "pro"),
  };

  it("keeps the allowlist, drops pro/banned/legacy, passes non-oauth through", async () => {
    const hooks = await CodexAuthPlugin({ client: { auth: { set: async () => undefined } } });
    const filtered = await hooks.provider?.models?.({ models }, { auth: { type: "oauth", refresh: "r", access: "a", expires: 1 } });
    expect(Object.keys(filtered ?? {}).sort()).toEqual(["future", "mini", "spark"]);
    expect(filtered?.["future"]?.cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } });

    const passthrough = await hooks.provider?.models?.({ models }, { auth: { type: "api", key: "k" } });
    expect(passthrough).toBe(models);
  });
});

describe("codex plugin shape", () => {
  it("exposes browser + headless oauth plus api-key methods", async () => {
    const hooks = await CodexAuthPlugin({ client: { auth: { set: async () => undefined } } });
    expect(hooks.provider?.id).toBe("openai");
    expect(hooks.auth?.provider).toBe("openai");
    expect(hooks.auth?.methods.map((method) => method.label)).toEqual([
      "ChatGPT Pro/Plus (browser)",
      "ChatGPT Pro/Plus (headless)",
      "Manually enter API Key",
    ]);
    const loaded = await hooks.auth?.loader?.(async () => ({ type: "api", key: "k" }), { models: {} });
    expect(loaded).toEqual({});
  });

  it("tags openai chat headers and clears max output tokens", async () => {
    const hooks = await CodexAuthPlugin({ client: { auth: { set: async () => undefined } } });
    const headers: Record<string, string> = {};
    await hooks["chat.headers"]?.({ model: { providerID: "openai" }, sessionID: "s-1", agent: "build" }, { headers });
    expect(headers.originator).toBe("opencode");
    expect(headers["session-id"]).toBe("s-1");

    const other: Record<string, string> = {};
    await hooks["chat.headers"]?.({ model: { providerID: "anthropic" }, sessionID: "s-1", agent: "build" }, {
      headers: other,
    });
    expect(other).toEqual({});

    const params: { maxOutputTokens: number | undefined } = { maxOutputTokens: 100 };
    await hooks["chat.params"]?.({ model: { providerID: "openai" }, sessionID: "s-1", agent: "build" }, params);
    expect(params.maxOutputTokens).toBeUndefined();
  });
});
