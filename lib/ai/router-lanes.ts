// Failover-lane composition for the routing engine: which providers, in
// which order, per role. Split out of router.ts (repo's 600-LOC rule) —
// router.ts's execute() only needs attemptsForRole()/Attempt/
// ATTEMPT_TIMEOUT_MS from here; everything about WHY a given order was
// chosen lives in this file, next to the code it explains. See decisions/006
// (model choice), 012 (failover), 013 (multi-provider), and 013's addendum
// (2026-08-10, swarm/synthesis — the reasoning pipeline's own dedicated
// lanes, DeepInfra-led).
//
// Seven lanes, keyed by role. Five are shared across the whole app
// (suggestor, coach|critic, drafter, feedback, console); swarm and synthesis
// belong ONLY to the reasoning pipeline (lib/ai/reasoning/*) — see
// swarmAttempts()/synthesisAttempts() below for why they're separate from
// drafter/critic rather than reusing them.
//
//   SIDEBAR SUGGESTIONS  (suggestor)
//   DeepInfra-first (switched from Cerebras 2026-08-18, Samir's explicit call
//   after Cerebras's account started returning a flat 402 Payment Required —
//   an account-level failure this lane's own fallback never covered, since it
//   only ever chained off a 429, so a 402 broke suggestions outright). Not
//   latency-optimal the way Cerebras's custom hardware was (this file's other
//   DeepInfra targets are extensively documented spending real wall-clock time
//   on hidden reasoning tokens even at low effort), but reliable over fast —
//   Cerebras is out of this lane entirely, not just demoted, since Samir does
//   not want suggestions tied to that account again.
//     1. DeepInfra (TARGETS.deepinfra)    (primary)
//     2. Mistral   ministral-8b-latest    (on DeepInfra failure)
//     3. Groq      qwen3.6-27b            (on Mistral 429)  ── stateful, see below
//     4. Google    gemini-2.5-flash       (while Groq cools / on Groq 429)
//
//   REAL-TIME BACKGROUND  (coach | critic)
//   Latency-sensitive background events fired by user activity.
//     1. DeepInfra gpt-oss-20b            (primary — promoted ahead of Mistral
//                                          2026-09-12, Samir's explicit call: a
//                                          live 'coach' call sat on a stalled
//                                          Mistral connection for 7.9 minutes
//                                          before erroring — see raceTimeout()
//                                          in router.ts for the timeout-
//                                          enforcement bug that let it run
//                                          that long in the first place.
//                                          DeepInfra is paid — no free-tier
//                                          budget to preserve the way
//                                          Mistral's old primary slot here
//                                          did — so this trades free-tier
//                                          headroom for the provider that's
//                                          actually been reliable, same
//                                          reasoning already applied to the
//                                          suggestor lane on 2026-08-18. Added
//                                          to this lane in the first place on
//                                          2026-08-10 (Samir), as a paid relief
//                                          valve: the reasoning pipeline's
//                                          9-parallel review panel (all
//                                          `critic`) plus real-time `coach`
//                                          traffic were exhausting Mistral's
//                                          free tier and spilling onto Groq
//                                          fast enough that even n=2 test runs
//                                          failed roughly half the time — and
//                                          Groq's paid Developer tier wasn't
//                                          available to upgrade to at the
//                                          time. TARGETS.deepinfra
//                                          (router-config.ts) is deliberately
//                                          model-agnostic in its naming — a
//                                          same-day detour through gpt-oss-20b
//                                          and back needed a 4-file rename
//                                          each way, which is why the model
//                                          itself is a one-line change
//                                          (TARGETS.deepinfra's `model`
//                                          default, or DEEPINFRA_MODEL env, no
//                                          code change at all). Swapped to
//                                          gpt-oss-20b again the same day
//                                          (Samir): real review-panel runs
//                                          showed Llama wasn't reliably
//                                          incorporating the panel's
//                                          regeneration feedback. Same model
//                                          id this codebase already runs
//                                          successfully on Groq (see
//                                          draftAttempts() below) and
//                                          Cerebras, and it gets the strict
//                                          json_schema path
//                                          (supportsJsonSchema(),
//                                          router-shared.ts) instead of the
//                                          looser json_object path Llama got —
//                                          not cheaper, this swap is for
//                                          reliability.
//     2. Mistral   ministral-8b-latest    (on DeepInfra 429/failure — this
//                                          lane's original primary since
//                                          decision 013, 2026-07-11; demoted,
//                                          not removed, 2026-09-12 above)
//     3. Groq      qwen3.6-27b            (on Mistral failure)  ── stateful, see below
//     4. Google    gemini-2.5-flash       (while Groq cools / on Groq 429)
//     5. Cerebras  gpt-oss-120b           (multi-throttle bridge, on Google 429)
//
//   ON-DEMAND COMPLEX  (drafter)
//   Heavy framework generation. Leads with Groq (Samir's call, 2026-07-31: no
//   prior-project history of Groq itself failing — a problem here points at
//   this app's setup, not the provider), then falls back to Gemini's large
//   context and Cerebras. Mistral was tried here too and deliberately dropped
//   (2026-07-31): under real drafter traffic it reproducibly returned
//   malformed JSON on this role's more complex structured-output schemas
//   (perspectives' multi-field packets) — wrapping array items in stray
//   objects, or degenerating into repeated whitespace instead of finishing
//   valid JSON — not a rate-limit or token-budget problem, just this model
//   class under-provisioned for what drafter role actually asks of it.
//   Mistral stays primary/fallback in the suggestor and real-time lanes,
//   where the ask is simpler. Gemini stays in the chain (not primary) as the
//   large-context escape hatch: size-aware routing already skips Groq/
//   Cerebras's 128k windows for anything too big, landing on Gemini's ~1M
//   regardless of nominal order.
//
//   Drafter's Groq attempt deliberately pins gpt-oss-20b, NOT the qwen model
//   the other two lanes default to (currentGroqTarget()) — confirmed live
//   (2026-07-31) the very first real run after Groq went primary here:
//   supportsJsonSchema() (router-shared.ts) already documents that Groq's
//   strict json_schema structured output "is only reliable on the gpt-oss
//   family"; qwen gets the looser json_object mode (schema hinted in the
//   prompt, not enforced), and Groq's own API-side validation in that mode
//   400s with json_validate_failed when the model's freeform output doesn't
//   parse. Exactly what hit perspectives-generate-stances immediately. Not a
//   Groq reliability problem — a model-choice bug in what this lane asked
//   Groq for.
//     1. Groq      gpt-oss-20b            (primary — strict json_schema)
//     2. Google    gemini-2.5-flash       (on Groq cooling / 429)
//     3. Cerebras  gpt-oss-120b           (on Google 429)
//
// Groq is special. A Groq 429 is read as an *org-wide* block, so we do NOT
// immediately hop to gpt-oss-20b on the same account. Instead we open a strict
// 30s penalty box: while it is open, real-time traffic skips Groq entirely and
// diverts to Google (then Cerebras). Once the window clears, Groq is allowed
// again but on the safer fallback model gpt-oss-20b until one call succeeds.
// This penalty box is account-level state (router-state.ts), shared by every
// lane below, not lane-scoped.

