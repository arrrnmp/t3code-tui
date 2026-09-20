# DECOUPLE.md — Dropping the T3 Code server, owning threads + providers

**Status:** planning handoff. **Decision:** remove the T3 Code server from the loop.
`t3code-tui` keeps its CLI envelopes (`{ ok, data }`) and its TUI, but talks to
provider runtimes directly and owns threads, projects, and orchestration itself.

**Scope (locked): 4 provider surfaces.**

| # | Surface | Transport | Auth that must work |
|---|---|---|---|
| 1 | Claude Code | Official `claude` CLI via `@anthropic-ai/claude-agent-sdk` | Claude Pro/Max subscription (inherited CLI login), API key, Bedrock |
| 2 | Codex | Local `codex app-server`, stdio JSON-RPC | ChatGPT Plus/Pro subscription (CLI `auth.json`), API key |
| 3 | OpenCode | `opencode serve` + `@opencode-ai/sdk` (or vendored auth + AI SDK) | Everything else "for free": API keys via models.dev catalog, Codex-sub + SuperGrok-sub via vendored OAuth plugins |
| 4 | Grok | `grok agent stdio` over ACP | Grok login (`cached_token`), `XAI_API_KEY` |

Dropped: Cursor, Antigravity, and any other T3 driver. No T3 server, no T3 WS RPC,
no orchestration snapshot/dispatch HTTP. Tool-call paths become in-process calls
instead of dispatch-then-poll-projection.

