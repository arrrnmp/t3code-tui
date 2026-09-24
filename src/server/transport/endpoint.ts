/**
 * Where the server listens, and whether something is listening there.
 *
 * One endpoint per user: a named pipe on Windows (`\\.\pipe\moxen-<user>`),
 * a unix socket in the app home elsewhere. `MOXEN_SERVER_ENDPOINT`
 * overrides it (tests, or a second isolated server).
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { appEnv, appHomeDir, APP_NAME } from "../../core/config.js";

const BACKSLASH = String.fromCharCode(92);

export function defaultEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const override = appEnv("SERVER_ENDPOINT", env)?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    const user = (os.userInfo().username || "user").replace(/[^A-Za-z0-9_.-]/g, "_");
    return namedPipe(`${APP_NAME}-${user}`);
  }
  return path.join(appHomeDir(), "server.sock");
}

/** `\\.\pipe\<name>`, built without escape sequences. */
export function namedPipe(name: string): string {
  return ["", "", ".", "pipe", name].join(BACKSLASH);
}

export function isNamedPipe(endpoint: string): boolean {
  return endpoint.startsWith(`${BACKSLASH}${BACKSLASH}.${BACKSLASH}pipe${BACKSLASH}`);
}

/** Whether a server accepts connections at `endpoint` right now. */
export async function probe(endpoint: string, timeoutMs = 500): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect(endpoint);
    const done = (alive: boolean): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