import { TARGETS, type Target } from './router-config'
import { currentGroqTarget, groqCoolingDown } from './router-state'
import type { AiRole } from './router-shared'

export interface Attempt extends Target {
  // Real-time Groq attempts open the penalty box on a (non-daily) 429 instead of
  // hopping straight to another Groq model.
  penaltyOnRateLimit?: boolean
  // Per-attempt override of ATTEMPT_TIMEOUT_MS[role] (router.ts's execute()
  // reads this if set). Only swarmAttempts()'s DeepInfra entry sets it today
  // — see DEEPINFRA_SWARM_TIMEOUT_MS below.
  timeoutMs?: number
}

// One slow-but-alive target must not eat the whole serverless budget. Each
// role's route has its own maxDuration (most AI routes: 30s; the reasoning
// pipeline's app/api/admin/reasoning/route.ts, serving swarm/synthesis: 280s
// as of 2026-08-12 — see CHAIN_DEADLINE_MS, router.ts, for how these two
// numbers combine per role.
export const ATTEMPT_TIMEOUT_MS: Record<AiRole, number> = {
  // 8s → 20s → 45s (2026-08-18, alongside the Cerebras→DeepInfra swap above).
  // 8s was sized for Cerebras's custom hardware. 20s (matching drafter) was
  // real-verified live still too tight: DeepInfra's own attempt hit a hard
  // "Request timed out" on the very first real Suggest call, logged as
  // neededTokens: 8710 — SUGGEST_BLOCK's fuller ask (2-4 findings, each with
  // an observation/suggestion/Socratic question, findings.ts's schema) is a
  // meaningfully bigger reasoning task than feedback's single-answer shape,
  // which fit fine under 20s. Deliberately generous, same posture as this
  // file's own DEEPINFRA_SWARM_TIMEOUT_MS history (45s → 60s → 200s, each
  // bump real-verified against actual completion time, not guessed) — this
  // is that same first generous bump, to be tuned down once real Suggest
  // traffic shows the actual completion time.
  suggestor: 45_000,
  coach: 8_000,
  critic: 8_000,
  drafter: 20_000,
  swarm: 20_000, // same budget as drafter — real generation/review work, not a quick check
  synthesis: 8_000, // packaging only, same budget as coach
  // Same 20s as drafter, not suggestor's 8s — this lane's primary is DeepInfra
  // gpt-oss-20b (see feedbackAttempts() below), and this file's own header
  // comment already documents that model's hidden-reasoning-token latency
  // as too slow for the 8s budget tuned for Cerebras's custom hardware.
  feedback: 20_000,
  // Sized like suggestor's post-real-verification numbers (45s), not
  // feedback's original 20s — a whole-house prompt (console) is at least as
  // big as suggestor's per-layer-plus-whole-house one, likely bigger, so
  // there's no reason to expect it to fit in feedback's smaller budget and
  // then have to re-learn suggestor's exact lesson live.
  console: 45_000,
}

