/**
 * The contract `opencode serve` imposes on a file plugin: it calls every
 * export of the entry module as `server(input, options)` and pushes each
 * return value into the shared hook list
 * (`packages/opencode/src/plugin/index.ts:99-124`). A second export is
 * therefore not dead weight but a live fault — a helper that returns a
 * non-hook poisons `hook.config?.()` / `hook.event?.()` and every prompt
 * dispatch for the whole server, and one that throws aborts registration
 * before the real plugin lands. Both failures are log-only inside the
 * server: turns are accepted and then never answered.
 */
import { describe, expect, it } from "vitest";

import { resolveVendoredPluginPaths } from "../../config.js";

describe("vendored plugin entry modules", () => {
  it("export exactly one factory each, so the server's export walk stays safe", async () => {
    const paths = resolveVendoredPluginPaths();
    expect(paths.length).toBe(2);
    for (const entry of paths) {
      const mod = (await import(/* @vite-ignore */ entry)) as Record<string, unknown>;
      const exported = Object.keys(mod).filter((key) => key !== "default");
      expect(exported.length, `${entry} must export one factory, got ${exported.join(", ")}`).toBe(1);
      expect(typeof mod[exported[0] as string]).toBe("function");
    }
  });

  it("keeps the vendored sources' helper exports off the loaded path", async () => {
    // The sources stay byte-faithful to upstream (helpers exported for
    // their own tests); only the entry modules are handed to the server.
    const xai = (await import("../xai.js")) as Record<string, unknown>;
    expect(Object.keys(xai).length).toBeGreaterThan(1);
    const loaded = resolveVendoredPluginPaths().map((entry) => entry.replaceAll("\\", "/"));
    expect(loaded.some((entry) => /plugins\/xai\.(ts|js)$/.test(entry))).toBe(false);
    expect(loaded.some((entry) => /plugins\/codex\.(ts|js)$/.test(entry))).toBe(false);
  });
});
