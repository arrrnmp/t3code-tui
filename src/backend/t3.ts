/**
 * T3Backend — the `Backend` facade over the live T3 Code server.
 *
 * Delegates to the existing `T3Api`/`T3ThreadApi` stack (session mint,
 * snapshot, inspect). Behavior and CLI envelopes are unchanged; this only
 * introduces the seam that direct provider backends will plug into.
 * See DECOUPLE.md §15.1.
 */
import type { CliConfig, T3Runtime } from "../types.js";
import { T3Api, withT3Api } from "../cli/infra/api.js";
import { T3ThreadApi } from "../cli/threads/threadApi.js";
import type {
  Backend,
  BackendCatalog,
  BackendKind,
  BackendSendInput,
  BackendSendResult,
  BackendThreadDetail,
} from "./backend.js";

export class T3Backend implements Backend {
  readonly kind: BackendKind = "t3";

  constructor(
    private readonly runtime: T3Runtime,
    private readonly config: CliConfig,
  ) {}

  private threadApi(api: T3Api): T3ThreadApi {
    return new T3ThreadApi(api);
  }

  async catalog(): Promise<BackendCatalog> {
    return await withT3Api(this.runtime, this.config, async (api) => {
      return await this.threadApi(api).catalog();
    });
  }

  async inspectThread(threadId: string): Promise<BackendThreadDetail> {
    return await withT3Api(this.runtime, this.config, async (api) => {
      return await this.threadApi(api).inspect(threadId);
    });
  }

  /**
   * Dispatch-then-verify, exactly the atomic part of the T3 send flow.
   * Busy/settled preflights stay in the CLI layer until cutover (they were
   * never atomic server-side anyway).
   */
  async send(threadId: string, input: BackendSendInput): Promise<BackendSendResult> {
    return await withT3Api(this.runtime, this.config, async (api) => {
      const adapter = this.threadApi(api);
      const inspected = await adapter.inspect(threadId);
      const command = adapter.buildTurnStart(inspected.thread, input.prompt);
      const sent = await adapter.dispatchTurn(command);
      return {
        threadId,
        messageId: sent.verification.messageId,
        delivery: "started" as const,
      };
    });
  }
}