// DeepInfra-in-swarm-specific widen (2026-08-10, Samir, real-verified live):
// the swarm lane's generic 20s was cutting off DeepInfra gpt-oss-20b calls
// that were NOT actually failing — DeepInfra's own dashboard showed those
// requests completed and billed (tiny amounts, these are small calls), our
// client just stopped waiting first. gpt-oss-20b is a real reasoning model —
// even reasoning_effort:"low" spends genuine wall-clock time on hidden
// "thinking" tokens before the visible JSON, which Llama-3.1-8B (no
// reasoning mode) never had to pay for — so the timeout tuned for Llama's
// flat completion speed is too tight for gpt-oss-20b's latency profile.
// Only DeepInfra gets this — Groq/Gemini/Mistral/Cerebras aren't in this
// lane's chain at all anymore (2026-08-12 pinning, see swarmAttempts()).
//
// 45s → 60s (2026-08-12, Samir, root-causing "the pipeline consistently
// stops on perspectives-generate or global-assumptions" on real Vercel
// Hobby traffic): CORRECTION to the assumption below this constant carried
// until today — the route's maxDuration was NOT actually capped at ~60s by
// the Hobby plan itself; that was this codebase's own self-imposed number.
// CONFIRMED live in the Vercel dashboard: Fluid Compute is enabled on this
// Hobby project, which raises the real ceiling to 300s (Vercel's own
// function-duration docs). The route's maxDuration is now 280s and
// CHAIN_DEADLINE_MS.swarm/.synthesis (router.ts) 260s — DeepInfra is now the
// ONLY attempt in this lane (no fallback since the same session's pinning),
// so its own timeout can safely use most of that shared budget without
// starving anything else. 60s is a modest, real increase over the
// previously-observed ~18s-worst-case single-call latency, not a blind
// blow-up to the new ceiling — a genuinely hung request should still fail
// with reasonably prompt, actionable feedback rather than hanging for
// minutes. Full real-verified diagnosis:
// plans/active/reasoning-pipeline/20-deepinfra-tuning-real-verification.md's
// addendum. Raise further only alongside the route's maxDuration and
// CHAIN_DEADLINE_MS[swarm], kept in lockstep so this never promises more
// than the route can honor.
// TEMP diagnostic bump, 2026-08-13: real local traffic against the new
// DeepSeek-V3 default (router-config.ts) showed EVERY perspectives-generate-
// details call — a 671B-param model, no hidden reasoning channel but a much
// bigger one than gpt-oss-20b's 20B — timing out at the old 60s ceiling,
// every single attempt, not intermittently. 60s was tuned for gpt-oss-20b's
// specific latency profile; this value is deliberately generous (not a
// measured right-size yet) so one real run can show the actual completion
// time before this gets tuned properly. Still self-limiting regardless of
// this number — execute()'s Math.min(attempt.timeoutMs, deadlineAt -
// Date.now()) (router.ts) clamps any single attempt to whatever's left of
// CHAIN_DEADLINE_MS.swarm (260s), so this can't blow the route's budget on
// its own even set this high.
const DEEPINFRA_SWARM_TIMEOUT_MS = 200_000

