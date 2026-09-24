/**
 * The layering contract: `core/ -> server/ -> clients`.
 *
 * This test exists because the tree had already drifted into a *cycle* —
 * `server/` imported both `cli/` and `tui/`, and `tui/` imported `cli/` —
 * while every doc described a one-way boundary. Only `core/` held its
 * invariant, and it held it by luck rather than by check. A refactor that
 * untangles this without a test to pin it just gets re-tangled by the next
 * convenient import.
 *
 * Two tiers, because they are fixed at different times:
 *
 * 1. **Direction** — nothing may import upward. `core/` imports no client
 *    and no server; `server/` imports no client; the two clients never
 *    import each other. `tui/ -> server/` and `cli/ -> server/` are the
 *    intended edges.
 * 2. **Depth** — a client may reach into `core/` only for the shared
 *    kernel: the vocabulary and OS primitives listed below. Every domain
 *    *operation* goes through `ClientApi`.
 *
 * Both tiers carry an allowlist of the violations that existed when the
 * test was written. The allowlists only ever shrink: an entry that no
 * longer fires is itself a failure, so finishing a migration forces the
 * bookkeeping instead of leaving dead exceptions behind.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

type Layer = "core" | "server" | "cli" | "tui";

/** Import *depth*, not import order: a layer may only import strictly below itself. */
const DEPTH: Record<Layer, number> = { core: 0, server: 1, cli: 2, tui: 2 };

/**
 * The shared kernel: what a client may import from `core/` directly.
 *
 * The line is *vocabulary and primitives* versus *domain operations*. A
 * client may name a thread's type, decode a provider summary, label a
 * runtime mode, or shell out to the OS — none of that drives anything.
 * It may not open the store, start a turn, resolve a project or build a
 * live provider catalog; those go through `ClientApi`.
 *
 * `catalog/summary` and `catalog/permissions` are in here because they are
 * the vocabulary all three layers speak — that is exactly why they moved
 * down out of `cli/`. `catalog/selection` (how flags and config resolve to
 * a model) and `threads/views` (what "busy" or "settled" means for a
 * thread envelope) are pure rules over values a client already holds —
 * no store, no drivers — so a client may apply them to what `ClientApi`
 * returned. `catalog/direct` is *not*: it probes live providers, so it is
 * an operation.
 */
const KERNEL_PREFIXES = [
  "src/core/types",
  "src/core/errors",
  "src/core/config",
  "src/core/mcp",
  "src/core/catalog/summary",
  "src/core/catalog/permissions",
  "src/core/catalog/selection",
  "src/core/threads/views",
  "src/core/attachments",
  "src/core/infra/",
];

const isKernel = (target: string): boolean =>
  KERNEL_PREFIXES.some((prefix) => target === prefix || target.startsWith(prefix));

/**
 * Upward edges still standing: none. The last one was the server suite
 * driving the CLI's test harness, which now lives in `core/testing/` as
 * the shared support it always was. Kept as an (empty) allowlist so a new
 * exception has to be written down here, with its reason.
 */
const DIRECTION_ALLOWLIST: ReadonlySet<string> = new Set([]);

/**
 * Domain operations a client still calls directly, by core module: none.
 * Every CLI command — `doctor` included, which asks the server about the
 * machine running the sessions — and the whole TUI go through `ClientApi`.
 * Kept as an (empty) allowlist so a new exception is written down here,
 * with its reason.
 *
 * Client *tests* are exempt by design, not by entry: AGENTS.md wants a
 * contract test asserting a client can read core's output to live on the
 * client side (`tui/model/tests/toolactivity.test.ts` is the example).
 */
const DEPTH_ALLOWLIST: ReadonlySet<string> = new Set([]);

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/g;

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) found.push(full);
    }
  };
  walk("src");
  return found;
}

const posix = (value: string): string => value.replaceAll("\\", "/");
const layerOf = (file: string): Layer => posix(file).split("/")[1] as Layer;

/**
 * Test *support*, not just test files: `render-check/` fixtures and the
 * `testing/` harnesses build core's own shapes on purpose, for the same
 * reason a contract test does. Holding them to the production depth rule
 * would forbid exactly the check AGENTS.md asks for — the render-check
 * fixture goes through the real activity-row writer so the scenarios fail
 * if the writer stops producing what the panel reads.
 */
const isTest = (file: string): boolean =>
  /\/(tests|testing|render-check)\/|\.test\.tsx?$/.test(posix(file));

interface Edge {
  readonly file: string;
  readonly target: string;
  readonly from: Layer;
  readonly to: Layer;
  readonly fromTest: boolean;
}

/** Every relative import inside `src/`, resolved to an extensionless path. */
function edges(): Edge[] {
  const all: Edge[] = [];
  for (const file of sourceFiles()) {
    const from = layerOf(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = match[1];
      if (spec === undefined || !spec.startsWith(".")) continue;
      const target = posix(path.normalize(path.join(path.dirname(file), spec))).replace(/\.js$/, "");
      if (!target.startsWith("src/")) continue;
      const to = layerOf(target);
      if (to === from) continue;
      all.push({ file: posix(file), target, from, to, fromTest: isTest(file) });
    }
  }
  return all;
}

describe("layering", () => {
  it("never imports upward", () => {
    const upward = edges().filter((edge) => DEPTH[edge.to] >= DEPTH[edge.from]);
    const offenders = upward
      .map((edge) => `${edge.file} -> ${edge.target}`)
      .filter((key) => !DIRECTION_ALLOWLIST.has(key));
    expect(offenders.sort()).toEqual([]);
  });

  it("keeps clients out of core beyond the shared kernel", () => {
    const deep = edges().filter(
      (edge) =>
        (edge.from === "cli" || edge.from === "tui") &&
        edge.to === "core" &&
        !edge.fromTest &&
        !isKernel(edge.target),
    );
    const offenders = deep
      .filter((edge) => !DEPTH_ALLOWLIST.has(edge.target))
      .map((edge) => `${edge.file} -> ${edge.target}`);
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("retires allowlist entries once they stop firing", () => {
    const all = edges();
    const liveDirection = new Set(all.map((edge) => `${edge.file} -> ${edge.target}`));
    // Only client imports keep a depth entry alive: the server importing
    // a core operation is the intended edge, not a reason to keep excusing
    // a client for it.
    const liveDepth = new Set(
      all
        .filter((edge) => !edge.fromTest && edge.to === "core" && (edge.from === "cli" || edge.from === "tui"))
        .map((edge) => edge.target),
    );
    expect([...DIRECTION_ALLOWLIST].filter((key) => !liveDirection.has(key)).sort()).toEqual([]);
    expect([...DEPTH_ALLOWLIST].filter((key) => !liveDepth.has(key)).sort()).toEqual([]);
  });
});
