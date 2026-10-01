import { describe, expect, it } from "vitest";

import { sdkMcpServer, zodShape } from "../../../core/providers/claude/transport.js";
import type { ProviderSummary } from "../../../core/catalog/summary.js";
import type { ClientApi } from "../../api.js";
import { startMcpHttpServer } from "../http.js";
import { callMoxenTool, MAX_MODELS_PER_PROVIDER, MOXEN_TOOLS } from "../tools.js";

function provider(instanceId: string, overrides: Partial<ProviderSummary> = {}, modelCount = 2): ProviderSummary {
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId.toUpperCase(),
    enabled: true,
    installed: true,
    status: "ready",
    authStatus: "authenticated",
    models: Array.from({ length: modelCount }, (_, index) => ({
      slug: `${instanceId}-m${index}`,
      name: `Model ${index}`,
      isCustom: false,
      isDefault: index === 0,
      isHidden: index === 1,
      efforts: index === 0 ? [{ id: "effort", label: "Reasoning", currentValue: null, choices: [{ id: "low", label: "Low", isDefault: null }, { id: "high", label: "High", isDefault: null }] }] : [],
    })) as ProviderSummary["models"],
    supportedRuntimeModes: null,
    usageLimits: null,
    skills: [],
    ...overrides,
  };
}

/** Just enough of `ClientApi` for the tools that read the catalog. */
function catalogApi(providers: ProviderSummary[]): ClientApi {
  return { query: async () => ({ providers }) } as unknown as ClientApi;
}

describe("models tool", () => {
  it("lists enabled, installed providers with their visible models and efforts, compactly", async () => {
    const api = catalogApi([provider("claudeAgent"), provider("codex", { enabled: false }), provider("grok", { installed: false })]);
    const result = await callMoxenTool(api, "parent", "models", {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({
      providers: [{ provider: "claudeAgent", name: "CLAUDEAGENT", models: [{ model: "claudeAgent-m0", name: "Model 0", efforts: ["low", "high"] }] }],
    });
  });

  it("caps a huge catalog and says how many more there are, and filters by provider", async () => {
    const api = catalogApi([provider("opencode", {}, MAX_MODELS_PER_PROVIDER + 12), provider("claudeAgent")]);
    const all = JSON.parse((await callMoxenTool(api, "parent", "models", {})).text) as { providers: Array<{ models: unknown[]; moreModels?: number }> };
    // One of every opencode model is hidden (index 1): 51 visible, 40 listed.
    expect(all.providers[0]!.models).toHaveLength(MAX_MODELS_PER_PROVIDER);
    expect(all.providers[0]!.moreModels).toBe(MAX_MODELS_PER_PROVIDER + 12 - 1 - MAX_MODELS_PER_PROVIDER);
    const one = JSON.parse((await callMoxenTool(api, "parent", "models", { provider: "claudeAgent" })).text) as { providers: unknown[] };
    expect(one.providers).toHaveLength(1);
    expect((await callMoxenTool(api, "parent", "models", { provider: "nope" })).isError).toBe(true);
  });
});

describe("moxen tools over loopback HTTP", () => {
  it("answers MCP for a thread holding its token, and nobody else", async () => {
    const server = await startMcpHttpServer(catalogApi([provider("claudeAgent")]), "9.9.9");
    try {
      const spec = server.specFor("thread-1");
      expect(spec.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/thread-1$/);
      const post = (body: unknown, headers: Record<string, string> = spec.headers, url = spec.url) =>
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

      expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, {})).status).toBe(401);
      expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: "Bearer wrong" })).status).toBe(401);
      // Another thread's URL with this thread's token: refused.
      expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, spec.headers, spec.url.replace("thread-1", "thread-2"))).status).toBe(401);

      const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
      expect(init.status).toBe(200);
      expect(await init.json()).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "moxen", version: "9.9.9" } } });
      expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

      const listed = (await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as { result: { tools: Array<{ name: string }> } };
      expect(listed.result.tools.map((tool) => tool.name)).toEqual(MOXEN_TOOLS.map((tool) => tool.name));

      const batch = (await (
        await post([
          { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "models", arguments: {} } },
          { jsonrpc: "2.0", method: "notifications/cancelled" },
        ])
      ).json()) as Array<{ id: number; result: { isError: boolean } }>;
      expect(batch).toHaveLength(1);
      expect(batch[0]).toMatchObject({ id: 3, result: { isError: false } });

      // A client with no checklist of its own asks for moxen's.
      const lent = (await (await post({ jsonrpc: "2.0", id: 4, method: "tools/list" }, spec.headers, `${spec.url}?checklist=1`)).json()) as {
        result: { tools: Array<{ name: string }> };
      };
      expect(lent.result.tools.map((tool) => tool.name)).toEqual([...MOXEN_TOOLS.map((tool) => tool.name), "todos"]);

      expect((await fetch(spec.url, { method: "GET", headers: spec.headers })).status).toBe(405);
    } finally {
      await server.close();
    }
  });
});

describe("in-process tools for Claude", () => {
  it("turns the tools' JSON schemas into Zod shapes", () => {
    const delegate = MOXEN_TOOLS.find((tool) => tool.name === "delegate")!;
    const shape = zodShape(delegate.inputSchema);
    expect(Object.keys(shape).sort()).toEqual(["effort", "fork", "isolation", "model", "provider", "task", "title"]);
    expect(shape.fork!.safeParse(true).success).toBe(true);
    expect(shape.task!.safeParse("do it").success).toBe(true);
    expect(shape.task!.safeParse(undefined).success).toBe(false);
    expect(shape.title!.safeParse(undefined).success).toBe(true);
    expect(shape.isolation!.safeParse("worktree").success).toBe(true);
    expect(shape.isolation!.safeParse("elsewhere").success).toBe(false);
  });

  it("hosts them as an SDK server whose calls reach the spec directly", () => {
    const server = sdkMcpServer({
      name: "moxen",
      type: "in-process",
      tools: MOXEN_TOOLS,
      call: async () => ({ text: "ok", isError: false }),
      fallback: { name: "moxen", type: "stdio", command: "bun", args: [], env: {} },
      alwaysLoad: true,
    });
    expect(server).toMatchObject({ type: "sdk", name: "moxen" });
  });
});