// Repair/high-reasoning-effort calls (allowHighReasoning, router-shared.ts)
// only, in swarm/synthesis — 2026-08-12, Samir: real traffic showed EVERY
// repair-mode call that reached Groq failed there (413/429 TPM ceiling once
// REPAIR_TOKEN_HEADROOM (lib/ai/reasoning/budget.ts) pushed a single
// request's size past Groq's 8000 TPM cap, or a json_validate_failed on the
// requests just under that line) — not one succeeded across the whole
// session, so swarmAttempts()/synthesisAttempts() skip Groq entirely here,
// and DeepInfra's own attempt gets the time that would have gone to a doomed
// Groq call instead.
//
// 50s → 75s (2026-08-12, same session as DEEPINFRA_SWARM_TIMEOUT_MS's 45→60
// widen above). Repair-mode calls carry REPAIR_TOKEN_HEADROOM (budget.ts) on
// top of their first-pass maxTokens and run at 'high' reasoning effort —
// genuinely slower than a first-pass call by construction, hence the extra
// margin this constant is supposed to carry over its first-pass sibling
// immediately above.
//
// 75s → 240s (2026-08-20, Claude code review during a real pipeline run —
// flagged to Samir, fix applied on request): DEEPINFRA_SWARM_TIMEOUT_MS was
// separately bumped 60s→200s on 2026-08-13 (see that constant's own "TEMP
// diagnostic bump" history above) to survive DeepSeek-V3's per-call latency,
// but this sibling was never revisited alongside it — leaving repair-mode
// calls, which are supposed to carry MORE margin than first-pass ones by the
// reasoning above, capped at 75s while first-pass calls got 200s. That
// inverted the stated intent for months of model swaps (Llama-3.3-70B →
// Qwen3-235B → DeepSeek-V4-Flash-0731, router-config.ts) without anyone
// hitting it in practice, most likely because the swarm/synthesis lane's
// three same-target retries (DEEPINFRA_SAME_TARGET_ATTEMPTS below) plus
// execute()'s own deadlineAt clamp (router.ts) meant a too-short repair
// timeout degraded into "fewer, shorter retries" rather than an outright
// failure. 240s restores real margin over the 200s first-pass sibling (same
// ~20% relative margin the original 60s→75s split used) while staying 20s
// under CHAIN_DEADLINE_MS.swarm/.synthesis's 260s shared budget — the same
// ~20s-headroom convention this file already uses elsewhere (e.g. that 260s
// itself sits 20s under the route's 280s maxDuration). Because
// execute()'s Math.min(attempt.timeoutMs, deadlineAt - Date.now()) clamps
// every attempt to whatever's actually left of that shared 260s budget
// regardless of this constant's nominal value, this change cannot make any
// single call run longer than the route already allows — it only stops
// repair-mode attempts from being cut off earlier than first-pass ones for
// no documented reason.
const DEEPINFRA_SWARM_LARGE_TIMEOUT_MS = 240_000

