/**
 * JSONL thread store: per-thread directories with one `thread.json`
 * record plus append-only `turns/messages/activity/checkpoints` ledgers,
 * and a root-level `delegations.jsonl`.
 *
 * All mutations for a thread are serialized through a per-thread
 * promise-chain mutex (the enforceable replacement for a racy
 * dispatch-then-poll preflights: one active turn per session). Record
 * writes are atomic (tmp file + rename). Zero new dependencies.
 * See ARCHITECTURE.md §9.
 */
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { appEnv, appHomeDir } from "../config.js";
import { CliError } from "../errors.js";
import type { EventBus } from "../events/bus.js";
import type { BackendEvent } from "../events/bus.js";
import { decodeDataUrl, imageExtension, type ImageAttachmentUpload } from "../attachments.js";
import type {
  StoredActivity,
  StoredAttachment,
  StoredCheckpoint,
  StoredDelegation,
  StoredMessage,
  StoredThread,
  StoredTurn,
} from "./types.js";

export interface ThreadStoreOptions {
  readonly bus?: EventBus<BackendEvent>;
  /** Milliseconds since epoch; injectable for tests. */
  readonly clock?: () => number;
}

/** Home of the JSONL thread store + the projects registry. */
export function resolveStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  const raw = appEnv("STORE_ROOT", env)?.trim();
  if (raw) return path.resolve(raw);
  return path.join(appHomeDir(), "threads");
}

type LedgerName = "turns" | "messages" | "activity" | "checkpoints";

function ledgerFile(root: string, threadId: string, name: LedgerName): string {
  return path.join(root, "threads", threadId, `${name}.jsonl`);
}

function parseLedgerLine<T>(line: string, file: string): T {
  try {
    return JSON.parse(line) as T;
  } catch (cause) {
    throw new CliError("STORE_CORRUPT", `Could not parse ${file}.`, { cause });
  }
}

export class ThreadStore {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, () => void>();
  private readonly bus: EventBus<BackendEvent> | undefined;
  private readonly clock: () => number;

  private constructor(
    private readonly root: string,
    options: ThreadStoreOptions = {},
  ) {
    this.bus = options.bus;
    this.clock = options.clock ?? Date.now;
  }

  static async open(root: string, options: ThreadStoreOptions = {}): Promise<ThreadStore> {
    await mkdir(path.join(root, "threads"), { recursive: true });
    return new ThreadStore(root, options);
  }

  nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  newId(): string {
    return randomUUID();
  }

