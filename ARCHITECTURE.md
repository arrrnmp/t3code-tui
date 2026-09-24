# ARCHITECTURE.md — how moxen runs, and what is not built yet

`moxen` owns its threads, projects and orchestration, and talks to provider
runtimes directly. The code layout is in `AGENTS.md`; this file holds what
the code alone does not make obvious — the runtime rules the layout
enforces, what is still unbuilt, and the standing policy.

Everything that used to be specified here (the provider SPI, the four
drivers, threads, projects, permissions, compaction, checkpoints, usage) is
built; the code and its tests are the spec now.

| # | Surface | Transport | Auth that must work |
|---|---|---|---|
| 1 | Claude Code | Official `claude` CLI via `@anthropic-ai/claude-agent-sdk` | Claude Pro/Max subscription (inherited CLI login), API key, Bedrock |
| 2 | Codex | Local `codex app-server`, stdio JSON-RPC | ChatGPT Plus/Pro subscription (CLI `auth.json`), API key |
| 3 | OpenCode | `opencode serve` + `@opencode-ai/sdk` | API keys via the models.dev catalog; Codex and SuperGrok subscriptions via vendored OAuth plugins |
| 4 | Grok | `grok agent stdio` over ACP | Grok login (`cached_token`), `XAI_API_KEY` |

Out of scope: Cursor and Antigravity. Upstream behaviour is checked against
a depth-1 clone of OpenCode in `upstream/` — verify there, never guess.

---

## 1. Runtime rules

**One boundary.** Clients (`cli/`, `tui/`) reach the domain only through
`ClientApi` (`server/api.ts`): `dispatch` for commands, `query` for reads,
two subscriptions, `turnDiff`, `getConfig`. Shapes and their runtime
decoders live in `server/protocol.ts`; a malformed command is a compile
error for typed callers and a `CliError` for everything else.
`src/tests/layering.test.ts` pins the direction, with no exceptions:
`doctor` is a server query too, so it describes the machine the provider
sessions run on.

**Who owns a session.** A provider session — the live `claude` process,
the Codex app-server thread — belongs to the process whose drivers started
it. Three things only work from that process: streaming a turn's text,
steering it, and answering a question it is parked on. So there are two
ways to run (`server/client.ts`, chosen by `MOXEN_SERVER`):

- **in-process** (`direct`) — each client owns its drivers. A turn lives and
  dies with the client that started it; another client can read the ledger
  but not reach the session (`REQUEST_NOT_OWNED`, `steerDelivered: false`).
- **shared server** (`moxen server start`, or `MOXEN_SERVER=daemon` to
  autostart) — one process owns every session and serves `ClientApi` over
  newline-delimited JSON on a named pipe (unix socket elsewhere;
  `server/transport/`). Every client reaches every session, and turns outlive
  the client that started them. This is also what enforces a single writer
  per session.

`auto`, the default, uses a running server when there is one and runs
in-process otherwise. The wire starts with a protocol-version handshake; a
dropped connection fails in-flight requests (`SERVER_DISCONNECTED`) but
re-subscribes, and since every subscription opens with a full snapshot,
reconnecting needs no replay. The golden `--json` suite runs over both
paths and must produce identical bytes.

**Continuity across restarts.** The provider's native session handle is
stored on the thread (`providerSessions`, keyed by driver) as soon as a
turn is under way, and passed back when a session starts, so a restarted
client resumes the provider-side conversation instead of beginning an empty
one. A handle the provider no longer has starts fresh rather than failing.

**What a turn records, and in what order.** Each turn records the model it
ran on (the thread's own `modelSelection` is only the current choice).
When a turn settles, the runner writes its checkpoint and its context-window
reading *before* its outcome, so anyone who sees the turn complete also
sees both. A queued turn is started by the runner of the turn ahead of it.
A steer or inject never starts a second provider run: it goes to the
running turn when the provider can take input mid-turn (Claude, Codex,
OpenCode) and is only recorded otherwise. A turn's answer is the provider's
final message, never the notes it wrote between tool calls.

**Who owns a running turn.** A turn records the process that runs it
(`owner`: pid and host) when it becomes `running`. If that process dies
mid-turn — a crashed server, a killed CLI, a TUI closed during a turn —
nothing would ever settle the turn, and every later send would steer into
it. So any operation that touches the thread (a send, a read, the TUI's
poll) interrupts a running turn whose owner is gone on this host, and runs
the turn queued behind it. A turn owned on another host, or recorded before
owners were, is never judged.

**What a session is told.** Beyond the prompt, a session starts with
runtime instructions (`core/threads/instructions.ts`) appended to the
provider's own system prompt through its native channel — Claude's
`systemPrompt.append`, Codex `developerInstructions`, OpenCode's
per-prompt `system`, Grok's `session/new` `_meta.rules`. They say only
what moxen knows: that the session runs in a worktree, that a thread is a
delegated task, and the user's `instructions` (config, then the project's
`moxen.json`). A plain local thread with none configured gets nothing.
Every top-level thread also gets the `moxen` MCP server
(`server/mcp/`): `delegate`, `task_status`, `task_cancel`, so an agent can
hand work to a subagent thread — any provider, in a git worktree of its
own. Delegated threads do not get it; `"moxen": null` in `mcpServers`
turns it off.

