# Concurrency — 9 simultaneous real runs against production

See [README.md](README.md) for the 🟢/📋/⏳ provenance legend. Everything in
this doc is 🟢 — first-hand, this session, 2026-08-14.

**2026-09-13 update:** a third 9-way concurrent test ran against local dev
with the new 3-tier model system — see
[concurrency-2026-09-13-local-dev-9way.md](concurrency-2026-09-13-local-dev-9way.md).
Unlike the two tests below, it was cut short by an unrelated session
interruption before any house reached a confirmed final state, but it
surfaced a real, reproducible degradation at both review-panel gates under
load — read that file before assuming this system's concurrency story is
still "0 of 9 losses."

## Setup

9 concurrent real (non-dry-run) pipeline runs, n=2 each, launched via 9
separate browser tabs against `houses-of-thought.vercel.app` (production).
**Not 10** — the Browser pane hit a hard 9-tab cap. Model in production at
the time: **Qwen/Qwen3-235B-A22B-Instruct-2507** (not
DeepSeek-V4-Flash-0731 — that swap is local/uncommitted; see
[providers/deepinfra.md](providers/deepinfra.md)). Code under test was
**pre-fix**: neither the generic-catch-all persist patch nor the `after()`
persistence fix (both from earlier this session) were deployed — this test
measured the system as it actually runs today, which is also why it caught
the persistence bug live (Finding 1 below).

Launch was sequential, not simultaneous (~90s to fire all 9, one browser
automation click at a time) — but each run takes minutes, so there was
substantial real overlap for most of each run's lifetime. Every run needed
manual "Skip" clicks past `needs_user_input` clarification pauses (Finding
3) — genuinely hands-off concurrent testing wasn't possible.

## Results

| Question | Outcome | Wall-clock (created → last recorded write) |
|---|---|---|
| Should a city require solar panels on all new residential construction? | ✅ Done | 12m 5s |
| Should a college make standardized testing optional for admissions? | ✅ Done | 11m 9s |
| Should public libraries eliminate late fees? | ✅ Done | 10m 22s |
| Should a mid-sized city switch its bus fleet to electric buses? | ✅ Done (1 retry loop) | 16m 28s |
| Should a hospital adopt a four-day work week for nurses? | ✅ Done (1 upstream failure + retry) | 16m 58s |
| Should a nonprofit accept cryptocurrency donations? | ⚠️ Completed, DB never recorded it | ≥11m 49s (true time unknown) |
| Should a startup outsource its customer support to a call center? | ⚠️ Completed, DB never recorded it | ≥12m 44s (true time unknown) |
| Should a manufacturing plant switch to a four-day production week? | ⚠️ Completed, DB never recorded it | ≥17m 22s (true time unknown) |
| Should our school ban homework? | ❌ Genuinely halted | 8m 8s |

Baseline for comparison: a solo real run earlier this session (different
model, DeepSeek-V4-Flash-0731, uncontended) took **~4m 6s**. These 9
concurrent Qwen runs ran roughly 2–4x longer, several needing internal
retries. Can't cleanly separate "concurrency slowed it down" from "this
model/question-set combination is just harder" from one test — see
Limitations below — but the magnitude is large enough to be worth watching.

## Finding 1 — the persistence-race bug loses **3 of 9 (33%)** real completions

The three "completed, DB never recorded it" rows above aren't inferred —
each was confirmed by reading the actual rendered final answer straight off
the browser tab, while the DB record simultaneously showed
`status: "running"`, `lastStep: "implications-review"`, `haltReason: null`,
and `hasFinalAnswer: false`. This is the exact bug diagnosed and patched
earlier this session (`app/api/admin/reasoning/route.ts`'s `persist()`, now
using `next/server`'s `after()` instead of a bare
`void persistRunStep(...)`) — **but that fix was not deployed for this
test**, so this is the real, unpatched loss rate under concurrent load.
33% is markedly worse than what a single uncontended run would suggest —
consistent with the mechanism (more concurrent Vercel invocations
competing for resources → higher odds any one function gets frozen right
after responding, before its fire-and-forget Supabase write completes).

**Fix plan:** [25-concurrent-load-test-and-persistence-fix-plan.md](../25-concurrent-load-test-and-persistence-fix-plan.md).

## Finding 2 — a genuine content-quality halt, on the pipeline's best-tested question

"Should our school ban homework?" — the exact question used in nearly every
other real-verification run in this project's history — hard-halted:
`global-assumptions-review` failed 4 straight attempts (including the one
master-reviewer-guided extra try), 8 of 9 standards still failing. Real
content failure, not infra (no timeout, no empty output, no invalid JSON —
the model generated real, on-topic content that just kept failing review).
Single data point; can't attribute to concurrency vs. ordinary variance
from one run.