  /** Serialize async work per key; concurrent callers queue behind each other. */
  async withThreadLock<T>(threadId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    this.locks.set(threadId, current);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.locks.get(threadId) === current) {
        this.locks.delete(threadId);
      }
    }
  }

  emit(threadId: string, reason: string): void {
    this.bus?.publish({ type: "backend.thread.changed", threadId, reason });
  }

  /** Stage 2 drivers register a live run so interrupt can abort it. */
  trackRunning(turnId: string, abort: () => void): void {
    this.aborts.set(turnId, abort);
  }

  /** Whether a run in this process owns the turn. */
  isTracked(turnId: string): boolean {
    return this.aborts.has(turnId);
  }

  untrackRunning(turnId: string): void {
    this.aborts.delete(turnId);
  }

  abortRunning(turnId: string): boolean {
    const abort = this.aborts.get(turnId);
    if (!abort) return false;
    this.aborts.delete(turnId);
    abort();
    return true;
  }

  private threadDir(threadId: string): string {
    return path.join(this.root, "threads", threadId);
  }

  private threadFile(threadId: string): string {
    return path.join(this.threadDir(threadId), "thread.json");
  }

  async readThreadRecord(threadId: string): Promise<StoredThread | null> {
    let raw: string;
    try {
      raw = await readFile(this.threadFile(threadId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let record: unknown;
    try {
      record = JSON.parse(raw) as unknown;
    } catch (cause) {
      throw new CliError("STORE_CORRUPT", `Could not parse thread ${threadId}.`, { cause });
    }
    if (record === null || typeof record !== "object" || (record as { id?: unknown }).id !== threadId) {
      throw new CliError("STORE_CORRUPT", `Thread record ${threadId} is invalid.`);
    }
    return record as StoredThread;
  }

  async writeThreadRecord(thread: StoredThread): Promise<void> {
    await mkdir(this.threadDir(thread.id), { recursive: true });
    const file = this.threadFile(thread.id);
    const tmp = `${file}.tmp.${process.pid}.${this.newId()}`;
    await writeFile(tmp, `${JSON.stringify(thread)}\n`, "utf8");
    await rename(tmp, file);
  }

  async listThreadIds(): Promise<string[]> {
    const entries = await readdir(path.join(this.root, "threads"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  async readLedger<T>(threadId: string, name: LedgerName): Promise<T[]> {
    const file = ledgerFile(this.root, threadId, name);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => parseLedgerLine<T>(line, file));
  }

  /**
   * Save an image sent with a message and describe it. Bytes live under
   * the store root, beside the ledgers that reference them, so a queued
   * turn — possibly run by another process — can still send them, and the
   * transcript can show them.
   */
  async saveAttachment(upload: ImageAttachmentUpload): Promise<StoredAttachment> {
    const decoded = decodeDataUrl(upload.dataUrl);
    if (!decoded) {
      throw new CliError("ATTACHMENT_INVALID", `${upload.name} is not a base64 data URL.`, {
        exitCode: 2,
        details: { name: upload.name },
      });
    }
    const id = this.newId();
    const dir = path.join(this.root, "attachments");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}${imageExtension(decoded.mimeType)}`);
    const bytes = Buffer.from(decoded.data, "base64");
    await writeFile(file, bytes);
    return { type: "image", id, name: upload.name, mimeType: decoded.mimeType, sizeBytes: bytes.length, path: file };
  }

  /** Replace a ledger wholesale (tmp file + rename). Caller holds the thread lock. */
  async rewriteLedger(threadId: string, name: LedgerName, rows: readonly unknown[]): Promise<void> {
    await mkdir(this.threadDir(threadId), { recursive: true });
    const file = ledgerFile(this.root, threadId, name);
    const tmp = `${file}.tmp.${process.pid}.${this.newId()}`;
    await writeFile(tmp, rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
    await rename(tmp, file);
  }

  async appendLedger(threadId: string, name: LedgerName, row: unknown): Promise<void> {
    await mkdir(this.threadDir(threadId), { recursive: true });
    await appendFile(ledgerFile(this.root, threadId, name), `${JSON.stringify(row)}\n`, "utf8");
  }

  async readTurns(threadId: string): Promise<StoredTurn[]> {
    return await this.readLedger<StoredTurn>(threadId, "turns");
  }

  async updateTurn(threadId: string, turnId: string, patch: Partial<StoredTurn>): Promise<StoredTurn | null> {
    const turns = await this.readTurns(threadId);
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index < 0) return null;
    const updated = { ...turns[index]!, ...patch, id: turnId, threadId };
    const next = [...turns.slice(0, index), updated, ...turns.slice(index + 1)];
    const file = ledgerFile(this.root, threadId, "turns");
    const tmp = `${file}.tmp.${process.pid}.${this.newId()}`;
    await writeFile(tmp, next.map((turn) => JSON.stringify(turn)).join("\n") + "\n", "utf8");
    await rename(tmp, file);
    return updated;
  }

  async readMessages(threadId: string): Promise<StoredMessage[]> {
    return await this.readLedger<StoredMessage>(threadId, "messages");
  }

  async readActivities(threadId: string): Promise<StoredActivity[]> {
    return await this.readLedger<StoredActivity>(threadId, "activity");
  }

  async readCheckpoints(threadId: string): Promise<StoredCheckpoint[]> {
    return await this.readLedger<StoredCheckpoint>(threadId, "checkpoints");
  }

  private delegationsFile(): string {
    return path.join(this.root, "delegations.jsonl");
  }

  async readDelegations(): Promise<StoredDelegation[]> {
    let raw: string;
    try {
      raw = await readFile(this.delegationsFile(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const file = this.delegationsFile();
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => parseLedgerLine<StoredDelegation>(line, file));
  }

  async appendDelegation(delegation: StoredDelegation): Promise<void> {
    await appendFile(this.delegationsFile(), `${JSON.stringify(delegation)}\n`, "utf8");
  }

  async updateDelegation(
    delegationId: string,
    patch: Partial<StoredDelegation>,
  ): Promise<StoredDelegation | null> {
    return await this.withThreadLock("!delegations", async () => {
      const all = await this.readDelegations();
      const index = all.findIndex((delegation) => delegation.id === delegationId);
      if (index < 0) return null;
      const updated: StoredDelegation = {
        ...all[index]!,
        ...patch,
        id: delegationId,
        updatedAt: this.nowIso(),
      };
      const next = [...all.slice(0, index), updated, ...all.slice(index + 1)];
      const file = this.delegationsFile();
      const tmp = `${file}.tmp.${process.pid}.${this.newId()}`;
      await writeFile(tmp, next.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
      await rename(tmp, file);
      return updated;
    });
  }
}

export async function openThreadStore(
  root: string,
  options: ThreadStoreOptions = {},
): Promise<ThreadStore> {
  return await ThreadStore.open(root, options);
}
