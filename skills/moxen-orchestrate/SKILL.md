---
name: moxen-orchestrate
description: Plan and run multi-model delegations across Moxen threads. Use when a task needs decomposing into sub-tasks with per-task provider/model/effort selection, fan-out delegation with merging, adversarial verification, or cost-aware model routing.
---

# Orchestrate multi-model work across Moxen threads

You are the orchestrator. Break the goal into tasks, give each task the provider, model and effort
that fits it, run them in parallel where they are independent, check the results, and merge them.
A broad read-only sweep can go to a small, cheap model; nuanced analysis that must draw
conclusions needs a stronger one. Decide per task, against live data. Never use one fixed model for
everything.

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

## 1. Discover what you can spend

Discovery is not optional, and it comes before the plan: all three steps, every time, before the
first `delegate`.

1. **What exists.** Call `models`, then read `.moxen/model-notes.md` (below).
2. **What is left.** Check usage for *every* provider you might use — `moxen --json providers list`
   reports `usageLimits` per provider (session and weekly windows, `usedPercent`, `resetsAt`); if
   `moxen` is not on PATH, read `~/.moxen/threads/usage-limits.json`. A provider at or near 100% is
   out of the plan, not a retry. `null` means no data, not unlimited. Prefer headroom for work that
   is not urgent, and size the fan-out to what is left.
3. **What each model is good for.** Research every model you intend to use whose notes are missing
   or stale — **including the family you run on**. Your own model's name can be newer than your
   training data too; assuming its tier is not research. Use release notes and published benchmarks
   (coding: SWE-bench, Terminal-Bench, CursorBench; reasoning: HLE), price per token, and scores
   *per effort level* where published. Write what you find to the notes, with sources, and keep
   researched facts apart from your own assumptions.

Research done this way replaces trial runs: do not burn a throwaway task to find out what a model
can do. A model can still show headroom and be refused at dispatch because the plan does not cover
it; record that in the notes rather than retrying past it.

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
- Effort is a dial per task, and it starts at `medium`. Published benchmarks show medium often
  within a few points of high — and sometimes ahead of it — at a fraction of the tokens, while
  `max` can score *below* `xhigh`. Go to `high` only when the task demonstrably needs it (long
  multi-step implementation, adversarial review of high-stakes changes) and cite the benchmark gap
  in your reason; `low` for mechanical sweeps. Before raising a mid-tier model to its top effort,
  compare the next tier up at a lower effort — it can be cheaper and better. Only the
  values `models` lists for that model are valid.
- Start scoped — one file or directory — then widen once the shape proves out.

A child sees none of your conversation (unless it is a fork, below). Put every fact it needs in
`task`: paths, interfaces, prior findings, constraints. State the output format exactly. State any
limit on side effects (`READ ONLY`, allowed directories) in the task itself — the prompt is the only
control you have. Children are told to open their report with a one-line headline; ask for the rest
of the format you need.

## 4. Isolation: never let two agents write the same files

- `worktree` (the default when your thread is on a git branch): the child gets its own checkout on
  a new branch cut from yours, and commits there. Use it for anything that writes.
- `shared`: the child works in your checkout. Only for read-only work, or when nothing else is
  writing at the same time.
- Merging is your job. A finished task names its branch; review it (`git diff <yours>...<branch>`),
  then merge or cherry-pick. Merge one branch at a time and re-run the tests between merges.

## 5. Forks: a subagent that starts from your conversation

`delegate` with `fork: true` starts the child from a copy of your conversation so far, instead of
from nothing — so the task can be short ("which of the three options we discussed is cheapest to
test?"). A fork runs on your provider and in your checkout (`shared`), so keep it read-only. Use one
when the context matters more than a fresh view; use a normal delegation when you want an
independent opinion (critics, verification).

## 6. Native subagents versus `delegate`

Your provider may have its own subagents (Claude Code's Agent tool). Use those for quick, cheap,
Claude-only side work inside your own turn: an exploration pass, a search, a summary. Use
`delegate` when the task needs another provider or model, a specific effort, its own worktree and
branch, or when it should be a thread the user can open, watch and steer.

## 7. Shapes to delegate into (examples, not a menu)

- Scout: cheap, fast model, read-only sweep, strict output (`HANDLER -- MISSING CHECK -- SEVERITY`,
  or `NO FINDINGS`).
- Researcher: stronger model, a question that needs analysis rather than retrieval.
- Implementer: makes a change in its own worktree once scouts or researchers reported. Scope it to
  named files.
- Critic: checks another child's findings adversarially before you trust them — for high-stakes
  claims only.
- Merger: usually you — rank, deduplicate and combine the reports.

Running everything on one model is a valid choice when it fits.

## 8. Verify, then trust

A child's report is a claim. Check it against ground truth (run the tests, read the diff, reproduce
the finding) or run a critic before you merge. Cancel a runaway task with `task_cancel` — it keeps
the thread and worktree for inspection. Write what you learned into both memory files before you
finish.
