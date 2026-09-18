import { describe, expect, it } from "vitest";

import { extractProviders, selectModel, selectProvider } from "../catalog.js";

function configFixture(settings?: unknown) {
  return {
    ...(settings !== undefined ? { settings } : {}),
    providers: [
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated", type: "oauth" },
        models: [
          {
            slug: "gpt-5.6-sol",
            name: "GPT 5.6 Sol",
            isCustom: false,
            isDefault: true,
            capabilities: {
              optionDescriptors: [
                {
                  id: "reasoningEffort",
                  label: "Reasoning effort",
                  type: "select",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "high", label: "High", isDefault: true },
                  ],
                  currentValue: "high",
                },
                { id: "fastMode", label: "Fast mode", type: "boolean", currentValue: true },
                { id: "broken", label: "Broken", type: "select" },
              ],
            },
          },
          { slug: "my-custom", name: "Custom", isCustom: true, capabilities: null },
          { slug: "", name: "Nameless" },
        ],
      },
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        enabled: false,
        installed: false,
        status: "error",
        auth: { status: "unauthenticated" },
        models: [],
        usageLimits: {
          checkedAt: "2026-09-15T00:00:00.000Z",
          windows: [
            { id: "five_hour", kind: "session", label: "Session", usedPercent: 42 },
            {
              id: "seven_day",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 18,
              resetsAt: "2026-09-20T00:00:00.000Z",
            },
          ],
        },
        skills: [
          {
            name: "pdf",
            description: "Read, edit, and create PDF files.",
            displayName: "PDF",
            shortDescription: "PDF tools",
            path: "/skills/pdf/SKILL.md",
            enabled: true,
          },
          {
            name: "hidden-from-user",
            enabled: true,
            userInvocationOnly: false,
            userInvocable: false,
          },
          { name: "" },
        ],
      },
    ],
  };
}

describe("extractProviders", () => {
  it("summarizes providers, models, and select-type effort descriptors", () => {
    const providers = extractProviders(configFixture());

    expect(providers).toHaveLength(2);
    const codex = providers[0]!;
    expect(codex).toMatchObject({
      instanceId: "codex",
      driver: "codex",
      displayName: "Codex",
      enabled: true,
      installed: true,
      status: "ready",
      authStatus: "authenticated",
    });
    expect(codex.models.map((model) => model.slug)).toEqual(["gpt-5.6-sol", "my-custom"]);
    const sol = codex.models[0]!;
    expect(sol).toMatchObject({
      slug: "gpt-5.6-sol",
      isCustom: false,
      isDefault: true,
      isHidden: false,
    });
    expect(sol.efforts).toHaveLength(1);
    expect(sol.efforts[0]).toMatchObject({
      id: "reasoningEffort",
      label: "Reasoning effort",
      currentValue: "high",
    });
    expect(sol.efforts[0]!.choices).toEqual([
      { id: "low", label: "Low", isDefault: null },
      { id: "high", label: "High", isDefault: true },
    ]);
    const claude = providers[1]!;
    expect(claude.displayName).toBeNull();
    expect(claude.models).toEqual([]);
    expect(codex.usageLimits).toBeNull();
    expect(claude.usageLimits).toMatchObject({
      checkedAt: "2026-09-15T00:00:00.000Z",
      windows: [
        { id: "five_hour", kind: "session", label: "Session", usedPercent: 42, resetsAt: null },
        {
          id: "seven_day",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 18,
          resetsAt: "2026-09-20T00:00:00.000Z",
        },
      ],
    });
    expect(codex.skills).toEqual([]);
    // The blank-name entry is dropped like any other unroutable row; the
    // agent-only skill still parses (a picker filters it, extraction doesn't).
    expect(claude.skills).toEqual([
      {
        name: "pdf",
        description: "Read, edit, and create PDF files.",
        displayName: "PDF",
        shortDescription: "PDF tools",
        enabled: true,
        userInvocationOnly: false,
        userInvocable: true,
      },
      {
        name: "hidden-from-user",
        description: null,
        displayName: null,
        shortDescription: null,
        enabled: true,
        userInvocationOnly: false,
        userInvocable: false,
      },
    ]);
  });

  it("reports unavailable usage limits without dropping the reason", () => {
    const providers = extractProviders({
      providers: [
        {
          instanceId: "bedrock",
          driver: "claudeAgent",
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          models: [],
          usageLimits: {
            checkedAt: "2026-09-15T00:00:00.000Z",
            windows: [],
            unavailable: { reason: "unsupported" },
          },
        },
      ],
    });

    expect(providers[0]!.usageLimits).toEqual({
      checkedAt: "2026-09-15T00:00:00.000Z",
      windows: [],
      unavailable: { reason: "unsupported", message: null },
    });
  });

  it("marks models the user hid via providerModelPreferences.hiddenModels", () => {
    const providers = extractProviders(
      configFixture({
        providerModelPreferences: {
          codex: { hiddenModels: ["gpt-5.6-sol"] },
        },
      }),
    );

    const codex = providers[0]!;
    expect(codex.models).toEqual([
      expect.objectContaining({ slug: "gpt-5.6-sol", isHidden: true }),
      expect.objectContaining({ slug: "my-custom", isHidden: false }),
    ]);
  });

  it("extracts supported runtime modes and drops unknown ones", () => {
    const providers = extractProviders({
      providers: [
        {
          instanceId: "locked",
          driver: "codex",
          enabled: true,
          installed: true,
          supportedRuntimeModes: ["approval-required", "future-mode", "full-access", 42],
        },
        {
          instanceId: "silent",
          driver: "claudeAgent",
          enabled: true,
          installed: true,
        },
      ],
    });
    expect(providers[0]!.supportedRuntimeModes).toEqual(["approval-required", "full-access"]);
    expect(providers[1]!.supportedRuntimeModes).toBeNull();
  });

  it("rejects responses without a providers array", () => {
    expect(() => extractProviders({})).toThrowError(
      expect.objectContaining({ code: "T3_CONTRACT_CHANGED" }),
    );
    expect(() => extractProviders({ providers: {} })).toThrowError(
      expect.objectContaining({ code: "T3_CONTRACT_CHANGED" }),
    );
  });

  it("rejects provider entries without routing keys", () => {
    expect(() => extractProviders({ providers: [{ driver: "codex" }] })).toThrowError(
      expect.objectContaining({ code: "T3_CONTRACT_CHANGED" }),
    );
  });
});

describe("selectProvider / selectModel", () => {
  it("resolves known ids and reports available ones otherwise", () => {
    const providers = extractProviders(configFixture());

    expect(selectProvider(providers, "codex").driver).toBe("codex");
    expect(selectModel(selectProvider(providers, "codex"), "gpt-5.6-sol").name).toBe("GPT 5.6 Sol");
    expect(() => selectProvider(providers, "nope")).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_NOT_FOUND",
        details: expect.objectContaining({ available: ["codex", "claudeAgent"] }),
      }),
    );
    expect(() => selectModel(selectProvider(providers, "codex"), "nope")).toThrowError(
      expect.objectContaining({
        code: "MODEL_NOT_FOUND",
        details: expect.objectContaining({ available: ["gpt-5.6-sol", "my-custom"] }),
      }),
    );
  });
});
