import { randomUUID } from "node:crypto";

import { T3Api } from "../infra/api.js";
import { CliError } from "../errors.js";
import type {
  InteractionMode,
  ModelSelection,
  OrchestrationSnapshot,
  RuntimeMode,
  T3Message,
  T3Project,
  T3Thread,
  ThreadDetailSnapshot,
} from "../types.js";

const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;
const DEFAULT_VERIFICATION_INTERVAL_MS = 100;

function envVerificationTimeout(): number | undefined {
  const raw = process.env.T3CODE_VERIFICATION_TIMEOUT_MS;
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function envVerificationInterval(): number | undefined {
  const raw = process.env.T3CODE_VERIFICATION_INTERVAL_MS;
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

export interface ThreadCatalog {
  snapshotSequence: number;
  projects: T3Project[];
  threads: T3Thread[];
  updatedAt: string;
}

export interface ImageAttachmentUpload {
  type: "image";
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface ExistingThreadTurnCommand {
  type: "thread.turn.start";
  commandId: string;
  threadId: string;
  message: {
    messageId: string;
    role: "user";
    text: string;
    attachments: ImageAttachmentUpload[];
  };
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  modelSelection?: ModelSelection;
  titleSeed?: string;
  createdAt: string;
}

export interface ExistingThreadTurnVerification {
  accepted: true;
  method: "message-id";
  snapshotSequence: number;
  messageId: string;
}

export type ThreadSettlementState = "active" | "settled";

export interface ThreadSnoozeCommand {
  type: "thread.snooze";
  commandId: string;
  threadId: string;
  snoozedUntil: string;
}

export interface ThreadUnsnoozeCommand {
  type: "thread.unsnooze";
  commandId: string;
  threadId: string;
  reason: "user";
}

export interface ThreadSnoozeVerification {
  accepted: true;
  snoozedUntil: string | null;
  snoozedAt: string | null;
  snapshotSequence: number;
}

export interface ThreadTurnInterruptCommand {
  type: "thread.turn.interrupt";
  commandId: string;
  threadId: string;
  turnId?: string;
  createdAt: string;
}

export interface ThreadTurnInterruptVerification {
  accepted: true;
  method: "interrupt";
  snapshotSequence: number;
  state: string | null;
}

export type ThreadSettlementCommand =
  | {
      type: "thread.settle";
      commandId: string;
      threadId: string;
    }
  | {
      type: "thread.unsettle";
      commandId: string;
      threadId: string;
      reason: "user";
    };

export interface ThreadSettlementVerification {
  accepted: true;
  state: ThreadSettlementState;
  snapshotSequence: number;
  settledAt: string | null;
  unsettledAt: string | null;
}

interface T3ThreadApiOptions {
  verificationTimeoutMs?: number;
  verificationIntervalMs?: number;
}

function asSnapshot(value: unknown): OrchestrationSnapshot {
  if (value === null || typeof value !== "object") {
    throw new CliError("T3_INVALID_SNAPSHOT", "T3 returned an invalid orchestration snapshot.");
  }
  const snapshot = value as Partial<OrchestrationSnapshot>;
  if (!Array.isArray(snapshot.projects) || !Array.isArray(snapshot.threads)) {
    throw new CliError("T3_INVALID_SNAPSHOT", "T3 returned a snapshot without projects or threads.");
  }
  return {
    snapshotSequence:
      typeof snapshot.snapshotSequence === "number" ? snapshot.snapshotSequence : 0,
    projects: snapshot.projects,
    threads: snapshot.threads,
    updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : "1970-01-01T00:00:00.000Z",
  };
}

function asThreadDetailSnapshot(value: unknown): ThreadDetailSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const snapshot = value as Partial<ThreadDetailSnapshot>;
  if (
    typeof snapshot.snapshotSequence !== "number" ||
    snapshot.thread === null ||
    typeof snapshot.thread !== "object" ||
    typeof snapshot.thread.id !== "string"
  ) {
    return null;
  }
  return snapshot as ThreadDetailSnapshot;
}

function activeThreads(snapshot: OrchestrationSnapshot): T3Thread[] {
  return snapshot.threads.filter((thread) => thread.deletedAt == null && thread.archivedAt == null);
}

function threadById(snapshot: OrchestrationSnapshot, threadId: string): T3Thread | null {
  return snapshot.threads.find((thread) => thread.id === threadId && thread.deletedAt == null) ?? null;
}

function requireTurnSettings(thread: T3Thread): {
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
} {
  const runtimeMode = thread.runtimeMode;
  const interactionMode = thread.interactionMode;
  if (
    !["approval-required", "auto", "auto-accept-edits", "full-access"].includes(runtimeMode ?? "") ||
    !["default", "plan"].includes(interactionMode ?? "")
  ) {
    throw new CliError(
      "T3_INVALID_THREAD",
      `T3 thread ${thread.id} is missing its runtime or interaction mode.`,
      { details: { threadId: thread.id } },
    );
  }
  return { runtimeMode: runtimeMode!, interactionMode: interactionMode! };
}

function dispatchSequence(value: unknown): number {
  if (value === null || typeof value !== "object") {
    throw new CliError("T3_INVALID_DISPATCH", "T3 returned an invalid dispatch result.");
  }
  const sequence = (value as { sequence?: unknown }).sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new CliError("T3_INVALID_DISPATCH", "T3 did not return a valid orchestration sequence.");
  }
  return sequence;
}

function messageWasProjected(messages: readonly T3Message[] | undefined, messageId: string): boolean {
  return messages?.some((message) => message.id === messageId && message.role === "user") ?? false;
}

function settlementWasProjected(
  thread: T3Thread,
  state: ThreadSettlementState,
  previousUpdatedAt: string | undefined,
): boolean {
  if (state === "settled") return thread.settledAt != null;
  if (thread.settledAt != null) return false;
  if (thread.settledOverride === "active") return true;
  return previousUpdatedAt !== undefined && (thread.updatedAt ?? "") > previousUpdatedAt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class T3ThreadApi {
  private readonly verificationTimeoutMs: number;
  private readonly verificationIntervalMs: number;

  constructor(
    private readonly api: T3Api,
    options: T3ThreadApiOptions = {},
  ) {
    this.verificationTimeoutMs =
      options.verificationTimeoutMs ?? envVerificationTimeout() ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
    this.verificationIntervalMs =
      options.verificationIntervalMs ?? envVerificationInterval() ?? DEFAULT_VERIFICATION_INTERVAL_MS;
  }

  async catalog(): Promise<ThreadCatalog> {
    const shell = await this.api.shellSnapshot().catch(() => null);
    const snapshot = asSnapshot(shell ?? (await this.api.snapshot()));
    return { ...snapshot, threads: activeThreads(snapshot) };
  }

  async inspect(threadId: string): Promise<{ snapshotSequence: number; thread: T3Thread }> {
    const requestPath = `/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=10`;
    return await this.readDetail(threadId, requestPath);
  }

  async read(
    threadId: string,
    options: { lastTurn?: boolean } = {},
  ): Promise<{ snapshotSequence: number; thread: T3Thread }> {
    const requestPath = `/api/orchestration/threads/${encodeURIComponent(threadId)}${
      options.lastTurn ? "?turnLimit=1" : ""
    }`;
    return await this.readDetail(threadId, requestPath);
  }

  private async readDetail(
    threadId: string,
    requestPath: string,
  ): Promise<{ snapshotSequence: number; thread: T3Thread }> {
    const detail = await this.api.request("GET", requestPath).catch(() => null);
    const parsedDetail = asThreadDetailSnapshot(detail);
    if (parsedDetail) {
      return { snapshotSequence: parsedDetail.snapshotSequence, thread: parsedDetail.thread };
    }

    const snapshot = asSnapshot(await this.api.snapshot());
    const thread = threadById(snapshot, threadId);
    if (!thread) {
      throw new CliError("THREAD_NOT_FOUND", `No T3 Code thread exists with id ${threadId}.`, {
        exitCode: 3,
        details: { threadId },
      });
    }
    return { snapshotSequence: snapshot.snapshotSequence, thread };
  }

  buildTurnStart(thread: T3Thread, prompt: string): ExistingThreadTurnCommand {
    const { runtimeMode, interactionMode } = requireTurnSettings(thread);
    return {
      type: "thread.turn.start",
      commandId: randomUUID(),
      threadId: thread.id,
      message: {
        messageId: randomUUID(),
        role: "user",
        text: prompt,
        attachments: [],
      },
      runtimeMode,
      interactionMode,
      createdAt: new Date().toISOString(),
    };
  }

  buildSnooze(threadId: string, snoozedUntil: string): ThreadSnoozeCommand {
    return { type: "thread.snooze", commandId: randomUUID(), threadId, snoozedUntil };
  }

  buildUnsnooze(threadId: string): ThreadUnsnoozeCommand {
    return { type: "thread.unsnooze", commandId: randomUUID(), threadId, reason: "user" };
  }

  buildInterrupt(threadId: string, turnId?: string): ThreadTurnInterruptCommand {
    const trimmed = turnId?.trim();
    return {
      type: "thread.turn.interrupt",
      commandId: randomUUID(),
      threadId,
      ...(trimmed ? { turnId: trimmed } : {}),
      createdAt: new Date().toISOString(),
    };
  }

  async dispatchSnooze(
    command: ThreadSnoozeCommand,
  ): Promise<{ dispatch: unknown; thread: T3Thread; verification: ThreadSnoozeVerification }> {
    const dispatch = await this.api.dispatch(command);
    const sequence = dispatchSequence(dispatch);
    const deadline = Date.now() + this.verificationTimeoutMs;

    do {
      const inspected = await this.inspect(command.threadId).catch(() => null);
      if (inspected && inspected.snapshotSequence >= sequence && inspected.thread.snoozedUntil === command.snoozedUntil) {
        return {
          dispatch,
          thread: inspected.thread,
          verification: {
            accepted: true,
            snoozedUntil: inspected.thread.snoozedUntil ?? null,
            snoozedAt: (inspected.thread.snoozedAt as string | null | undefined) ?? null,
            snapshotSequence: inspected.snapshotSequence,
          },
        };
      }
      await sleep(this.verificationIntervalMs);
    } while (Date.now() < deadline);

    throw new CliError(
      "THREAD_SNOOZE_NOT_VERIFIED",
      `T3 did not project thread ${command.threadId} as snoozed within ${this.verificationTimeoutMs}ms.`,
      {
        exitCode: 5,
        details: { threadId: command.threadId, snoozedUntil: command.snoozedUntil, dispatchSequence: sequence },
      },
    );
  }

  async dispatchUnsnooze(
    command: ThreadUnsnoozeCommand,
  ): Promise<{ dispatch: unknown; thread: T3Thread; verification: ThreadSnoozeVerification }> {
    const dispatch = await this.api.dispatch(command);
    const sequence = dispatchSequence(dispatch);
    const deadline = Date.now() + this.verificationTimeoutMs;

    do {
      const inspected = await this.inspect(command.threadId).catch(() => null);
      if (inspected && inspected.snapshotSequence >= sequence && inspected.thread.snoozedUntil == null) {
        return {
          dispatch,
          thread: inspected.thread,
          verification: {
            accepted: true,
            snoozedUntil: null,
            snoozedAt: (inspected.thread.snoozedAt as string | null | undefined) ?? null,
            snapshotSequence: inspected.snapshotSequence,
          },
        };
      }
      await sleep(this.verificationIntervalMs);
    } while (Date.now() < deadline);

    throw new CliError(
      "THREAD_UNSNOOZE_NOT_VERIFIED",
      `T3 did not project thread ${command.threadId} as unsnoozed within ${this.verificationTimeoutMs}ms.`,
      {
        exitCode: 5,
        details: { threadId: command.threadId, dispatchSequence: sequence },
      },
    );
  }

  async dispatchInterrupt(
    command: ThreadTurnInterruptCommand,
  ): Promise<{ dispatch: unknown; thread: T3Thread; verification: ThreadTurnInterruptVerification }> {
    const dispatch = await this.api.dispatch(command);
    const sequence = dispatchSequence(dispatch);
    const deadline = Date.now() + this.verificationTimeoutMs;

    do {
      const inspected = await this.inspect(command.threadId).catch(() => null);
      if (inspected && inspected.snapshotSequence >= sequence) {
        const state = (inspected.thread.latestTurn?.state as string | undefined) ?? null;
        const activeTurnId = inspected.thread.session?.activeTurnId ?? null;
        if (state === "interrupted" || activeTurnId == null) {
          return {
            dispatch,
            thread: inspected.thread,
            verification: {
              accepted: true,
              method: "interrupt",
              snapshotSequence: inspected.snapshotSequence,
              state,
            },
          };
        }
      }
      await sleep(this.verificationIntervalMs);
    } while (Date.now() < deadline);

    throw new CliError(
      "THREAD_INTERRUPT_NOT_VERIFIED",
      `T3 did not project thread ${command.threadId} as interrupted within ${this.verificationTimeoutMs}ms.`,
      {
        exitCode: 5,
        details: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          dispatchSequence: sequence,
        },
      },
    );
  }

  buildSettlement(threadId: string, state: ThreadSettlementState): ThreadSettlementCommand {
    return state === "settled"
      ? { type: "thread.settle", commandId: randomUUID(), threadId }
      : { type: "thread.unsettle", commandId: randomUUID(), threadId, reason: "user" };
  }

  async dispatchTurn(
    command: ExistingThreadTurnCommand,
  ): Promise<{ dispatch: unknown; verification: ExistingThreadTurnVerification }> {
    const dispatch = await this.api.dispatch(command);
    const sequence = dispatchSequence(dispatch);
    const deadline = Date.now() + this.verificationTimeoutMs;

    do {
      const inspected = await this.inspect(command.threadId).catch(() => null);
      if (inspected && inspected.snapshotSequence >= sequence) {
        if (messageWasProjected(inspected.thread.messages, command.message.messageId)) {
          return {
            dispatch,
            verification: {
              accepted: true,
              method: "message-id",
              snapshotSequence: inspected.snapshotSequence,
              messageId: command.message.messageId,
            },
          };
        }
      }
      await sleep(this.verificationIntervalMs);
    } while (Date.now() < deadline);

    throw new CliError(
      "THREAD_TURN_NOT_VERIFIED",
      `T3 did not project the new turn for thread ${command.threadId} within ${this.verificationTimeoutMs}ms.`,
      {
        exitCode: 5,
        details: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          dispatchSequence: sequence,
        },
      },
    );
  }

  async dispatchSettlement(
    command: ThreadSettlementCommand,
    previousUpdatedAt: string | undefined,
  ): Promise<{
    dispatch: unknown;
    thread: T3Thread;
    verification: ThreadSettlementVerification;
  }> {
    const state: ThreadSettlementState = command.type === "thread.settle" ? "settled" : "active";
    const dispatch = await this.api.dispatch(command);
    const sequence = dispatchSequence(dispatch);
    const deadline = Date.now() + this.verificationTimeoutMs;

    do {
      const inspected = await this.inspect(command.threadId).catch(() => null);
      if (
        inspected &&
        inspected.snapshotSequence >= sequence &&
        settlementWasProjected(inspected.thread, state, previousUpdatedAt)
      ) {
        return {
          dispatch,
          thread: inspected.thread,
          verification: {
            accepted: true,
            state,
            snapshotSequence: inspected.snapshotSequence,
            settledAt: inspected.thread.settledAt ?? null,
            unsettledAt: inspected.thread.unsettledAt ?? null,
          },
        };
      }
      await sleep(this.verificationIntervalMs);
    } while (Date.now() < deadline);

    throw new CliError(
      "THREAD_SETTLEMENT_NOT_VERIFIED",
      `T3 did not project thread ${command.threadId} as ${state} within ${this.verificationTimeoutMs}ms.`,
      {
        exitCode: 5,
        details: { threadId: command.threadId, state, dispatchSequence: sequence },
      },
    );
  }
}
