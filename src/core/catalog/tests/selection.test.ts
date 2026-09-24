import { describe, expect, it } from "vitest";

import { CliError } from "../../errors.js";
import { parseClaudeModels } from "../../providers/claude/catalog.js";
import { resolveCodexModel } from "../../providers/codex/config.js";
import { resolveGrokModelId } from "../../providers/grok/config.js";
import { defaultModelSelection } from "../selection.js";

const only = (...binaries: string[]) => (binary: string) => binaries.includes(binary);

describe("installation default model", () => {
  it("prefers Claude on its bundled catalog default", () => {
    const expected = parseClaudeModels().find((model) => model.isDefault === true)!.slug;
    expect(defaultModelSelection({ env: {}, installed: only("claude", "grok", "codex") })).toEqual({
      instanceId: "claudeAgent",
      model: expected,
    });
  });

  it("falls to Grok, then Codex, each on the provider's own default", () => {
    const grok = defaultModelSelection({ env: {}, installed: only("grok", "codex") });
    expect(grok).toEqual({ instanceId: "grok", model: "grok-build" });
    // The sentinels reach the provider as "no model": its own default applies.
    expect(resolveGrokModelId(grok.model)).toBeNull();

    const codex = defaultModelSelection({ env: {}, installed: only("codex") });
    expect(codex).toEqual({ instanceId: "codex", model: "codex-default" });
    expect(resolveCodexModel(codex.model)).toBeNull();
    expect(resolveCodexModel("gpt-5.5")).toBe("gpt-5.5");
  });

  it("never picks OpenCode, and says so when nothing else is installed", () => {
    let failure: unknown;
    try {
      defaultModelSelection({ env: {}, installed: only("opencode") });
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(CliError);
    expect((failure as CliError).code).toBe("NO_DEFAULT_MODEL");
  });

  it("is pinned outright by MOXEN_DEFAULT_MODEL, whatever is installed", () => {
    const env = { MOXEN_DEFAULT_MODEL: "opencode/opencode/muse" };
    expect(defaultModelSelection({ env, installed: only() })).toEqual({ instanceId: "opencode", model: "opencode/muse" });
    expect(() => defaultModelSelection({ env: { MOXEN_DEFAULT_MODEL: "claudeAgent" }, installed: only() })).toThrow(
      /MOXEN_DEFAULT_MODEL/,
    );
  });
});
