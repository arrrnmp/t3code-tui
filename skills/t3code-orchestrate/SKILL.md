---
name: t3code-orchestrate
description: Plan and run multi-model delegations across T3 Code threads. Use when a task needs decomposing into sub-tasks with per-task provider/model selection, fan-out delegation with polling and merging, adversarial verification, or cost-aware model routing.
---

# Orchestrate multi-model work across T3 Code threads

You are the orchestrator. A strong planning model breaks the goal into tasks. Then it assigns each
task the provider, model, and effort that fits it. A broad read-only sweep of a codebase can go to
a small, cheap model. A nuanced analysis task, one that must draw conclusions, needs a stronger
model. Make this call fresh, against live provider data. Do not use one fixed model for every task.

The runtime is the `t3code-threads` primitives: `create`, `list`, `inspect`, `read`, `send`,
`settle`, `unsettle`, `snooze`, `unsnooze`, `interrupt`, `delegate`, `task-status`, `task-cancel`.
There is no separate script engine and no built-in scheduler. This skill composes those primitives
on purpose, instead of using them one at a time.

Plain `threads delegate` gives you one parent, one child, one model. That is enough for a single
sub-task. Use this skill when a task needs several sub-tasks: planned up front, run at the same
time, routed to different models by fit, checked against each other, and merged.

## The moving parts

This is not a fixed pipeline. Most parts can repeat or run out of order. Two constraints are
fixed:

1. Discover and remember before you plan. You cannot route work well on guesses.
2. Verify before you merge. An unverified child report is only a claim.

Everything else happens whenever the task needs it: fanning out, polling, checking a slow child,
adding a scout after seeing another child's output, settling a finished thread. A single
delegation does not need every step below. A large audit may repeat several.

The sections below are numbered for reference, not for required order. Keep every command headless
(`--open none`) and JSON (`--json`), unless the caller asks otherwise.

## 1. Discover what you can spend

Do not guess provider or model ids. An unknown id fails with `PROVIDER_NOT_FOUND` or
`MODEL_NOT_FOUND`.

```bash
t3code --json providers list
t3code --json models list --provider <instance-id>
t3code --json efforts list --provider <instance-id> --model <slug>
```

- Offer only providers with `enabled: true`.
- Skip models with `isHidden: true` unless the caller names one explicitly. That flag means the
  user hid it from T3's own picker — a preference, not an entitlement check. A hidden model still
  dispatches fine if you route a task to it on purpose.
- All three commands accept `--refresh`. This probes live status and is slower. Use cached output
  when it is fresh. Refresh when providers changed, or a dispatch fails.
- Only the effort descriptor with `id: "effort"` gives valid `--thinking-effort` values.
  `fastMode` maps to `--speed standard|fast`. Some models have no `effort` descriptor — omit the
  flag for those.
- Changing the provider without a model fails with `MODEL_REQUIRED_FOR_PROVIDER`. Always give
  provider and model together.

`providers list` and `models list` return slugs and capability descriptors, not descriptions. A
model's name may be newer than your own training data, or a rename of one you do know. Do not
guess what a model is good for from its slug alone. Check `.t3code/model-notes.md` first (step 2);
if it says nothing about that model, research it — look up its release notes, benchmarks, or a
capability summary — before you trust it with more than a trivial task. Record what you learn in
`.t3code/model-notes.md` so the next run does not have to research it again.

`providers list` also returns `usageLimits` per provider instance. Fields: `checkedAt`, a
`windows[]` array (`id`, `kind`, `label`, `usedPercent`, `resetsAt`), and `unavailable` when the
account has no usage data or a probe failed.

This is real remaining-capacity data. It covers the whole account, not one model. Every model on a
maxed-out instance is equally constrained.

Weigh it when you route. Prefer an instance with headroom over one near its reset, for anything
that is not urgent. Say so in your one-line reason.

`usageLimits` is `null` when the driver has no notion of usage at all — an API-key account, for
example. Treat `null` as no data, not as unlimited.

Neither `usageLimits` nor `isHidden: false` proves a model will work. A model can show headroom and
still fail at dispatch time, because the account's plan does not cover it. Example: a Claude
subscription below a given Max tier cannot dispatch every Claude model on the list, and nothing in
the catalog warns you first. Record a plan-related dispatch failure in `.t3code/model-notes.md`.
Do not just retry past it.

## 2. Remember so the next run is cheaper

Keep memory scoped to the project, under `<workspace>/.t3code/`. Use two Markdown files, and keep
both current yourself:

- `.t3code/model-notes.md`: tier, observed strengths and weaknesses, cost surprises, and which
  task types each model suits. Cover only the models used on this project.