// Real-time background lane (coach | critic): DeepInfra primary (promoted
// ahead of Mistral 2026-09-12 — see header comment above for why), Mistral
// as fallback, then the Groq penalty-aware bridge to Google / Cerebras.
function realtimeAttempts(): Attempt[] {
  const attempts: Attempt[] = [{ ...TARGETS.deepinfra }, { ...TARGETS.mistral8b }]
  if (groqCoolingDown()) {
    // Shock absorber: Groq penalty is open — skip it entirely.
    attempts.push({ ...TARGETS.geminiFlash })
    attempts.push({ ...TARGETS.cerebrasGptOss120b })
  } else {
    attempts.push({ ...currentGroqTarget(), penaltyOnRateLimit: true })
    // On a Groq 429 we do not chain to another Groq model; we bridge to Google
    // then Cerebras while the freshly-opened penalty box holds.
    attempts.push({ ...TARGETS.geminiFlash })
    attempts.push({ ...TARGETS.cerebrasGptOss120b })
  }
  return attempts
}

// Sidebar suggestions ride a DeepInfra-first lane (see header comment above
// for why Cerebras was pulled out of this lane entirely, 2026-08-18). On a
// DeepInfra failure it falls onto the standard real-time resilience tail
// (Mistral → Groq → Google), sharing the same Groq penalty box.
function suggestorAttempts(): Attempt[] {
  const attempts: Attempt[] = [{ ...TARGETS.deepinfra }, { ...TARGETS.mistral8b }]
  if (groqCoolingDown()) {
    attempts.push({ ...TARGETS.geminiFlash })
  } else {
    attempts.push({ ...currentGroqTarget(), penaltyOnRateLimit: true })
    attempts.push({ ...TARGETS.geminiFlash })
  }
  return attempts
}

// On-demand complex generation (drafter): Groq leads (Samir's call, see the
// header comment above), sharing the same Groq penalty box as the other two
// lanes — while it's open, drafter traffic skips Groq entirely and leads
// with Gemini instead, same as realtimeAttempts()/suggestorAttempts().
// Pins gpt-oss-20b specifically (NOT currentGroqTarget()'s qwen default) —
// see the header comment above for why. Mistral deliberately excluded, also
// see the header comment above.
function draftAttempts(): Attempt[] {
  if (groqCoolingDown()) {
    return [{ ...TARGETS.geminiFlash }, { ...TARGETS.cerebrasGptOss120b }]
  }
  return [
    { ...TARGETS.groqGptOss20b, penaltyOnRateLimit: true },
    { ...TARGETS.geminiFlash },
    { ...TARGETS.cerebrasGptOss120b },
  ]
}

// Post-draft Q&A/correction thread (feedback role, 2026-08-18) — leads with
// DeepInfra, then falls back to draftAttempts()'s own tail (Groq → Gemini →
// Cerebras). Two reasons for DeepInfra-first here specifically, not just
// reusing suggestorAttempts() or drafter's Groq-first order:
//   (a) Real-verified live (2026-08-18): Cerebras returned a flat 402
//       (Payment Required — account-level, not a rate limit) that broke
//       suggestorAttempts() outright, because that lane only fails over on a
//       429 (see its own comment above). The exact same 402 hit this lane's
//       first real test.
//   (b) DeepInfra is a paid account with no hard per-request rate ceiling
//       (same rationale as swarmAttempts()/synthesisAttempts() above) — a
//       better fit than Cerebras/Groq's free/on-demand tiers for a
//       user-triggered, unpredictably-timed call like this one.
// draftAttempts() (not a fresh Mistral-inclusive tail) because this role's
// schema — an answer plus an AiAction[] batch, findings.ts's same
// discriminated union drafter uses — is exactly the "more complex
// structured-output schema" class the header comment already documents
// Mistral reproducibly mangling under drafter traffic; no reason to expect
// better here. Not DeepInfra-only like swarm/synthesis: those lanes are
// deliberately single-provider for a clean A/B read on heavy, repeated
// pipeline traffic (see that comment) — this is a light, one-shot call with
// no such measurement goal, so keeping a real fallback tail (rather than
// failing outright on a DeepInfra hiccup, the same failure mode this lane
// exists to avoid) is the safer default.
function feedbackAttempts(): Attempt[] {
  return [{ ...TARGETS.deepinfra }, ...draftAttempts()]
}

