/**
 * Backend seam: every thread/project/catalog operation goes through this
 * interface. Stage 0 ships a single `T3Backend` (the live T3 Code server);
 * later stages add direct provider-backed implementations without changing
 * CLI JSON envelopes. See DECOUPLE.md §15.1.
 */
import type { CliConfig, T3Project, T3Runtime, T3Thread } from "../types.js";

export type BackendKind = "t3";

export const BACKEND_KINDS: readonly BackendKind[] = ["t3"];

export function isBackendKind(value: unknown): value is BackendKind {
  return value === "t3";
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

export interface Backend {
  readonly kind: BackendKind;
  catalog(): Promise<BackendCatalog>;
  inspectThread(threadId: string): Promise<BackendThreadDetail>;
}
