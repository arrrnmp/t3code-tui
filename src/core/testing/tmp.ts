/**
 * Temp directories for tests that are removed when the test file finishes.
 * A bare `mkdtemp` leaked one directory per call — several hundred had
 * piled up under the OS temp dir from repeated `bun run check` runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

const created: string[] = [];

afterAll(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh directory under the OS temp dir, named `<prefix>XXXXXX`, removed after the file's tests. */
export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}