// Post-pipeline console (console role, 2026-08-19) — same DeepInfra-first
// shape and same rationale as feedbackAttempts() immediately above (whole-
// house AiAction vocabulary, structurally the same complexity class as
// drafter's schemas, no A/B-measurement reason to go DeepInfra-only). Kept
// as its own function rather than literally reusing feedbackAttempts()
// because the two roles' ATTEMPT_TIMEOUT_MS/CHAIN_DEADLINE_MS already
// diverge (this one sized like suggestor's, not feedback's smaller budget —
// see ATTEMPT_TIMEOUT_MS's own comment) and giving them independent
// functions keeps that divergence easy to see and to tune further without
// the two roles' comments needing to stay in sync by hand.
function consoleAttempts(): Attempt[] {
  return [{ ...TARGETS.deepinfra }, ...draftAttempts()]
}

// Reasoning-pipeline-only lane (lib/ai/reasoning/*, decision 019 addendum,
// 2026-08-10): every generate/review call in the pipeline EXCEPT final
// composition (see synthesisAttempts() below). Not used anywhere else in the
// app — the rest of the app keeps suggestor/coach/critic/drafter untouched.
//
// DELIBERATE, TEMPORARY, DeepInfra-only — no fallback (2026-08-12, Samir,
// verbatim: "it should always be using deep infra (no matter what for
// now)"). Groq/Gemini/Mistral/Cerebras removed from this lane entirely, not
// just reordered. Two reasons, both Samir's:
//   (a) A clean read on DeepInfra's real success rate on THIS traffic (9
//       parallel review-panel calls per gate × 6 gates, plus every generate
//       step) without another provider's failures confounding the signal —
//       decision 020's ~85% (59/10) OK/FAIL figure was measured on the
//       realtime lane, not this one, and doc 20's fix #3 already found Groq
//       structurally can't serve this lane's repair-mode calls at all.
//   (b) DeepInfra is a paid account with no hard per-request rate ceiling
//       the way Groq's on-demand tier has (the exact thing that made fix #3
//       necessary) — most of what a fallback chain exists to protect
//       against (a free-tier 429/cooldown) doesn't apply here by
//       construction, so the chain was buying less than it looks like for
//       this specific lane.
// This is a KNOWN, INTENTIONAL reduction in resilience, not an oversight: a
// genuine DeepInfra outage now fails every swarm call outright instead of
// failing over to Gemini/Mistral/Cerebras. Revisit once real DeepInfra-only
// traffic answers (a) — this is a posture for now, not a permanent
// architecture decision. suggestor/coach/critic/drafter are untouched; this
// scoping is swarm/synthesis only, same as everything else in this lane.
// NOT "one shot at DeepInfra, then fail" though — see
// DEEPINFRA_SAME_TARGET_ATTEMPTS below: real production traffic showed
// DeepInfra's own failures here are intermittent, so the lane retries the
// SAME target a few times before giving up. Zero other providers involved —
// still fully within "no matter what."
//
// isGroqTokenLimitExceeded()/isGroqJsonValidateFailed()/groqCoolingDown()
// (router-shared.ts / router-state.ts) are now unused BY THIS LANE
// specifically — left alone, the other four lanes above still call them.
//
// DeepInfra's own attempt timeout keeps the first-pass/repair-mode split —
// DEEPINFRA_SWARM_TIMEOUT_MS / DEEPINFRA_SWARM_LARGE_TIMEOUT_MS above — that
// distinction is about gpt-oss-20b's own latency profile under
// allowHighReasoning, orthogonal to which (or how many) providers are in the
// chain, so it survives this change untouched.
//
// Listed DEEPINFRA_SAME_TARGET_ATTEMPTS times, not once (2026-08-12, Samir,
// real-verified in production the same day): a real n=2 run against
// houses-of-thought.vercel.app failed repeatedly at perspectives-generate/
// global-assumptions, both `ai-empty-output` (finishReason "stop", zero
// content) and plain SDK-level timeouts at the full DEEPINFRA_SWARM_TIMEOUT_MS
// window — on ordinary first-pass/medium-effort calls, not just repair-mode.
// Checked DeepInfra's own dashboard for that exact window: the requests were
// RECEIVED and BILLED, no rate-limit flagged on the account. That rules out a
// network/transit failure or a 429 — this is gpt-oss-20b's own reasoning-
// token behavior (the same mechanism doc 20's fix #1 already named)
// occasionally either running past the timeout or finishing with nothing in
// the visible-answer channel, and it's INTERMITTENT — 3 real attempts on one
// step that session: 2 failed, 1 succeeded outright, no code changed between
// them. `execute()` (router.ts) already cascades through a role's attempt
// list on exactly these error classes (timeout, ai-empty-output, 5xx) — no
// new mechanism needed, just more attempts at the SAME target, so a
// transient failure gets another real shot at DeepInfra specifically before
// the step actually fails. Still zero other providers in this lane — Samir's
// "no matter what" instruction stands; this is a retry, not a fallback.
// `execute()`'s own shared CHAIN_DEADLINE_MS/deadlineAt check already caps
// how many of these attempts actually get tried if time runs out, so this
// can't blow the route's budget even in the worst case (3 × 75s repair-mode
// = 225s, still under CHAIN_DEADLINE_MS.swarm's 260s with real margin). Full
// diagnosis: plans/active/reasoning-pipeline/20-deepinfra-tuning-real-verification.md's
// addendum.
const DEEPINFRA_SAME_TARGET_ATTEMPTS = 3