- `.t3code/orchestrator.md`: what the project is, which delegation shapes worked, which paths were
  costly, and other durable findings.

Add `.t3code/` to `.gitignore`. Do not commit memory files without explicit authorization.

Run the discovery step (step 1) on the first run in a project. After that, trust memory until it
looks stale: providers changed, a model behaves differently than recorded, or the notes are about
a week old. Do not re-run discovery when memory already answers the question.

## 3. Plan a model per task, and say why

Break the goal into tasks. Assign each task a provider, model, and effort, with a one-line reason.

Judge every enabled provider's models on the same footing. The agent you run as has a natural pull
toward its own vendor's models. A Claude-hosted orchestrator tends to reach for Claude models. A
Codex-hosted one reaches for GPT models. An OpenCode-hosted one is already used to picking across
vendors. That pull is not a reason to route work. Route each task by fit: what step 1 and your
memory files say about the model, not which provider is running you.

Use these as starting points, and override them when the task calls for it:

- Breadth first: send many small scouting tasks to cheap or free models.
- Depth and judgment: send nuanced analysis, adversarial review, and the final merge to stronger
  models.
- Start scoped — one file or one directory — then widen once the shape proves out.

A child receives only its task prompt. It gets no parent history. Put every fact the child needs
into the prompt: paths, interfaces, prior findings. State the output format exactly — a fixed line
format is easier to parse than prose. State any limits on side effects in the prompt itself (for
example, `READ ONLY`, or a list of allowed directories). The CLI cannot sandbox a turn, so the
prompt is the only control you have.

## 4. Shapes to delegate into (examples, not a menu)

These are starting shapes for splitting up work. They are not a fixed list, and not every run
needs all of them. Adapt them, combine them, rename them, or skip them. Running the whole task on
one model is a valid choice too, when it fits.

- Scout: a cheap, fast model. A broad, read-only sweep. A strict output format, for example
  `HANDLER -- MISSING CHECK -- SEVERITY` or `NO FINDINGS`.
- Researcher: a stronger model, for a question that needs analysis, not just retrieval.
- Implementer: makes the change, after scouts or researchers report. Scope it to named files.
- Critic: checks another child's findings, adversarially, before you trust them. Use this only for
  high-stakes claims.
- Merger: usually the parent itself, through `threads send`. Ranks and removes duplicates from
  child reports, into one answer.

## 5. Execute with the threads plumbing

For a single dependent step, use blocking `delegate`. It runs inside your own turn and returns
once the child finishes or the timeout elapses:

```bash
t3code --json threads delegate --thread "$PARENT" --prompt-file task-1.txt --title "scout routes" --provider <id> --model <slug> --open none
```

A fan-out dispatches more than one child with `--no-wait`. Do not sit in your own turn polling
`task-status` in a loop. There is no push notification for a finished child. A manual polling loop
either blocks your turn until the slowest child finishes, or forces you back into the turn again
and again to check. Neither scales past a couple of children.

This skill requires a signal file per child, plus one background listener, instead. Children
report back on their own as they finish:

1. In each child's task prompt, tell it to write its result to a file in a shared directory — for
   example, `.t3code/signals/<child-task-id>.result.md`. Tell it to create a marker file —
   `.t3code/signals/<child-task-id>.done` — only after the result file is fully written. Write the
   result first and the marker last. This order stops the listener from reading a half-written
   file.
2. Before, or right after, fanning out, start one background listener. Scope it to the exact set
   of child task ids you are waiting on. It polls for the marker files. As each one appears, it
   sends that child's result to the parent thread right away, with `threads send`. It does not
   wait for the slowest child before it reports the fast ones. Have it state the count in the
   message — for example, "2 of 3 children reported" — so the orchestrator can tell from the
   message text whether more are still due. It exits once every child has been sent.

Sending as each child finishes, instead of batching until they are all done, lets you act on an
early result. Example: start a critic pass on one finding while another child is still running.

This costs more. Each send wakes a new turn on the parent thread, so a fan-out of N children can
mean N turns instead of one. The listener must also track which children it already reported, so
it never sends the same one twice.

Accept that cost. It buys the ability to react while the fan-out is still running, instead of only
at the end.

macOS/Linux (bash), detached so it survives after your turn ends:

```bash
nohup bash -c '
  children=(child-a child-b child-c)
  total=${#children[@]}
  sent=0
  while [ "$sent" -lt "$total" ]; do
    for c in "${children[@]}"; do
      done_file=".t3code/signals/$c.done"
      sent_file=".t3code/signals/$c.sent"
      if [ -f "$done_file" ] && [ ! -f "$sent_file" ]; then
        sent=$((sent + 1))
        { echo "Child $c finished ($sent/$total):"; cat ".t3code/signals/$c.result.md"; } \
          | t3code --json threads send --thread "$PARENT" --stdin --open none --delivery queue
        mv "$done_file" "$sent_file"
      fi
    done
    [ "$sent" -lt "$total" ] && sleep 10
  done
' > /tmp/t3code-listener.log 2>&1 &
disown
```

Windows (PowerShell), as a background job:

```powershell
Start-Job -ScriptBlock {
  $children = @("child-a", "child-b", "child-c")
  $sent = 0
  while ($sent -lt $children.Count) {
    foreach ($c in $children) {
      $doneFile = ".t3code/signals/$c.done"
      $sentFile = ".t3code/signals/$c.sent"
      if ((Test-Path $doneFile) -and -not (Test-Path $sentFile)) {
        $sent++
        $body = "Child $c finished ($sent/$($children.Count)):`n" + (Get-Content ".t3code/signals/$c.result.md" -Raw)
        $tmp = New-TemporaryFile
        Set-Content -LiteralPath $tmp -Value $body -NoNewline
        t3code --json threads send --thread $using:PARENT --prompt-file $tmp --open none --delivery queue
        Rename-Item $doneFile $sentFile
      }
    }
    if ($sent -lt $children.Count) { Start-Sleep -Seconds 10 }
  }
} | Out-Null
```

- Start this only when the caller authorized a detached background process. Unlike the rest of
  this skill, it keeps running, and can keep sending messages to the parent thread, after your own
  turn ends.
- Send each child exactly once. Rename or delete its marker right after you send it, so a
  restarted or duplicate listener cannot resend the same report.
- Pass `--delivery queue` on every `threads send` call. The listener fires on its own schedule,
  and cannot know whether the parent thread is still processing an earlier send. `queue` dispatches
  either way, instead of failing with `THREAD_BUSY`.
- A `.done` marker means only "the child's turn reached the line that writes it." It is the
  child's own claim, not server truth. For high-stakes results, confirm with `task-status`
  (`status: "completed"`) before you trust the file. A crashed or interrupted child never writes
  its marker. A true `.done` file is still not proof that the content is correct.
- When the children are cheap, finish at about the same time, and are only useful merged, the
  listener can send once after the last marker instead of per child. That is a variant of this
  mechanism, not a reason to skip it. Do not fall back to plain `task-status` polling as your only
  signal for a fan-out.
- A wait timeout on blocking `delegate` exits with code 0 and `data.task.waitTimedOut: true`. It
  does not cancel the child. Keep `data.task.taskId` and check `task-status` again.
- Cancel a runaway task with `task-cancel`. This is a real `thread.turn.interrupt`.
  `TASK_CANCEL_UNSUPPORTED` means no interrupt could dispatch — report this, do not fake a
  cancellation. Cancelling a terminal task dispatches nothing.
- A task id from another project is rejected with `TASK_NOT_FOUND`.
- When you switch providers between turns, record the context with `threads send --handoff-note
  <text>` (CLI-side metadata only; the wire turn does not change). To steer a live turn, use
  `--delivery steer`, `restart`, or `queue` — see the `t3code-threads` skill.
- Settle a finished worker with `threads settle`. Snooze one that needs a later check with
  `threads snooze --until <ISO-datetime>`. Do either only when the caller authorized that
  lifecycle change.

## 6. Verify, then trust

Require `data.verification.accepted: true` on every write. Any `*_NOT_VERIFIED` code means the
dispatch returned, but the projection never showed it — do not retry blindly; inspect first. Score
each child against ground truth, or run a critic pass, before you merge. Write what you learned
into both memory files before you finish.

## Worked shape (real run, IDs redacted)

Goal: mirror the canonical audit example — one auditor per route file.

1. Created the parent on a free model. Fanned out three scouts with `--no-wait`, and started one
   background listener watching for their three `.done` markers.
2. Each scout wrote its result file and marker as it finished; the listener sent each report to
   the parent as it landed, all three within about 60 seconds. `task-status` confirmed each was
   truly `completed`, not just claiming to be.
3. The summaries matched planted ground truth, 3 out of 3 — including one intentionally public
   endpoint that the scouts correctly did not flag.
4. Merged the reports into one ranked summary on the parent, with `threads send`.
5. A fourth child, made deliberately slow, confirmed `running`, then was cancelled to
   `interrupted`, with accepted interrupt verification and its partial output kept.
