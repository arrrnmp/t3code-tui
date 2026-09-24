/** A fresh endpoint per test server: parallel suites must never share one. */
import os from "node:os";
import path from "node:path";

import { namedPipe } from "../endpoint.js";

let counter = 0;

export function testEndpoint(): string {
  counter += 1;
  const name = `moxen-test-${process.pid}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  return process.platform === "win32" ? namedPipe(name) : path.join(os.tmpdir(), `${name}.sock`);
}