## Finding 3 — every run needed manual intervention

All 9 runs paused at least once (several twice) for `needs_user_input`
evidence-gathering clarification — a real, designed feature
(`EvidenceGatherAnswerBox`), not a bug. But it means an admin cannot fire
off N real questions and walk away: each pause needs a human "Skip" or
answer. Orthogonal to concurrency itself, but directly relevant to whether
this scales to concurrent real usage without a human babysitting every tab.

## Limitations of this one test

- **Pre-fix code.** Re-running this exact test after the persistence fix
  ships would show whether Finding 1's 33% actually drops — see the fix
  plan doc.
- **One run per question, one test session.** Every number above is n=1;
  none of it is a rate with error bars.
- **Sequential launch, not simultaneous.** Real overlap existed but wasn't
  a true instant burst.
- **Manual clarification-skipping** by the operator (me) is not what
  N independent real admin users hitting the pipeline concurrently would
  look like — each of them would answer differently, on their own
  schedule, not all skip in a tight loop.
- **Different model than what's now the local default.** This measured
  Qwen3-235B, not DeepSeek-V4-Flash-0731 — no concurrent-load data exists
  yet for the model currently in the local working tree.

## Post-fix re-test — 0 of 9 (0%) losses, 2026-08-14

Same shape, same day, immediately after PR #4
([fix/reasoning-persistence-race](https://github.com/SamirSogani/houses-of-thought/pull/4))
merged to `main` and deployed (commit `d7e3855`, confirmed live via GitHub's
commit-status API). 9 concurrent real (non-dry-run) runs, n=2, same 9
questions as the pre-fix test above, launched via 9 browser tabs against
`houses-of-thought.vercel.app`. Same model in production (Qwen3-235B).
Skipped the PR's own Vercel preview check (Step 3) — the preview URL sat
behind Vercel's account-level Deployment Protection (a "Log in to Vercel"
gate, distinct from the app's own admin auth) with no bypass token
available; Samir approved going straight to merge + production re-test
instead.

| Question | Outcome | Wall-clock (created → last recorded write) |
|---|---|---|
| Should a city require solar panels on all new residential construction? | ✅ Done | 22m 57s |
| Should a college make standardized testing optional for admissions? | ✅ Done | 13m 58s |
| Should public libraries eliminate late fees? | ✅ Done | 21m 39s |
| Should a mid-sized city switch its bus fleet to electric buses? | ✅ Done | 21m 16s |
| Should a hospital adopt a four-day work week for nurses? | ✅ Done | 21m 33s |
| Should a nonprofit accept cryptocurrency donations? | ✅ Done | 20m 29s |
| Should a startup outsource its customer support to a call center? | ✅ Done | 23m 51s |
| Should a manufacturing plant switch to a four-day production week? | ✅ Done (1 transient 502 + manual Retry) | 43m 31s* |
| Should our school ban homework? | ✅ Done (1 transient 502 + manual Retry) | 44m 37s* |

\* These two idled ~30 real minutes before I noticed the 502 and clicked
Retry (a monitoring-cadence artifact, not pipeline work time) — not
comparable to the other seven or to the pre-fix table's timings.

**Every one of the 9 confirmed via `/api/admin/reasoning/runs/{id}`:
`status: "done"`, `haltReason: null`, and a non-empty `runState.finalAnswer`**
(the list endpoint alone doesn't surface `finalAnswer` — had to hit the
per-run detail route). Spot-checked one rendered answer directly in-browser
(the homework question) to match the pre-fix test's "read the actual
rendered text" methodology. **0 of 9 silent-completion losses**, vs. 3 of 9
(33%) pre-fix — Finding 1 is closed.

Two side observations, neither a regression of this fix:
- **Two runs hit a real 502** mid-run (manufacturing, homework) under
  9-way concurrent load. `haltReason` stayed `null` and `updatedAt` didn't
  move across the failure, meaning it was very likely a Vercel
  platform-level 502 (e.g. a hard timeout or resource limit) that killed
  the invocation before the route's own JS ever reached its catch block —
  not the kind of in-process unhandled exception this PR's catch-all
  patches. The client's existing manual "Retry" button worked correctly
  once clicked; after retry, both runs completed cleanly with the fix
  intact. Worth its own investigation if it recurs, but out of scope here.
- **The homework question completed cleanly this time** (previously
  Finding 2: hard-halted on `global-assumptions-review`, 8/9 standards
  failing 4 straight attempts). This run passed `global-assumptions-review`
  at 8/9. Single data point in both directions — not evidence the
  content-quality issue is fixed, just that it didn't recur here.