function swarmAttempts(allowHighReasoning: boolean): Attempt[] {
  const timeoutMs = allowHighReasoning ? DEEPINFRA_SWARM_LARGE_TIMEOUT_MS : DEEPINFRA_SWARM_TIMEOUT_MS
  return Array.from({ length: DEEPINFRA_SAME_TARGET_ATTEMPTS }, () => ({ ...TARGETS.deepinfra, timeoutMs }))
}

// Reasoning-pipeline-only lane, final-composition step ONLY (runFinalComposition,
// orchestrator-global.ts) — packaging the vetted reasoning into the answer the
// admin actually reads, not another reasoning stage.
//
// DELIBERATE, TEMPORARY, DeepInfra-only — same posture and same reasoning as
// swarmAttempts() immediately above (Samir, 2026-08-12); see that comment for
// the full rationale. Groq no longer leads here (it used to, pinned to
// gpt-oss-20b) and Gemini/Mistral/Cerebras no longer close out the chain —
// removed, not reordered. No call site sets allowHighReasoning for this role
// today (runFinalComposition has no repair path — packaging only), but the
// switch is threaded through anyway for consistency if that ever changes, and
// it now ALSO applies DEEPINFRA_SWARM_TIMEOUT_MS to the first-pass case
// (previously only the repair-mode branch got a DeepInfra-specific timeout
// here — the plain first-pass attempt fell through to
// ATTEMPT_TIMEOUT_MS.synthesis's 8s, sized for Groq's speed, not gpt-oss-20b's
// hidden-reasoning-token latency on DeepInfra. Harmless while DeepInfra was
// only ever synthesis's fallback; live-broken now that it is the only
// attempt — real-verified during this change, see doc 20's addendum).
//
// Listed DEEPINFRA_SAME_TARGET_ATTEMPTS times, same reasoning and same day as
// swarmAttempts() above — see that comment for the full real-verified
// diagnosis (received + billed + no rate limit on DeepInfra's own dashboard,
// intermittent model-behavior failures, not a network/infra problem).
function synthesisAttempts(allowHighReasoning: boolean): Attempt[] {
  const timeoutMs = allowHighReasoning ? DEEPINFRA_SWARM_LARGE_TIMEOUT_MS : DEEPINFRA_SWARM_TIMEOUT_MS
  return Array.from({ length: DEEPINFRA_SAME_TARGET_ATTEMPTS }, () => ({ ...TARGETS.deepinfra, timeoutMs }))
}

// Built fresh per request so it reflects current penalty-box / recovery state.
// allowHighReasoning only changes anything for swarm/synthesis (see
// DEEPINFRA_SWARM_LARGE_TIMEOUT_MS above) — every other role ignores it.
export function attemptsForRole(role: AiRole, allowHighReasoning = false): Attempt[] {
  if (role === 'drafter') return draftAttempts()
  if (role === 'suggestor') return suggestorAttempts()
  if (role === 'feedback') return feedbackAttempts()
  if (role === 'console') return consoleAttempts()
  if (role === 'swarm') return swarmAttempts(allowHighReasoning)
  if (role === 'synthesis') return synthesisAttempts(allowHighReasoning)
  return realtimeAttempts() // coach | critic
}
