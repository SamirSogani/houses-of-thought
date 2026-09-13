# Concurrency — 9 simultaneous local-dev runs, 3-tier model system, 2026-09-13

See [README.md](README.md) for the 🟢/📋/⏳ legend and
[concurrency.md](concurrency.md) for the two earlier 2026-08-14 production
tests (single-model, pre/post the persistence-race fix). This test is 🟢,
first-hand, but **incomplete** — see "What this test could NOT determine"
below before drawing conclusions from it.

## Setup

9 concurrent real (non-dry-run) pipeline runs, launched via 9 separate
Sonnet-5 subagents (Samir: "set 9 different houses off at once via nine
separate subagents"), each in its own dedicated browser tab, against
**local dev** (`http://localhost:3000`, not production). All 9 started
within about a minute of each other (06:18:06–06:18:49 PDT), genuinely
concurrent for their full observed lifetime — unlike the 2026-08-14 tests'
sequential ~90s launch. Model config under test: this session's full 3-tier
system — draft `Qwen/Qwen3-235B-A22B-Instruct-2507`, large
`Qwen/Qwen3.8-2.4T-A95B`, critic `deepseek-ai/DeepSeek-V3` — with the
blanket `maxTokens: 8000` bump (deepinfra-model-history.md #11), the same
config real-verified clean in 4 consecutive solo runs immediately before
this test.

9 distinct questions, one per house, all business/solo-founder-framed
(Founder Mode). Every clarification pause was skipped (not answered) for
comparability with the solo runs.

## What this test could NOT determine

**None of the 9 houses reached a confirmed final state (done or
permanently halted).** Around 35-40 minutes in, the orchestrating session
hit an unrelated Claude usage rate limit, pausing all 7 still-active
subagents for a real-world gap of **~4h15-25m**. During that gap the shared
local dev server **auto-terminated** ("stopped by the app" after running
3h18m) and every browser tab was lost — killing all 9 in-flight pipeline
executions server-side and erasing the only client capable of observing
them. This is an environment/tooling artifact, not a pipeline defect, and
it means every result below is a **last-observed-state snapshot before
teardown**, not a completion verdict. A separate, unrelated hiccup: the
Browser pane's 9-tab cap (same cap the 2026-08-14 test also hit) was
exhausted by the orchestrator's own scratch tab, blocking house 9 from
starting until that tab was closed — delaying house 9's start by ~14
minutes relative to the other 8, so its timing isn't directly comparable.

A clean re-run, with the session's own rate limit reset first and the dev
server confirmed stable for the full duration, is needed for a real
completion/failure table like the 2026-08-14 ones. What follows is what
*was* observed, which is still meaningful signal on its own.

## Results as last observed (0 of 9 confirmed complete)

| # | Question (short) | Frame-review | Perspectives-review at cutoff |
|---|---|---|---|
| 1 | Interior design, hourly→flat-fee | 3 fails → passed (4th attempt) | still retrying, ≥1 fail seen |
| 2 | Solo SaaS, pre-seed vs. bootstrap | 3 fails → passed (4th attempt) | still retrying, ≥2 fails seen |
| 3 | Hardware store, e-commerce | **4 fails, never passed** in 22min observed | not reached |
| 4 | Marketing agency, vertical | partial retry (5/9 recovered), then **no further retries logged for 8+ min** | not reached |
| 5 | Photographer, retainer pricing | 3 fails → passed (~22min to clear) | still retrying, not passed |
| 6 | Meal-prep delivery, expand vs. vary | 3 fails → passed (4th, ~18-19min) | 2 fails, still retrying |
| 7 | Fitness studio, instructor vs. price | 3 fails → passed (4th, fast: 71s) | 2 fails, never recovered before cutoff |
| 8 | Bookkeeper, hire vs. stay solo | 1 fail → passed (2nd attempt — fastest recovery of the 9) | 2 fails, 3rd in flight at cutoff |
| 9 | Woodworking, marketplace vs. D2C | passed (delayed start, ~14min late) | reached this step; last logged request was another 502 |

Every house that reached frame-review hit **at least one** hard failure
there before passing (except #3, which never passed). Of the 7 houses that
got far enough to reach perspectives-review, **zero** cleared it before
being cut off — all were mid-retry.

## Finding 1 — a real, reproducible degradation at both review-panel gates

Every single failure, across all 9 houses and both gates reached
(frame-review, perspectives-review), shared one signature:

```
POST /api/houses/<id>/reasoning 502 in 4.3min (application-code: 4.3min)
```
UI: `"Upstream provider rate-limited — retrying in 5s…"` → `…15s…` →
`…30s…` → `…60s…` (escalating backoff). Server-side root cause, quoted
verbatim from several houses' logs:
```
{"level":"error","scope":"ai/router","msg":"upstream call failed","provider":"deepinfra","model":"deepseek-ai/DeepSeek-V3","schemaName":"standard_verdict","maxTokens":8000,"neededTokens":~12900-13200,"detail":"Request timed out.   "}
```
Two things stand out:
- **The ~4.3-4.4 minute mark recurred with striking consistency** across
  dozens of independent failures spanning all 9 houses — far too tight a
  clustering to be coincidental "DeepInfra is just slow." This smells like
  a fixed timeout constant somewhere in the stack, not yet identified
  (it's neither `DEEPINFRA_SWARM_TIMEOUT_MS` (200s) nor that plus
  `raceTimeout`'s grace (203s) — worth tracing precisely).
- **`neededTokens` is now ~12,900-13,200** — roughly 60% over the current
  8,000 cap, and nearly double the ~7,400-7,447 seen in the single-house
  near-miss that originally justified the 8,000 bump (see
  deepinfra-model-history.md #11). If this number scales with concurrent
  load rather than being fixed per-schema, the 8,000 blanket bump may not
  be sufficient headroom under real concurrent traffic even though it
  fully resolved every failure in 4 consecutive solo runs.

Both gates that were exercised (frame-review, perspectives-review) route
through the **critic tier** (`deepseek-ai/DeepSeek-V3`, all 6 review-panel
gates, `orchestrator-panel.ts`). No house got far enough to exercise the
**large** tier (`Qwen/Qwen3.8-2.4T-A95B`, global-assumptions-generate,
perspectives-generation) under this load — that tier's concurrent-load
behavior is still unknown.

## Finding 2 — one house (#4) showed a worse pattern than "just slow"

House 4's frame-review had a partial retry recover 5 of 9 standards, then
the remaining 4 simply **stopped being retried at all for 8+ minutes**,
even though the shared DeepInfra upstream was demonstrably still being hit
by the other 8 houses' requests in that same window (visible in the shared
log stream). This is a stall, not a slowdown — consistent with
`DEEPINFRA_SAME_TARGET_ATTEMPTS = 3` (router.ts) being exhausted for that
specific call with nowhere left to fail over to (swarm/synthesis is
DeepInfra-only, decision 020) — a step that would sit there until an
operator manually intervenes, not one that would eventually recover on its
own the way the other 8 houses' retries did.

## Finding 3 — draft tier and content quality held up fine

Every house's breadth-scoping and evidence-gathering steps (draft tier,
`Qwen/Qwen3-235B-A22B-Instruct-2507`) ran clean and fast throughout, zero
errors, even while the critic tier next to them was failing repeatedly.
Everything that *was* generated under load (frames, perspective labels,
clarification question sets) was coherent, on-topic, and specific to each
house's actual question — no hallucination or genericness observed in any
of the 9 partial results.

## Comparison to the 2026-08-14 production tests

Those two tests (pre/post persistence fix, [concurrency.md](concurrency.md))
ran a different model (Qwen3-235B doing everything, no tiering) against
production/Vercel, not local dev, and both eventually reached 9/9 completions
(the pre-fix test's failures were silent-persistence losses, not pipeline
halts). The post-fix retest *did* see "a real 502 mid-run" on 2 of 9 runs
under load — the same failure shape seen here, just far less frequent (2/9
once each, vs. every house here hitting it repeatedly at two separate
gates). Whether that gap is tiering-specific (critic tier now concentrates
all review-panel traffic onto one DeepInfra model instead of spreading it
in whatever pattern the old single-model setup had), local-dev vs.
production infrastructure, or just this test's shorter timeout ceiling
being hit before an eventual success (as it was in nearly every house here)
can't be determined from one test.

## Fix shipped same day — a concurrency limiter, not a bigger timeout

Samir's diagnosis: this isn't DeepInfra formally rejecting requests (no
failure anywhere in the 9 reports carried a real HTTP status — every one
logged `status:"unknown"`, i.e. a client-side timeout, `raceTimeout()`,
never a provider-issued 429). It's DeepInfra genuinely taking too long to
respond once really saturated — up to 81 simultaneous critic-tier requests
(9 houses × 9 parallel reviewer calls) hitting one account at a gate
boundary. Fix: [`router-concurrency.ts`](../../../../lib/ai/router-concurrency.ts)
— a FIFO queue capping in-flight DeepInfra requests (all three tiers share
one account, so one shared ceiling) at `DEEPINFRA_MAX_CONCURRENT` (default
20, env-overridable). Excess calls wait for a slot instead of all firing at
once and timing out together; queue wait time doesn't eat into a request's
own `raceTimeout` budget, since that timer only starts once a slot is
actually acquired.

Deliberately in-process (a module-level counter), not a distributed/Redis
limiter — Samir confirmed Vercel Fluid Compute is enabled on this project,
which lets concurrent requests share one warm instance's memory, making an
in-process limiter meaningful in production too, not just in `next dev`'s
single persistent process (which is what this actual test ran against). See
that file's header for the full reasoning and the fallback plan if that
assumption stops holding.

Verified: `tsc`/`vitest` (1456/1456, incl. new unit tests for the limiter's
own queuing semantics and the router wiring)/`next build`, all clean. **Not
yet real-verified with another live concurrent run** — see Next steps.

## Next steps (not yet actioned)

- Re-run the 9-way test cleanly (no rate-limit interruption) to confirm the
  queue actually holds up under real concurrent load and to get real
  completion/failure numbers instead of snapshots.
- The ~4.3-4.4 minute timeout ceiling's exact source is still untraced —
  worth knowing precisely even though the queue should mean fewer calls
  ever get slow enough to hit it.
- Get real concurrent-load data on the large tier (untested here, no house
  reached it) and confirm whether `maxTokens: 8000` holds up there too.
- `DEEPINFRA_MAX_CONCURRENT`'s default of 20 is a starting guess (matching
  Samir's own suggestion), not measured against DeepInfra's actual
  throughput — may need tuning once real data exists.