Effect stays pinned at one version across the tree: two copies break
`Context.Service` identity and `Schema` brands.

---

## 2. Not built yet

**Tool harness.** Built and verified live on Claude, Grok and OpenCode:
MCP injection, runtime instructions, the `moxen` delegate tools, and the
skills / slash-command inventory (`skills.list`: Claude SDK
`supportedCommands`, Codex `skills/list`, `grok inspect --json`, OpenCode
`command.list` — never `opencode debug skill`, whose pipe output
truncates at 64KB). Codex is verified against its published app-server
schema only (no local install). Hash-anchored edits (the `hashline`
pattern) are a candidate for edit reliability — evaluated, not committed.

**Revert** rolls back every provider that saw a dropped turn, then cuts
the ledger; files stay as they are. Grok (ACP has no rollback) refuses the
whole revert before anything changes.

**Per-provider gaps.** Mid-turn steering is unsupported on Grok (ACP has
no such request). Plan mode maps to Claude's plan permission mode, Codex's
untrusted approvals and OpenCode's read-only `plan` agent; Grok takes plan
mode only at spawn (`--permission-mode plan`), so a per-turn switch is not
applied there.

**Defaults.** With neither flags, config nor project naming a model, a new
thread runs on the first provider installed here — Claude, then Grok, then
Codex — on that provider's own default (`MOXEN_DEFAULT_MODEL` pins one).

---

## 3. License ground rules (read before vendoring anything)

* `moxen` is **AGPL-3.0-only** (`LICENSE`; `package.json: private: true`
  means "not on npm", not "not AGPL").
* OpenCode is **MIT, (c) 2025 opencode** (`opencode-upstream/LICENSE`,
  `license: MIT` in `packages/{opencode,sdk/js,plugin,core}/package.json`).
  No NOTICE file; the one third-party header (`src/util/proxy-env.ts`)
  must be preserved if that file is vendored.
* **MIT → AGPL reuse is permitted.** Record the copyright and permission
  notice for every vendored file in `THIRD_PARTY_NOTICES` and/or file
  headers. The combined work stays AGPL-3.0-only. Never relicense vendored
  files; never strip notices.

## 4. Credit, trademark, and contribution posture

* Trademark intent on the `moxen` name (names cannot be forked even when
  code can). Public history stays public; architecture writing establishes
  prior art.
* DCO sign-off on outside contributions (inbound = AGPL outbound), so
  copyright stays consolidatable for enforcement or relicensing. No CLA
  unless commercial relicensing is ever on the table.
* PolyForm Perimeter/Shield were evaluated and **rejected**: not FOSS, they
  do not block reimplementation (copyright covers expression, not ideas),
  and Perimeter's non-compete would bar the "different UI" forks we
  welcome. AGPL's network clause + trademark + visible authorship is the
  chosen credit armor.

## 5. Open risks

* **OAuth drift.** Codex and xAI flows move yearly; Claude inherits CLI
  changes. Pin versions and keep the API-key fallback green. We never run
  our own Claude OAuth, but a CLI-side auth change still reaches us — watch
  `@anthropic-ai/claude-agent-sdk` releases.
* **Model lists.** The OpenCode plugin's Codex allowlist lags the native
  driver's live `model/list`; prefer native results where both exist.
* **Effect migration.** Effect's release-candidate churn, and
  workspace-only deps (`effect-acp`, `effect-codex-app-server`) that need
  path-mapping or clean-room equivalents.
* **Concurrency cost.** Per-session MCP and LSP duplication under load
  (cf. `sst#13041`) — budget it, share where safe.
* **Two writers.** In-process clients each own drivers; two of them
  running turns on one thread write one ledger from two processes. The
  shared server removes this; `auto` mode does not require it yet.
* **Version skew.** A long-running server and a newer client disagree on
  the protocol: the handshake refuses (`PROTOCOL_MISMATCH`) rather than
  guessing. Restart the server after upgrading.
