---
name: moxen-research
description: Run deep-research tasks as an orchestrator with researcher agents, a critic, and a finalizer. Use when the request needs multiple sources investigated in parallel, findings validated before trusting them, and a single final report assembled from agent reports.
---

# Research with orchestrated agents

You are the orchestrator of a research run. The end product is one final report with all the sources provided — lengthy, with images, tables and graphs described or included as the request demands.

## The tools

Inside a Moxen session you have the `moxen` MCP tools. They are always loaded:

- `models` — the providers you can delegate to, each with its visible models and their reasoning
  efforts. Only providers that are set up on this machine; only models the user has not hidden.
  Pass `provider` to list one. Never guess ids: an unknown one fails.
- `delegate` — hand a self-contained task to a subagent thread. Returns at once with a `taskId`.
  Inputs: `task` (required), `title`, `provider`, `model`, `effort`, `isolation`
  (`worktree` | `shared`), `fork`.
- `task_status` — where a task stands, and its report once it has finished. Waits up to `waitMs`.
- `task_cancel` — stop a running task. Its thread and worktree are kept.

Outside a session (a script, another agent) the CLI does the same:
`moxen --json providers list`, `moxen --json threads delegate --thread <parent> ...`,
`moxen --json threads task-status --thread <parent> --task <id>`. See `moxen-threads`.

## You are told when a task finishes

You do not poll. When a delegated task settles, Moxen writes a message into your thread:

```
<task-notification>
A task you delegated has settled.
- Task "scout routes" (taskId …) finished · 3m 12s · codex/gpt-5.5 · branch moxen/… · 2 files changed (+14 −3).
  Headline: Audited 3 route files: 2 missing auth checks
Call task_status with a taskId for the full report.
</task-notification>
```

If you are mid-turn it arrives as you work (on providers that take input mid-turn); otherwise it
starts a turn of its own. Tasks that settle within a couple of seconds of each other arrive as one
message. So: fan out, keep working on what does not depend on the children (or end your turn), and
act on each result as it lands. Call `task_status` only for a full report, or to check on a task
that is taking longer than it should.

## Roles

- **Orchestrator (you).** Draft the basic plan, fan researchers out, collect reports, spawn follow-ups for subtopics agents surface, send findings to the critic, and hand validated material to the finalizer. You merge; nobody else does.
- **Research agents.** Each gets one self-contained question plus the output format below. They research with provider-native tools (web search, document fetch, code execution where the provider offers it) and report back. If an agent finds subtopics, it lists them in its report — it does not spawn anything itself.
- **Critic.** Checks a set of findings adversarially before you trust it: what is unsupported, what contradicts other reports, what is missing. Used for claims that matter, not for every scout pass.
- **Finalizer.** Composes the final report from the validated reports. Nothing else.

Default all four roles to the same model family to keep one tone across the report; override per task when the task wants it (rules below).

## 1. Discover what you can spend

Call `models` before you plan. It tells you what exists here; `.moxen/model-notes.md` (below) tells
you what each model is good for. A model's name can be newer than your training data: if the notes
say nothing about it, research it (release notes, benchmarks) before you trust it with more than a
trivial task, and record what you learn.

Usage matters — a research run fans out wide and burns fast. `moxen --json providers list` reports
`usageLimits` per provider (session and weekly windows, `usedPercent`, `resetsAt`). Prefer a
provider with headroom for the bulk of the fan-out, and say so in your reason. `null` means no
data, not unlimited. A model can show headroom and still be refused at dispatch because the plan
does not cover it; record that in the notes rather than retrying past it.

## 2. Remember, so the next run is cheaper

Keep two files under `<workspace>/.moxen/` (add `.moxen/` to `.gitignore`; never commit them
without explicit authorization):

- `.moxen/model-notes.md` — per model: tier, strengths, weaknesses, cost surprises, which task types
  it suits on this project.
- `.moxen/orchestrator.md` — what the project is, which delegation shapes worked, which were costly.

Trust them until they look stale (providers changed, a model behaves differently, about a week old).

## 3. Plan a model per task, and say why

For each task: provider, model, effort, and a one-line reason. Judge every provider on the same
footing — the vendor you run on is not a reason to route work to it.

- Breadth first: many small scouting tasks on cheap or free models.
- Depth and judgment: nuanced analysis, adversarial review and the final merge on strong models.
- Effort is a dial per task: `low` for mechanical sweeps, `high` and up for real reasoning. Only the
  values `models` lists for that model are valid.
- Start scoped — one question, one source cluster — then widen once the shape proves out.

A child sees none of your conversation. Put every fact it needs in `task`: the exact question,
prior findings it builds on, constraints. State the report format exactly (headline first, then
findings, sources, subtopics — see below). Research is read-only work; state that in the task
itself — the prompt is the only control you have. Children open their report with a one-line
headline; ask for the rest of the format you need.

## 4. Isolation

- `worktree` (the default when your thread is on a git branch): the child gets its own checkout on
  a new branch cut from yours. The safe default whenever anything might write.
- `shared`: the child works in your checkout. Fine for read-only research when nothing else is
  writing at the same time — which is most of a research run.
- Merging is your job. Reports travel as `task_status` text, not files, so there is usually
  nothing to merge; if a child names a branch with material you want, review it
  (`git diff <yours>...<branch>`) before taking anything. Cancel a runaway task with
  `task_cancel` — it keeps the thread and worktree for inspection.

Your provider may have its own subagents (Claude Code's Agent tool). Use those for quick, cheap,
same-model side work inside your own turn: a follow-up lookup, a summary. Use `delegate` when the
task needs another provider or model, a specific effort, or when it should be a thread the user can
open, watch and steer.

## Report convention (prose, no schemas)

Reports travel as `task_status` text and are read by you, so write the shape in words, not JSON:

- Open with a one-line headline stating the finding.
- Then findings, then sources (every claim traceable), then subtopics found (if any).
- The critic's report is a verdict in words — what holds, what does not, and exactly what is missing so the agent can go back for it.

Keep reports tight. The finalizer reads all of them; verbosity is what kills a research run, not source count.

## Caps

- At most 8 researcher agents concurrent. Finished agents free their slot; reuse the budget for subtopic follow-ups.
- At most 3 critic rounds per set of findings. Past that, stop and escalate to the user with the open questions rather than looping.

## Flow

1. Draft the basic plan: the questions, which can run in parallel, what the final report must contain.
2. Fan researchers out. The first sweep always runs; subtopic agents spawn as reports land.
3. Validate through the critic where the claims matter. Invalid or thin findings go back with the critic's missing-list, up to the cap.
4. Hand everything validated to the finalizer for the final report.

A child's report is a claim. Check load-bearing ones against ground truth (open the cited source, reproduce the finding) or run the critic before the finalizer sees them. Write what you learned into both memory files before you finish.
