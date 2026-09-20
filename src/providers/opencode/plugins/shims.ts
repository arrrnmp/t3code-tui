/**
 * Shims for the vendored OpenCode auth plugins (`xai.ts`, `codex.ts`).
 *
 * Own code. Each value mirrors a single upstream binding so the vendored
 * files stay byte-identical to upstream apart from their import lines
 * (rewired to this file) and the documented WS-branch removal in
 * `codex.ts`:
 *
 * - `OAUTH_DUMMY_KEY` — value from upstream
 *   `packages/opencode/src/auth/index.ts:8`.
 * - `InstallationVersion` — upstream
 *   `packages/core/src/installation/version.ts` resolves the build-time
 *   `OPENCODE_VERSION`, falling back to `"local"`. We are not an OpenCode
 *   build, so we take the fallback branch explicitly. Used only in
 *   `User-Agent` headers and device-flow bodies.
 * - `OauthCallbackPage` — minimal replacement for upstream
 *   `packages/core/src/oauth/page.ts` (`success`/`error` only, the two
 *   functions `codex.ts` calls). Upstream renders branded OpenCode pages;
 *   ours renders plain self-contained pages with the same call signatures,
 *   which is all the loopback server needs.
 * - `Hooks` / `PluginInput` — the minimal structural subset of upstream
 *   `packages/plugin/src/index.ts` that the vendored plugins touch
 *   (`auth.loader` + `client.auth.set` + `provider.models` +
 *   `chat.headers`/`chat.params`). The full SPI ( widens to `AuthHook +
 *   ProviderHook + chat.headers/params + PluginInput`, DECOUPLE.md §8) is
 *   implemented by the `opencode serve` server itself — this file only
 *   types the plugin side so the vendored modules compile standalone and
 *   stay loadable by the server (type-only imports are erased at runtime).
 */

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";

export const InstallationVersion = "local";

/** Self-contained loopback OAuth pages (minimal `OauthCallbackPage`). */
export const OauthCallbackPage = {
  success(options?: { provider?: string }): string {
    const who = options?.provider ?? "the provider";
    const title = "Authorization successful";
    const body = `t3code is now connected to ${escapeHtml(who)}. You can close this window.`;
    return renderPage(title, body);
  },
  error(detail: string, options?: { provider?: string }): string {
    const title = "Authorization failed";
    const body =
      `t3code couldn't finish connecting` +
      (options?.provider ? ` to ${escapeHtml(options.provider)}` : "") +
      `. ${escapeHtml(detail)} Close this window and try again.`;
    return renderPage(title, body);
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPage(title: string, body: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${escapeHtml(title)}</title></head>` +
    `<body><h1>${escapeHtml(title)}</h1><p>${body}</p></body></html>`
  );
}

/**
 * Stored credential as the plugin `loader(getAuth)` thunk resolves it.
 * Mirrors upstream `packages/opencode/src/auth/index.ts` (`Oauth | Api |
 * WellKnown`, discriminated on `type`): the OAuth member keeps `refresh`,
 * `access`, and `expires` required, which is what lets the vendored
 * loaders compile unmodified. (`Schema.optional` fields are spelled
 * `T | undefined` so explicit `undefined` stays assignable under our
 * `exactOptionalPropertyTypes`, matching upstream decode semantics.)
 */
export interface PluginOAuthAuth {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  accountId?: string | undefined;
  enterpriseUrl?: string | undefined;
  [key: string]: unknown;
}

export interface PluginApiAuth {
  type: "api";
  key: string;
  metadata?: Record<string, string> | undefined;
  [key: string]: unknown;
}

export interface PluginWellKnownAuth {
  type: "wellknown";
  key: string;
  token: string;
  [key: string]: unknown;
}

export type PluginStoredAuth = PluginOAuthAuth | PluginApiAuth | PluginWellKnownAuth;

/** Minimal `client` surface the vendored loaders touch. */
export interface PluginStoreClient {
  readonly auth: {
    set(args: {
      readonly path: { readonly id: string };
      readonly body: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

/** Minimal `PluginInput` subset used by the vendored plugins. */
export interface PluginInput {
  readonly client: PluginStoreClient;
  readonly [key: string]: unknown;
}

export interface PluginOAuthSuccess {
  readonly type: "success";
  readonly refresh?: string | undefined;
  readonly access?: string | undefined;
  readonly key?: string | undefined;
  readonly expires?: number | undefined;
  readonly accountId?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

export type PluginOAuthCallbackResult = PluginOAuthSuccess | { readonly type: "failed" };

export interface PluginAuthMethodBase {
  readonly label: string;
  readonly type: "oauth" | "api";
}

export interface PluginOAuthMethod extends PluginAuthMethodBase {
  readonly type: "oauth";
  authorize(inputs?: Record<string, string>): Promise<{
    readonly url: string;
    readonly instructions: string;
    readonly method: "auto" | "code";
    callback(...args: never[]): Promise<PluginOAuthCallbackResult>;
  }>;
}

export interface PluginApiMethod extends PluginAuthMethodBase {
  readonly type: "api";
  authorize?(inputs?: Record<string, string>): Promise<unknown>;
}

/** Minimal model shape the Codex `provider.models` allowlist reads. */
export interface PluginModelInfo {
  readonly id: string;
  readonly api: { readonly id: string };
  readonly options: { readonly reasoningMode?: string | undefined };
  readonly limit: unknown;
  readonly cost: unknown;
  readonly [key: string]: unknown;
}

export interface PluginProviderInfo {
  readonly models: Record<string, PluginModelInfo>;
  readonly [key: string]: unknown;
}

export interface PluginProviderAuthContext {
  readonly auth?: PluginStoredAuth | undefined;
}

/** Minimal `Hooks` subset implemented by the vendored plugins. */
export interface Hooks {
  readonly dispose?: (() => Promise<void>) | undefined;
  readonly event?: ((input: { readonly event: { readonly type: string } }) => Promise<void>) | undefined;
  readonly provider?:
    | {
        readonly id: string;
        readonly models?: (
          provider: PluginProviderInfo,
          ctx: PluginProviderAuthContext,
        ) => Promise<Record<string, PluginModelInfo>>;
      }
    | undefined;
  readonly auth?:
    | {
        readonly provider: string;
        readonly loader?: (
          getAuth: () => Promise<PluginStoredAuth>,
          provider: PluginProviderInfo,
        ) => Promise<Record<string, unknown>>;
        readonly methods: ReadonlyArray<PluginOAuthMethod | PluginApiMethod>;
      }
    | undefined;
  readonly "chat.headers"?:
    | ((
        input: { readonly model: { readonly providerID: string }; readonly sessionID: string; readonly agent: string },
        output: { readonly headers: Record<string, string> },
      ) => Promise<void>)
    | undefined;
  readonly "chat.params"?:
    | ((
        input: { readonly model: { readonly providerID: string }; readonly sessionID: string; readonly agent: string },
        output: { maxOutputTokens: number | undefined },
      ) => Promise<void>)
    | undefined;
}
