/**
 * T3Backend — the `Backend` facade over the live T3 Code server.
 *
 * Delegates to the existing `T3Api`/`T3ThreadApi` stack (session mint,
 * snapshot, inspect). Behavior and CLI envelopes are unchanged; this only
 * introduces the seam that direct provider backends will plug into.
 * See DECOUPLE.md §15.1.
 */
import { CliError } from "../errors.js";
import type { CliConfig, T3Runtime } from "../types.js";
import { T3Api, withT3Api } from "../cli/infra/api.js";
import { T3ThreadApi } from "../cli/threads/threadApi.js";
import type {
  Backend,
  BackendCatalog,
  BackendKind,
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
}

export function createBackend(
  kind: BackendKind,
  runtime: T3Runtime,
  config: CliConfig,
): Backend {
  if (kind === "t3") return new T3Backend(runtime, config);
  throw new CliError("BACKEND_UNKNOWN", `Unknown backend kind: ${String(kind)}.`, {
    details: { kind },
  });
}
