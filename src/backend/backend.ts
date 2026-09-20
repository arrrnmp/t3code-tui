/**
 * Backend seam: every thread/project/catalog operation goes through this
 * interface. Stage 0 ships a single `T3Backend` (the live T3 Code server);
 * later stages add direct provider-backed implementations without changing
 * CLI JSON envelopes. See DECOUPLE.md §15.1.
 */
import { CliError } from "../errors.js";
import type { CliConfig, ModelSelection, T3Project, T3Runtime, T3Thread } from "../types.js";
import { DirectBackend, type DirectBackendOptions } from "./direct.js";
import { T3Backend } from "./t3.js";

export type BackendKind = "t3" | "direct";

export const BACKEND_KINDS: readonly BackendKind[] = ["t3", "direct"];

export function isBackendKind(value: unknown): value is BackendKind {
  return value === "t3" || value === "direct";
}

/**
 * Backend selection: `T3CODE_BACKEND=t3` (default, live T3 Code server) or
 * `direct` (own store + provider drivers). Anything else is a usage error.
 */
export function resolveBackendKind(raw?: string): BackendKind {
  const value = (raw ?? process.env.T3CODE_BACKEND ?? "t3").trim().toLowerCase();
  if (isBackendKind(value)) return value;
  throw new CliError("INVALID_BACKEND", `Unknown backend "${value}". Use "t3" or "direct".`, {
    exitCode: 2,
    details: { backend: value },
  });
}

export interface BackendCatalog {
  readonly snapshotSequence: number;
  readonly projects: T3Project[];
  readonly threads: T3Thread[];
  readonly updatedAt: string;
}

export interface BackendThreadDetail {
  readonly snapshotSequence: number;
  readonly thread: T3Thread;
}

export interface BackendSendInput {
  readonly prompt: string;
  readonly ifBusy?: "reject" | "inject";
  readonly delivery?: "auto" | "steer" | "restart" | "queue";
  readonly wakeSettled?: boolean;
  readonly modelSelection?: ModelSelection;
}

export interface BackendSendResult {
  readonly threadId: string;
  readonly messageId: string;
  /** Present on direct backends; T3 only verifies message projection. */
  readonly turnId?: string;
  readonly delivery: "started" | "queued" | "steered" | "restarted" | "injected";
}

export interface Backend {
  readonly kind: BackendKind;
  catalog(): Promise<BackendCatalog>;
  inspectThread(threadId: string): Promise<BackendThreadDetail>;
  /**
   * Accept a turn: the turn is recorded and execution kicked off; completion
   * lands via events/store afterwards. Same acceptance contract both sides.
   */
  send(threadId: string, input: BackendSendInput): Promise<BackendSendResult>;
}

export interface CreateBackendOptions {
  readonly direct?: DirectBackendOptions;
}

export function createBackend(
  kind: BackendKind,
  runtime: T3Runtime,
  config: CliConfig,
  options: CreateBackendOptions = {},
): Backend {
  if (kind === "t3") return new T3Backend(runtime, config);
  if (kind === "direct") return new DirectBackend(options.direct);
  throw new CliError("BACKEND_UNKNOWN", `Unknown backend kind: ${String(kind)}.`, {
    details: { kind },
  });
}

export type { DirectBackendOptions };