Research backing: two depth-1 clones at
`C:\Users\Usuario\AppData\Local\Temp\opencode\` (`opencode-upstream` @ `ebb7b76`,
`t3code-upstream`). File refs below are relative to those clones unless prefixed
with `t3code-tui:`.

---

## 1. License ground rules (read before vendoring anything)

* `t3code-tui` is **AGPL-3.0-only** (`LICENSE`, 661 lines; `package.json: private: true`
  means "not on npm", not "not AGPL").
* T3 Code (`t3code-upstream/LICENSE`): **MIT, (c) 2026 T3 Tools Inc.**
* OpenCode (`opencode-upstream/LICENSE` + `license: MIT` in
  `packages/{opencode,sdk/js,plugin,core}/package.json`): **MIT, (c) 2025 opencode.**
  No NOTICE file, no proprietary headers (only a third-party snippet header in
  `src/util/proxy-env.ts` — preserve it if that file is vendored).
* **MIT → AGPL reuse is permitted.** Keep the copyright + permission notice for every
  vendored file in a `THIRD_PARTY_NOTICES` file (create it) and/or file headers.
  Combined work stays AGPL-3.0-only. Never relicense vendored files; never strip notices.
* If outside contributors land, use DCO sign-off (inbound = AGPL outbound) so copyright
  stays consolidatable for enforcement/relicensing. Trademark intent on the `t3code`
  name is the credit-protection layer licenses can't give (see §14).

---

## 2. What exists today (what we're replacing)

* `t3code-tui/src/cli/infra/api.ts` — `T3Api` (`GET /api/orchestration/snapshot`,
  `POST /api/orchestration/dispatch`), session mint/revoke via `t3 auth session issue`.
* `t3code-tui/src/cli/catalog/` — providers/models/efforts via WS `server.getConfig` /
  `server.refreshProviders` (`t3ws.ts`).
* `t3code-tui/src/cli/threads/`, `handover/`, `projects/` — thread CRUD, send with
  `reject/inject/queue/steer/restart` preflights, settle/unsettle/snooze/interrupt,
  delegate/task-status/task-cancel, workspace→project resolution.
* `t3code-tui/src/tui/` — sidebar, timeline with per-turn diffs, composer with
  model/effort pickers, tasks/answer/diff panels; projections in `tui/model/`.
* Pain this removes: dispatch-then-poll acceptance, snapshot preflights that aren't
  atomic locks, `THREAD_BUSY`/`THREAD_RESTART_FAILED` races, version-gated capability
  flags (`threadSettlement`), desktop-reveal vs deep-link opening hacks.

**Constraint: CLI JSON envelopes stay backward compatible** (AGENTS.md workflow).
`threads list/read/send/settle/…`, `projects …`, `providers/models/efforts list`,
`handover`, `doctor`, `request get` keep their shapes; only the backend changes.

---

## 3. Target architecture

```
t3code-tui
├── src/providers/            NEW — provider SPI + 4 drivers (own code, T3-shaped)
│   ├── spi.ts                ProviderDriver / ProviderAdapterShape (§4)
│   ├── claude/               Agent SDK spawn, permissions, usage (§5)
│   ├── codex/                app-server JSON-RPC runtime (§6)
│   ├── grok/                 ACP stdio runtime (§7)
│   └── opencode/             serve/SDK client + vendored auth (§8)
├── src/threads/              NEW — thread store, lifecycle, settle/snooze (§9)
├── src/projects/             rework — ID registry w/o T3 (§10)
├── src/permissions/          NEW — rulesets + per-provider mapping (§11)
├── src/harness/              NEW — tools, MCP, skills, subagents (§12)
├── src/compaction/           NEW — per-provider compaction + context (§13)
├── src/checkpoints/          NEW — git snapshots, diffs, rollback (§13)
├── src/usage/                NEW — tokens/cost/quota windows (§13)
├── src/events/               NEW — typed event bus replacing T3 pushes (§9)
└── src/cli/ + src/tui/       retarget onto the above, envelopes unchanged
```

Effect is already a dependency (`effect 4.0.0-beta.78`). **Upgrade to
`effect@4.0.0-rc.115` first** — T3's provider code (the reference implementation)
pins `rc.115` + `effect/unstable/*` paths; two Effect copies break
`Context.Service` identity and `Schema` brands. Do this before lifting anything.

---

## 4. Provider SPI (copy the shape, not the Layers)

T3's `provider/Services/ProviderAdapter.ts:67-158` is dependency-clean (imports only
`@t3tools/contracts` + `effect/Stream`). Mirror it:

```ts
capabilities: { sessionModelSwitch; promptlessTurnContinuation?;
                supportsConversationRollback?; compaction: native | slash-command }
lifecycle: startSession / sendTurn / interruptTurn / respondToRequest /
           respondToUserInput / stopSession / listSessions / hasSession / stopAll
state: readThread / rollbackThread / uploadFeedback? / compaction?
streaming: streamEvents: Stream<ProviderRuntimeEvent>
```

Lift `t3code-upstream/packages/contracts` schema thinking as-is (sole dep `effect`):
thread/turn IDs, session inputs, `ProviderRuntimeEvent` union (keep per-backend `raw`
source tags — `providerRuntime.ts:23-33` pattern), model catalogs, settings schemas.
Do **not** lift `Layers/*Adapter.ts` (16k lines) directly — they drag 15–30k lines of
runtime (`CodexSessionRuntime` 2.5k, ACP stack, `opencodeRuntime` 1k) plus 8 bespoke
host services (`ServerConfig`, `ServerSettingsService`, `BackgroundPolicy`,
`ProviderEventLoggers`, `ModelManifest`, `OpenCodeRuntime`, `AntigravityInstallation`,
`CodexResetCreditCoordinator`; union at `builtInDrivers.ts:36-42`). Reimplement thin
drivers against the CLIs; §5–8 give the per-provider spec.

---

## 5. Claude Code driver

Reference: `t3code-upstream/apps/server/src/provider/{Drivers/ClaudeDriver.ts,
Layers/ClaudeAdapter.ts (5,218 lines), Layers/ClaudeProvider.ts,
Layers/claudeUsageLimits.ts, Drivers/ClaudeHome.ts}`,
SDK `@anthropic-ai/claude-agent-sdk ^0.3.276`.

* **Transport:** spawn official `claude` via `pathToClaudeCodeExecutable`
  (`ClaudeAdapter.ts:4916`); text-gen side-channel `claude -p --output-format json`
  (`textGeneration/ClaudeTextGeneration.ts:1-8,55-71`). Windows: resolve npm shim to
  `bin/claude.exe`/`cli.js` (`Drivers/ClaudeExecutable.ts:61-90`) — SDK spawns shell-less.
* **Auth (the whole point):** implement **no OAuth**. `ClaudeSettings` has no `apiKey`
  (`settings.ts:621-676`: only `binaryPath/homePath/launchArgs/autoCompactWindow`).
  Inject `CLAUDE_CONFIG_DIR` only — never override `HOME` (breaks macOS keychain OAuth
  lookup, `ClaudeHome.ts:46-51`). Signed-out → tell user `claude auth login`.
  Subscription identity is read-only from SDK init
  (`ClaudeProvider.ts:375-390`: `init.account.{subscriptionType,tokenSource,apiProvider}`
  → Max/Max5x/Max20x/Pro/Team/Enterprise/Free/apiKey/bedrock, `:70-164`). Bedrock via
  external AWS creds (25s probe timeout); no Vertex support in T3 — match that.
* **Permissions:** map modes → SDK `permissionMode`
  (`ClaudeAdapter.ts:4879-4891`: `auto-accept-edits→acceptEdits`, `auto→auto`,
  `full-access→bypassPermissions` + `allowDangerouslySkipPermissions`). Enforce via
  `canUseTool` → `request.opened/resolved` with `file_read/command_execution/
  file_change/dynamic_tool_call` classification; `AskUserQuestion` always surfaces;
  `ExitPlanMode` captured as proposed-plan then denied; `plan` mode via live
  `setPermissionMode` (`:5187-5200`); session-scoped accepts.
* **Compaction:** declare `slash-command /compact` (`:5573`), observe
  `system/compact_boundary` (clear latest-usage, snapshot pre/post tokens, emit
  `compacted`), `autoCompactWindow` passthrough, resume-time Compact/Keep/Nevers dialog.
* **Rollback:** `getSessionMessages` + `forkSession({upToMessageId})` + resume
  (`:5306-5485`, UUID remap `:184-225`); hard-error when boundaries are gone
  post-compaction. No Git involvement on this path.
* **Usage/context/cache:** from SDK stream only (no header parsing):
  `assistant.message.usage` + `task_progress` + `result.total_cost_usd` passthrough (no
  cost tables); track `input/cache_read/cache_create/output/thinking`, `main_agent`
  scope, context window from catalog. Quota windows: `get_usage` probe → Session (5h)
  + Weekly (7d) + per-model Weekly rows (`claudeUsageLimits.ts:30-80`); live
  `rate_limit_event` parks the turn with "paused until Xh Ym" (`ClaudeAdapter.ts:4081-4140`).
  Absent windows on successful probe = API-key account.

---

## 6. Codex driver

Reference: `t3code-upstream/apps/server/src/provider/{Drivers/CodexDriver.ts,
Layers/CodexAdapter.ts (2,594), Layers/CodexSessionRuntime.ts (2,534),
Layers/CodexProvider.ts, Layers/codexUsageLimits.ts, Layers/codexLaunchArgs.ts,
Drivers/CodexHomeLayout.ts}`.

* **Transport:** spawn `codex app-server` per session, stdio JSON-RPC
  (`codexLaunchArgs.ts:12-15`; `CodexSessionRuntime.ts:1322-1354`, `forceKillAfter 2s`).
  Methods: `initialize/initialized`, `thread/start|resume` (`excludeTurns:true` + fresh-start
  fallback), `turn/start`, `turn/interrupt`, `thread/compact/start`, `thread/read` +
  `thread/turns/list`, `thread/rollback` (legacy) / `thread/revert {beforeTurnId}`
  (paginated), `feedback/upload`, `account/read`, `model/list` (paginated),
  `skills/list`, `account/rateLimits/read|updated`,
  `account/rateLimitResetCredit/consume`, `config/mcpServer/reload`.
* **Auth:** none of our own — reuse CLI `auth.json` under `CODEX_HOME`, per-account
  shadow homes (auth.json + models_cache.json private, `CodexHomeLayout.ts:32`,
  materialized `CodexDriver.ts:147`; reset-credit lock keyed on auth dir `:282-285`).
  Unauthenticated → `codex login`. Account types surfaced: `apiKey|amazonBedrock|chatgpt`
  (`CodexProvider.ts:97-143`).
* **Permissions:** server-driven prompts (`commandExecution/fileChange/permissions/
  elicitation/userInput` requests, `CodexSessionRuntime.ts:2056-2346`); decisions
  `accept/decline/cancel` + `acceptForSession` (downgrade `acceptAlways`); static policy
  from mode (`:509-581`: `approval-required→untrusted/read-only`,
  `auto(-accept-edits)→on-request/workspace-write`, `full-access→never/danger-full-access`).
  Interrupt must settle parked approvals/inputs first (stdin-loop deadlock, `:2561-2603`).
* **Compaction:** native (`compaction.type: native`, `compactsAutomatically`).
  Handle `thread/compacted` notifications (`CodexAdapter.ts:1528-1544`).
* **Usage:** `rateLimits/read` (3s, degrade-to-message) + live `rateLimits/updated`
  merged per session (ignore non-`codex` limitIds); windows primary/secondary →
  session/weekly/monthly (`codexUsageLimits.ts:55-98`); `usageLimitExceeded` rewritten to
  "resets in X"; **reset-credit consume** serialized per account dir + re-probe
  (`CodexDriver.ts:278-338`). Tokens: `thread/tokenUsage/updated` total-vs-last deltas.
* **Models:** live `model/list`, **no allowlist**; `reasoningEffort`
  (none/minimal/low/medium/high/xhigh/max/ultra) + `serviceTier` selects per turn.

---

## 7. Grok driver

Reference: `t3code-upstream/apps/server/src/provider/{acp/GrokAcpSupport.ts,
Layers/GrokAdapter.ts (2,107), Layers/GrokProvider.ts, Layers/grokUsageLimits.ts,
Drivers/GrokDriver.ts}`, `textGeneration/GrokTextGeneration.ts`.

* **Transport:** spawn `grok agent stdio` over ACP (`GrokAcpSupport.ts:33-63`),
  per-mode argv (`approval-required→--permission-mode default`,
  `full-access→--always-approve`), `GROK_OAUTH2_REFERRER=t3code` injected
  (keep a `t3code` referrer value). Binary path user-configurable (`settings.ts:723-729`).
  Probes: `grok --version` (4s), `grok models`, ACP `initialize()` (8s, warning-only).
* **Auth:** env switch — `XAI_API_KEY` set → `xai.api_key`, else CLI `cached_token`
  (`GrokAcpSupport.ts:65-69`); unauthenticated → `grok login`. No own OAuth.
* **Lifecycle:** ACP session per thread, opaque resume cursor v1, steer-on-send while
  `promptsInFlight>0`, 10-min silent / 30-min active-tool stall watchdog, images as
  base64 ACP blocks (other files via prompt path text).
* **Permissions:** `session/request_permission` round-trip with `allow_always→allow_once`
  fallback (Grok 4.6 omits `allow_always`); `full-access`/session-approved auto-approve;
  reject `/always-approve` typed as a turn.
* **Compaction:** delegate `slash-command /compact`, seeded from ACP `initialize._meta`;
  no auto-compaction. **Rollback explicitly unsupported**
  (`supportsConversationRollback: false`).
* **Models:** built-in slug `grok-build` = "current CLI model" (never sent over wire);
  real list from ACP `SessionModelState` else `grok models` parse; per-model
  `reasoningEffort` select from ACP `_meta`, applied at start + per turn.
* **Usage:** billing probe `GET cli-chat-proxy.grok.com/v1/billing?format=credits`
  with the `auth.json` key for `b1a00492-…` → single `subscription` window
  (weekly/monthly/other); `unavailable` for API-key/custom deployments; 10s timeout.
  No 429 handling in T3 — add generic retry/backoff ourselves.

---

## 8. OpenCode surface (the long tail, "for free")

Reference: `opencode-upstream/packages/opencode/src/{plugin/openai/codex.ts (575),
plugin/xai.ts, provider/{auth.ts,provider.ts,transform.ts}, session/,
permission/index.ts}`, `packages/core/src/{models-dev.ts,plugin/models-dev.ts}`,
`packages/plugin/src/index.ts` (SPI), `packages/sdk/js` (generated client).

* **Catalog (automatic breadth):** `core/src/plugin/models-dev.ts:124-139` mints
  `key`+`env` auth for every models.dev provider with `env[]` — that's the 75+.
  Fetch `https://models.opencode.ai/api.json`, 5-min TTL disk cache + snapshot fallback;
  **pin a snapshot** so fresh machines work offline and slugs stay stable for threads.
  Generic "enter API key" fallback (`cli/cmd/providers.ts:174,481`).
* **Vendored plugins:** `plugin/xai.ts` as-is (pure `fetch` device-code + refresh;
  shim 2 consts); `plugin/openai/codex.ts` minus WS branch (shim `OAUTH_DUMMY_KEY`,
  `InstallationVersion`, callback HTML from `core/src/oauth/page.ts`; drop
  `ws-pool.ts` or take the `ws` dep). Client IDs: Codex `app_EMoamEEZ…`
  (`codex.ts:10`), xAI `b1a00492-…` (`xai.ts:6`); Codex rewrites to
  `chatgpt.com/backend-api/codex/responses` + `ChatGPT-Account-Id`/residency headers;
  xAI deliberately keeps default `api.x.ai/v1` baseURL. Codex OAuth allowlist is static
  (`gpt-5.5/5.4/5.4-mini/5.3-codex-spark`, bans `-pro`/`5.6`) — expect lag on new models
  (cf. `gpt-6-astra` miss, v1.18.29). Other custom plugins (`azure`, `github-copilot`,
  `cerebras`, `cloudflare`, `digitalocean`, `snowflake-cortex`, `modal/`) — vendor
  à la carte as needed; unvended providers fall back to key flow.
* **SPI note:** `AuthHook` alone is insufficient — implement the wider
  `AuthHook + ProviderHook + chat.headers/params + PluginInput{getAuth, client.auth.set}`
  (~30-line auth-store adapter; `plugin/src/index.ts:56-66,88-163,214-260`).
* **Reuse pure pieces:** effort/params `transform.ts` (remap `Provider.Model` type);
  permission `evaluate()` + `Wildcard.match` (14-line glob→RegExp); models-dev
  Schema+URL/TTL logic (strip Effect). **Rewrite, don't vendor:** session engine
  (`session/llm.ts`, `message-v2.ts`, `processor.ts` — Effect+drizzle+OTEL),
  Auth/Provider Effect stores (take only the `Info` schema + dummy key), SSE/server/TUI.
* **Serving choice (open):** (a) spawn `opencode serve` per working dir + generated SDK
  (proven: T3's `OpenCodeDriver` does exactly this, `MINIMUM_OPENCODE_VERSION 1.14.19`,
  one server per thread for chat, shared helper for catalog/text-gen); or (b) embed via
  SDK + own loop with vendored auth. (a) first — it preserves `abort/fork/share/todo/
  diff`, `promptAsync`, SSE events with zero porting.

---

## 9. Threads (we own — the core build)

* **Store:** thread = id, projectId, title, modelSelection `{instanceId, model, options}`,
  runtimeMode, interactionMode, env (local/worktree path+branch), lifecycle
  (active/settled/snoozedUntil/archived), turn ledger, message ledger with `turnId`,
  checkpoints refs, activity rows. SQLite (drizzle, mirroring OpenCode session tables)
  or JSONL tree files (Pi-style) — decide in implementation; either beats T3's
  event-sourced engine for our scale.
* **Lifecycle ops:** create, `list --status active|settled|snoozed|all` (snoozed =
  unsettled + `snoozedUntil` future — keep current semantics), inspect/read
  (`messages|turn-items|plans|checkpoints|transfers`), send (exactly-one prompt source),
  `settle/unsettle/snooze/unsnooze` (client-side flags; OpenCode only has archive —
  keep our flags), `interrupt` (per-provider abort: `session.abort`, `turn/interrupt`,
  ACP cancel, `AbortSignal`), `delegate/task-status/task-cancel` (child thread + wait
  budget + re-poll; cancel via real interrupt path).
* **Busy semantics (keep CLI-stable):** `reject` default snapshot preflight,
  `inject/queue/steer/restart` policies — but now enforceable with a real per-session
  mutex instead of a racy preflight. One active turn per session everywhere.
* **Events:** own typed bus replacing T3 pushes + OpenCode SSE:
  `message.part.updated`, `tool.execute.*`, `turn.plan.updated`, permission/question
  request/resolved, `token-usage.updated`, `rate-limits.updated`, `thread.state.changed`.
  Needs replay/sync so TUI + CLI + scheduled senders see the same truth.
* **Multi-client rules:** single writer per session, directory-keyed routing
  (`x-opencode-directory` pattern), never assume cross-server isolation.

---

## 10. Projects (we own)

T3's `list/resolve/ensure` + `workspaceRoot` mapping + per-project
`defaultModelSelection` + `local/worktree` modes, minus T3. OpenCode's project API
(`GET /project`, name/icon/commands only, no create/delete/ordering) is insufficient —
keep our own ID registry: resolve cwd→(repo root|folder per `workspaceMode`),
policy `create|existing`, worktree provisioning from current branch + setup script,
`newWorktreesStartFromOrigin`-style default recorded per installation. Newly created
projects need a default model decision (today: version-dependent `gpt-5.4`/`gpt-6-astra`
passthrough — replace with explicit default).

---

## 11. Permissions (we own, 4 providers)

One `allow/ask/deny` ruleset per tool+pattern (vendor OpenCode `evaluate` + wildcard),
one mapping per provider (§5–7 + OpenCode generic ruleset + `workflow_tool_approval`
bridge). Always set explicit session rulesets; serialize prompts (concurrent-modals
freeze, `sst#3944`); no `*`-allow inheritance into subagents (`#12566` hang class);
`deny` must stop the turn (over/under-constrain bugs `#26700/#30527/#30610`); `bash`
and subagent-echo bypasses (`#4642`) are test cases, not surprises. Plan mode:
Claude live `setPermissionMode`, Codex per-turn sandbox, Grok argv, OpenCode agent
selector. Snapshot rule: no shared-server grant widening (T3's auto-`once` rationale).

---

## 12. Tool harness (biggest build item, now bounded)

One MCP-injection path (per-turn env, the hotspot in every T3 adapter:
`CodexAdapter.ts:2274`, `ClaudeAdapter.ts:4904-4950`), one attachment resolver
(images ≤ provider caps: OpenCode native is `png/jpeg/gif/webp` + `text/*` + `pdf≤20MB`,
else path-in-prompt; Codex `localImage` by path; Grok base64 ACP blocks), one
runtime-instructions builder (lift T3's `RuntimeInstructions` logic), skills +
slash-commands (OpenCode inventory via SDK `app.skills`/`command.list` — never
`opencode debug skill`, 64KB pipe truncation per `OpenCodeDriver.ts:171-178`),
subagent/task tool with worktree isolation + `acceptForSession` scoping,
AskUserQuestion passthrough. Hash-anchored edits (Oh-My-Pi `hashline` pattern) are a
candidate upgrade for edit reliability — evaluated, not committed.

---

## 13. Compaction / context / checkpoints / usage (per-provider table is the spec)

| Area | Claude | Codex | Grok | OpenCode-generic |
|---|---|---|---|---|
| Compaction | Observe `/compact` boundary, token snapshots | Native `thread/compact` + auto flag | Delegate `/compact`, seeded commands | Summarizer agent + prune |
| Context/cache | SDK usage split (in/read/create/out/thinking), catalog window | `tokenUsage/updated` deltas, `main_agent` | ACP-provided; stall watchdog ours | Per-message cost/tokens only |
| Checkpoints | SDK fork-based rollback (no Git path) | Native rollback/revert + our Git store | No provider rollback (Git store only) | `diff/revert/unrevert` + VCS endpoints, busy-rejects, snapshot GC |
| Usage windows | Session/Weekly + model rows; over-limit park + "paused until" | Session/weekly/monthly + **reset-credit consume** + rewrite | Single `subscription` billing window; unavailable on API-key | None — scrape errors/headers/DB or accept gap |

TUI needs: per-turn diffs (from §13 stores), token/cost footer (context usage card
already exists: `tui/ui/contextusagecard.tsx`), usage panel (degraded gracefully per
provider — `PROVIDER_NOT_FOUND`/`MODEL_NOT_FOUND`-style errors keep listing what exists).

---

## 14. Credit, trademark, and contribution posture

* Notices: `THIRD_PARTY_NOTICES` (new) records every vendored file + MIT text.
* Trademark intent on the `t3code` name (names can't be forked even when code can).
* Public history stays public; architecture writing establishes prior art.
* DCO sign-off on PRs; inbound = AGPL outbound. No CLA until/unless commercial
  relicensing is ever on the table.
* PolyForm Perimeter/Shield were evaluated and **rejected**: they are not FOSS, they
  don't block reimplementation/idea-learning (copyright covers expression, not ideas),
  and Perimeter's non-compete would likely bar the "different UI" forks we welcome.
  AGPL's network clause + trademark + visible authorship is the chosen credit armor.

---

## 15. Migration phases (T3-server stays up until cutover)

1. **Foundations:** Effect `rc.115` upgrade; `src/providers/spi.ts` + `src/events/`
   bus + `src/threads/` store with T3 still behind a `T3Backend implements Backend`
   facade. CLI envelopes untouched. (`bun run check` green throughout.)
2. **Provider 1 (Codex):** app-server runtime + shadow-home auth + approvals +
   native compaction/rollback + usage windows. Handover/send on Codex direct;
   T3 remains for the rest.
3. **Providers 2–3 (Claude, Grok):** Agent-SDK + ACP runtimes per §5/§7.
   Claude-sub is the acceptance test (Pro/Max login inherited, quota windows live).
4. **OpenCode surface:** serve/SDK client + vendored Codex/xAI plugins + pinned
   models.dev snapshot. Retires `catalog/t3ws.ts`.
5. **Cutover:** projects registry + settle/snooze + checkpoints + usage panels on own
   stores; `doctor` repointed (binaries, auth, versions); T3 codepaths deleted;
  `request get` escape hatch repointed or removed (envelope stays, path space changes —
   document it).
6. **Hardening:** permission fuzz tests (bypass classes), multi-client stress,
   snapshot GC, Windows/musl natives, scheduled-send docs updated (bun path stays).

## 16. Testing contract (AGENTS.md)

* `bun run check` (typecheck + vitest) before claiming any phase done.
* TUI behavior changes extend `tui/render-check.tsx` scenarios + `tui/model/*.test.ts`
  (sidebar/model-picker/threads suites already exist — add decoupling suites per phase).
* New fixtures in `tui/render-check/fixtures.ts` for direct-backend threads (no T3
  projection shapes); keep JSON envelopes asserted in `cli/*/tests/`.

## 17. Open risks

* OAuth drift (Codex/xAI flows move yearly; Claude inherits CLI changes) — pin versions,
  keep API-key fallback green.
* Anthropic blocks third-party Claude OAuth — unaffected (we never do our own), but a
  CLI-side auth change still hits us; monitor `@anthropic-ai/claude-agent-sdk` releases.
* Codex allowlist lag (OpenCode plugin) vs live `model/list` (native driver) — prefer
  native driver results where both exist.
* Effect `beta.78→rc.115` migration fallout; pnpm-workspace-only deps
  (`effect-acp`, `effect-codex-app-server`) need path-mapping or cleanroom equivalents.
* Per-session MCP+LSP duplication cost under concurrency (cf. `sst#13041`) — budget,
  share where safe.
