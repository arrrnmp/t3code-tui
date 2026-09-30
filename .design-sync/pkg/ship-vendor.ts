/**
 * Copies the tree-sitter grammar scripts into the converter's output as
 * `_vendor/tree-sitter/` (inside the upload plan's `_vendor/**`). The
 * converter has no hook for extra assets and rewrites its out dir, so run
 * this after every package-build / resync driver run, before capture/upload:
 *   bun .design-sync/pkg/ship-vendor.ts ./ds-bundle
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "./ds-bundle");
const from = join(import.meta.dir, "dist/tree-sitter");
if (!existsSync(join(out, "_ds_bundle.js"))) throw new Error(`${out} is not a converter output (no _ds_bundle.js)`);
if (!existsSync(from)) throw new Error("dist/tree-sitter missing — run bun .design-sync/pkg/build.ts first");
const to = join(out, "_vendor/tree-sitter");
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) cpSync(join(from, f), join(to, f));
console.log(`shipped ${readdirSync(to).length} grammar scripts → ${to}`);
