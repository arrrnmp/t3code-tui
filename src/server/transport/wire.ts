/**
 * The wire: `ClientApi` as newline-delimited JSON over a local stream
 * (a named pipe on Windows, a unix socket elsewhere).
 *
 * One JSON object per line, in both directions. A request carries a
 * numeric `id` the response echoes; a subscription is identified by the
 * `id` of the request that opened it, and its frames arrive as
 * `{ subscription, item }` until the client unsubscribes or disconnects.
 *
 * The payloads are exactly `ClientApi`'s: commands and queries go over as
 * the objects a caller passed (the server decodes them with
 * `protocol.ts`, as it does in-process), results come back as the values
 * the in-process connection returns. That is what lets the golden `--json`
 * suite run unchanged against either implementation.
 */
import { CliError, toCliError } from "../../core/errors.js";

/** Bumped on any incompatible change to the messages below. */
export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { readonly id: number; readonly method: "hello"; readonly params: { readonly protocol: number } }
  | { readonly id: number; readonly method: "dispatch"; readonly params: unknown }
  | { readonly id: number; readonly method: "query"; readonly params: unknown }
  | { readonly id: number; readonly method: "getConfig" }
  | {
      readonly id: number;
      readonly method: "turnDiff";
      readonly params: { readonly threadId: string; readonly toTurnCount: number };
    }
  | { readonly id: number; readonly method: "subscribeShell"; readonly params: { readonly afterSequence?: number } }
  | {
      readonly id: number;
      readonly method: "subscribeThread";
      readonly params: { readonly threadId: string; readonly afterSequence?: number };
    }
  | { readonly id: number; readonly method: "unsubscribe"; readonly params: { readonly subscription: number } }
  | { readonly id: number; readonly method: "shutdown" };

export type ServerMessage =
  | { readonly id: number; readonly result: unknown }
  | { readonly id: number; readonly error: WireError }
  | { readonly subscription: number; readonly item: unknown }
  | { readonly subscription: number; readonly error: WireError };

export interface HelloResult {
  readonly protocol: number;
  readonly server: "moxen";
  readonly pid: number;
}

/** A `CliError` as it crosses the wire; code, exit code and details survive. */
export interface WireError {
  readonly code: string;
  readonly message: string;
  readonly exitCode: number;
  readonly details?: unknown;
}

export function toWireError(error: unknown): WireError {
  const cli = toCliError(error);
  return {
    code: cli.code,
    message: cli.message,
    exitCode: cli.exitCode,
    ...(cli.details === undefined ? {} : { details: cli.details }),
  };
}

export function fromWireError(error: WireError): CliError {
  return new CliError(error.code, error.message, {
    exitCode: error.exitCode,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

export function encode(message: ClientMessage | ServerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** Splits a byte stream into lines, holding a partial line until it completes. */
export class LineReader {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  }
}

export function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
