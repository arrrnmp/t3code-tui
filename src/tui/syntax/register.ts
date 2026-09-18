import { addDefaultParsers } from "@opentui/core";

import { getParsers } from "./parsers.js";

let registered: Promise<void> | null = null;

/**
 * Registers the vendored tree-sitter parsers (`parsers-config.json` ->
 * `src/tui/syntax/*`) on OpenTUI's global client. Must run before the first
 * render: `addDefaultParsers` only affects clients initialized afterwards.
 * Best-effort — a failure leaves the bundled js/ts/markdown/zig grammars.
 */
export function registerSyntaxParsers(): Promise<void> {
  registered ??= (async () => {
    try {
      addDefaultParsers(await getParsers());
    } catch (error) {
      process.stderr.write(`t3code: extra syntax parsers unavailable (${String(error).slice(0, 120)})\n`);
    }
  })();
  return registered;
}
