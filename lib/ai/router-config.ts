// Provider/target configuration + client construction for the routing engine.
// Split from router.ts (600-LOC rule). Each provider contributes only a base
// URL. A routing *target* pairs a model with the exact env var holding that
// model's key — the .env vars are named after the specific keys they carry, so
// every model authenticates with its own key (Groq's two models therefore use
// two distinct keys on the same base URL). Base URLs, model IDs, and key
// env-var names are all overridable via env (.env.example documents the matrix;
// docs/operations/model-sunset-runbook.md is the playbook).

import OpenAI from 'openai'
import { log } from '@/lib/log'

// Fail loudly if this module is ever pulled into a client bundle — the API keys
// must never ship to the browser.
if (typeof window !== 'undefined') {
  throw new Error('lib/ai/router-config.ts is server-only and must not run in the browser')
}

export type ProviderId = 'mistral' | 'deepinfra' | 'groq' | 'google' | 'cerebras' | 'openrouter'

const BASE_URLS: Record<ProviderId, string> = {
  mistral: process.env.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
  // Paid, self-serve, OpenAI-compatible — added as a cheap relief valve on the
  // realtime lane (router.ts realtimeAttempts()) after free-tier Mistral/Groq
  // couldn't sustain even n=2 reasoning-pipeline test runs (Samir, 2026-08-10).
  deepinfra: process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai',
  groq: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
  google:
    process.env.GEMINI_BASE_URL ??
    'https://generativelanguage.googleapis.com/v1beta/openai/',
  cerebras: process.env.CEREBRAS_BASE_URL ?? 'https://api.cerebras.ai/v1',
  openrouter: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
}

// A concrete place to send a request: which provider, which model, the env var
// holding that model's key, and its context window (tokens). The window drives
// size-aware routing: a request whose estimated input exceeds a target's window
// skips it, so large context automatically lands on the 1M-token Gemini target.
export interface Target {
  provider: ProviderId
  model: string
  keyEnv: string
  contextWindow: number
}

// Env-overridable per-target context windows. Conservative defaults; Gemini is the
// deliberate large-context escape hatch (~1M tokens).
const CTX = {
  mistral8b: Number(process.env.MISTRAL_CONTEXT ?? 128_000),
  // 128K matches DeepSeek-V3's real ceiling (see TARGETS.deepinfra below) —
  // slightly under gpt-oss-20b's 131,072 and Llama-3.1-8B-Instruct's, the two
  // earlier models this target ran; kept at the tightest of the three so
  // size-aware routing never assumes headroom the active model doesn't have.
  // Llama-3.3-70B-Instruct-Turbo (2026-08-13 swap, see TARGETS.deepinfra) is
  // ALSO 131,072 (confirmed on its DeepInfra model/API-reference pages) — same
  // as gpt-oss-20b, still above DeepSeek-V3's 128,000. 128K therefore remains
  // the tightest ceiling across every model this target has ever run, so no
  // change was needed here — kept at 128_000 for the same reason as before.
  // Qwen/Qwen3-235B-A22B-Instruct-2507 (2026-08-13, same session, swapped in
  // after Llama-3.3-70B failed real verification — see TARGETS.deepinfra) is
  // 262,144 natively (confirmed directly on
  // deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507) — more than double any
  // prior model's window on this target. 128K therefore remains the tightest
  // ceiling across all four models this target has now run; still no change
  // needed, still kept at 128_000 for the same conservative reason as before.
  // deepseek-ai/DeepSeek-V4-Flash-0731 (2026-08-14, Samir's call — see
  // TARGETS.deepinfra's own comment for the full swap rationale and the
  // reasoning-channel risk flag) is 1,048,576 natively (confirmed live on
  // deepinfra.com/deepseek-ai/DeepSeek-V4-Flash-0731) — by far the largest
  // window this target has run. 128K remains the tightest ceiling across all
  // five models this target has now run; still no change needed here.
  // Qwen/Qwen3.8-2.4T-A95B (2026-09-12, current default, see
  // TARGETS.deepinfra's own comment) is 262,144 natively — same figure as
  // Qwen3-235B above, not smaller — so 128K remains the tightest ceiling
  // across all six models this target has now run; still no change needed.
  deepinfra: Number(process.env.DEEPINFRA_CONTEXT ?? 128_000),
  groq: Number(process.env.GROQ_CONTEXT ?? 128_000),
  gemini: Number(process.env.GEMINI_CONTEXT ?? 1_000_000),
  cerebras: Number(process.env.CEREBRAS_CONTEXT ?? 128_000),
  openrouter: Number(process.env.OPENROUTER_CONTEXT ?? 128_000),
}

export const TARGETS = {
  mistral8b: {
    provider: 'mistral',
    model: process.env.MISTRAL_MODEL ?? 'ministral-8b-latest',
    keyEnv: process.env.MISTRAL_KEY_ENV ?? 'MISTRAL_MINISTRAL_8B_API_KEY',
    contextWindow: CTX.mistral8b,
  },
  // Paid provider used across the realtime lane (relief valve) and the
  // reasoning pipeline's swarm/synthesis lanes — see router-lanes.ts.
  //
  // Key name and TARGETS key are deliberately model-agnostic ('deepinfra',
  // not e.g. 'deepinfraLlama8b'/'deepinfraGptOss20b') — 2026-08-10, Samir's
  // call, after the model got swapped once already and had to be renamed
  // across 4 files each time. Switching models now should be exactly ONE
  // line: the `model` default below (or set DEEPINFRA_MODEL in env, no code
  // change at all). There is only one DeepInfra target, so unlike Groq's two
  // models there is no need for a second key — DEEP_INFRA_API_KEY covers
  // whichever model is active. (Underscore between DEEP and INFRA — matches
  // how the real key was actually named in .env, 2026-08-10; every other
  // DeepInfra override var below stays DEEPINFRA_* with no underscore, since
  // only the literal secret name needed to match what's really configured.)
  //
  // Active default: 'Qwen/Qwen3-235B-A22B-Instruct-2507' — used directly
  // here for coach/critic/suggestor/feedback/console, AND as the reasoning
  // pipeline's swarm/synthesis DEFAULT ("draft" tier, router-lanes.ts's
  // swarmAttempts()/synthesisAttempts()) for every pipeline step except the
  // two below.
  //
  // Per-step tiering added 2026-09-12 (Samir's call, own research — not
  // this codebase's usual real-verification-first discipline, so treat
  // "confirmed live" as still outstanding on TARGETS.deepinfraLarge below;
  // TARGETS.deepinfraCritic's own model choice WAS then real-verified,
  // same day — see that target's own comment for the Qwen3.8-27B failure
  // and the DeepSeek-V3 replacement):
  // TARGETS.deepinfraLarge (Qwen3.8-2.4T-A95B) for perspectives-generate-
  // stances/-details and global-assumptions-generate ONLY, TARGETS.
  // deepinfraCritic (deepseek-ai/DeepSeek-V3) for every review-panel/
  // master-review call — see those two targets' own comments above and
  // swarmAttempts()'s `tier` param (router-lanes.ts) for the actual
  // dispatch mechanism. Two reasons Samir gave for the larger (2.4T) model
  // specifically: (1) meaningfully better strict `json_schema` handling on
  // DeepInfra than Qwen3-235B, despite Qwen3.8-2.4T not being on
  // docs.deepinfra.com/chat/structured-outputs' explicit list the way
  // Qwen3-235B and DeepSeek-V3 both are (see supportsJsonSchema() below —
  // the 2.4T grant is the one deliberate break from this file's own
  // badge-is-not-enough precedent); (2) it exposes its reasoning trace via
  // `stream: true` rather than mixing it into `content` — this codebase
  // doesn't stream (callProvider, router.ts, awaits one ChatCompletion), so
  // that only matters if a non-streamed call also keeps reasoning out of
  // `content` on its own, unconfirmed here. (The critic tier's own model
  // choice is unrelated to either reason — see TARGETS.deepinfraCritic's
  // own comment above for why DeepSeek-V3 is there instead.)
  //
  // This same slot briefly held 'Qwen/Qwen3.8-2.4T-A95B' as the SHARED
  // default for every role (not just the two steps above) for a few hours
  // this same session, before Samir corrected that to the narrower, tiered
  // scope actually described here — worth knowing if this history reads as
  // churn, because it was: both changes landed the same day.
  //
  // ── deepseek-ai/DeepSeek-V4-Flash-0731 (kept here for history, was active
  // default 2026-08-14, production-rolled-back 2026-08-15, hardcoded
  // default finally replaced 2026-09-12) — swapped from Qwen3-235B-A22B-
  // Instruct-2507 — NOT because Qwen failed real verification like the
  // models before it did; the 2026-08-13 swap-in run passed 22/22 real
  // calls. This swap was exploratory: DeepSeek released V4-Flash the same
  // week (284B total / 13B active MoE, 1M-token context, tuned for
  // "agentic" workloads) and Samir wanted it real-verified on this lane
  // before deciding between it and Qwen.
  //
  // Confirmed live before this swap, same discipline as every prior one:
  // fetched https://deepinfra.com/deepseek-ai/DeepSeek-V4-Flash-0731 directly
  // — resolves to a real model page, not a 404. The undated
  // 'deepseek-ai/DeepSeek-V4-Flash' id also resolves, but per DeepInfra's own
  // page copy that one is the SUPERSEDED preview checkpoint; '-0731' is the
  // official release (substantially more agentic-capability post-training,
  // same architecture/context/pricing) — same reasoning as pinning Llama's
  // '-Turbo' suffix below: prefer the exact, current, non-generic id.
  // Confirmed 1,048,576-token context (CTX.deepinfra above — still far under
  // the existing 128K default, no change needed) and pricing ~$0.08/1M input,
  // ~$0.18/1M output (standard tier) — meaningfully cheaper per-token than
  // Qwen3-235B was, though cost was not the reason for this swap.
  //
  // supportsJsonSchema() (router-shared.ts) deliberately NOT extended for
  // this model, same discipline as Llama-3.3-70B and Qwen3-235B above:
  // DeepInfra's model page shows "Supports" badges for JSON and function
  // calling, but this session already twice confirmed that badge is NOT a
  // reliable signal of real constrained-decoding support (Llama had the
  // identical badge and still failed; Qwen's strict-mode status also stayed
  // genuinely unconfirmed). docs.deepinfra.com/chat/structured-outputs,
  // re-checked for this swap, still names only DeepSeek-V3 explicitly — not
  // V4-Flash. This model therefore also runs on the json_object fallback
  // path, backed by the same JSON_SHAPE_GUARDRAIL + stripMarkdownFence
  // (router.ts) net every unconfirmed model on this target gets.
  //
  // Never had an incident that specifically retired IT — production simply
  // rolled back to Qwen3-235B the next day (below) on a stronger-evidence
  // basis (see that history entry), and the hardcoded default here didn't
  // catch up until 2026-09-12, a month later, as an unrelated side effect
  // of the tiering work above. Its own known risk and real-verification
  // results, preserved for history:
  //
  // ⚠ KNOWN RISK, flagged before real-verification rather than discovered by
  // it: unlike DeepSeek-V3 and Qwen3-235B — both explicitly chosen FOR having
  // no hidden reasoning channel, to structurally rule out gpt-oss-20b's
  // empty-output failure class — DeepSeek-V4-Flash-0731's own page documents
  // a `reasoning_effort` parameter (low/high/max) and a `reasoning_content`
  // field. That means it DOES have a hidden reasoning phase, the same shape
  // of mechanism that caused gpt-oss-20b's 5-consecutive-real-failure
  // incident that started this entire multi-model saga.
  //
  // Real-verified (2026-08-14, one full real run, local dev against a live
  // DeepInfra key — not yet exercised on deployed Vercel traffic): all 22
  // pipeline steps completed, zero regenerations, zero ai-empty-output, zero
  // ai-invalid-output — including at perspectives-generate-details and
  // perspectives-evidence-strategy specifically, the two steps a prior real
  // production run failed on under Qwen3-235B. Frame 9/9, both Perspectives
  // bundles 9/9, Global Assumptions 9/9, Global Evidence 8/9 (one tolerated
  // standard, still overall_pass), Conclusions 9/9, Implications 9/9 — every
  // gate passed first try. ~4m6s total real AI-call time summed across all
  // 22 steps (individual calls ranged ~2s-45s), noticeably faster than
  // DeepSeek-V3's 8+ minutes for the Perspectives layer alone. The hidden-
  // reasoning-channel risk above did NOT materialize this run — one clean
  // run is not proof it never will (gpt-oss-20b's own failure was
  // intermittent, not every-call). Real production traffic later found a
  // 33% permanent-failure rate under 9-way concurrency (see
  // plans/active/reasoning-pipeline/model-evaluation/), which is exactly the
  // "one clean run is not proof" case this comment already warned about —
  // production was rolled back to Qwen3-235B 2026-08-15 (env var only, no
  // code change; this hardcoded default drifted from production as a result
  // until this 2026-09-12 swap).
  //
  // ── Qwen/Qwen3-235B-A22B-Instruct-2507 (kept here for history) — swapped from
  // 'meta-llama/Llama-3.3-70B-Instruct-Turbo' (2026-08-13, same live
  // debugging session as the Llama swap directly below, later the same
  // evening once Llama's real-verification results came back). Llama's
  // failure was NOT a capability problem: DeepInfra doesn't confirm strict
  // json_schema support for Llama-3.3-70B (see the supportsJsonSchema()
  // decision in the Llama section below), so it ran on the json_object
  // fallback path, and on 4/4 real attempts the model wrapped its JSON output
  // in a markdown code fence (```json ... ```) that the app's own JSON.parse
  // choked on ("response was not valid JSON") — the content INSIDE the fence
  // was fine every time. Pure formatting failure, not a quality or capability
  // one. Full history in the Llama-3.3-70B-Instruct-Turbo section below.
  //
  // Qwen3-235B-A22B-Instruct-2507 is the next thing to try, on two
  // independent grounds:
  //   1. MoE, 235B total / 22B active — smaller and cheaper than DeepSeek-V3's
  //      671B, so it should land somewhere between DeepSeek-V3's proven
  //      quality and Llama-3.3-70B's proven (if ultimately fence-broken)
  //      speed.
  //   2. Its own DeepInfra model page states it "supports only non-thinking
  //      mode and does not generate <think></think> blocks" — a STRUCTURAL
  //      guarantee (this model variant has no hidden reasoning channel to
  //      begin with), not a documented off-switch a caller has to remember to
  //      flip. That makes it categorically safer against gpt-oss-20b's
  //      failure class (a hidden Harmony reasoning phase that sometimes never
  //      hands off to the visible answer) than a model that merely defaults
  //      to non-thinking but still has a thinking mode to accidentally
  //      trigger.
  //
  // Sanity-checked live (2026-08-13) before this swap, per this session's own
  // rule not to trust a model id without checking the literal DeepInfra page
  // for it — learned the hard way on the Llama swap below: fetched
  // https://deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507 directly and
  // confirmed it resolves to a real, live model page, not a 404. That page
  // also states a 262,144-token native context window (see CTX.deepinfra
  // above — well inside the existing 128K ceiling, no change needed) and
  // shows "Supports" badges for both JSON and function calling — but this
  // session already established that DeepInfra's "JSON" capability badge is
  // NOT a reliable signal of real constrained-decoding support: Llama-3.3-70B
  // carried the identical badge and still failed under the json_object
  // fallback, never mind strict json_schema. Its strict-json_schema support
  // on DeepInfra is therefore genuinely UNCONFIRMED — supportsJsonSchema()
  // (router-shared.ts) was deliberately NOT extended to include it, same
  // discipline as every model on this target except DeepSeek-V3 (see that
  // function's own comment). Real-verified the same evening this comment was
  // written: 22/22 pipeline steps' real calls succeeded, zero regenerations,
  // zero JSON-parsing failures (full results in the swap note above this
  // one) — this model was never demoted for failing, only superseded by the
  // 2026-08-14 DeepSeek-V4-Flash-0731 exploration above.
  //
  // Paired with a new defensive fix the same session (router.ts, completeJSON
  // / tryParse, via stripMarkdownFence): a helper now strips a leading/
  // trailing markdown code fence from ANY completion before JSON.parse ever
  // sees it, unconditionally — a direct response to the Llama fence-wrapping
  // failure above, and cheap insurance in case Qwen (or any future model on
  // this fallback path) does the same thing. It is a robustness net, not a
  // substitute for actually real-verifying Qwen's own output quality and
  // schema conformance.
  //
  // ── Llama-3.3-70B-Instruct-Turbo swap (2026-08-13, real-verified live —
  // 4/4 real attempts FAILED) — kept here for history, swapped from
  // 'deepseek-ai/DeepSeek-V3'. DeepSeek-V3 did what it was brought in to do —
  // real-verified live, TWICE: Frame passed 9/9 first try both runs, both
  // Perspectives bundles passed review first try with zero regenerations, so
  // its non-reasoning (no hidden channel) design genuinely avoids
  // gpt-oss-20b's empty-output bug. But it turned out very slow for a
  // 671B-param MoE model: perspectives-generate-details (6 parallel/staggered
  // calls) took 2.3 minutes real wall-clock time for that one step alone, and
  // the whole Perspectives layer took over 8 minutes — DEEPINFRA_SWARM_TIMEOUT_MS
  // (router-lanes.ts) had to be temporarily bumped 60s→200s just to let it
  // finish, and that bump has NOT been right-sized back down. Llama-3.3-70B
  // was tried next on the theory that it would keep DeepSeek-V3's win (dense,
  // plain instruction-tuned model, no hidden reasoning phase — same reason it
  // can't hit gpt-oss-20b's Harmony empty-output bug) while being meaningfully
  // smaller — 70B dense vs. DeepSeek-V3's 671B — and therefore faster, while
  // still being "smart enough." That theory was never actually tested: all 4
  // real attempts failed before quality could even be assessed, on a THIRD
  // failure mode distinct from either other model's known risk (gpt-oss-20b's
  // empty output, DeepSeek-V3's speed, or Llama-3.1-8B's poor feedback
  // incorporation below) — see the Qwen swap note above for exactly what that
  // failure was (markdown-fence-wrapped JSON breaking JSON.parse) and why
  // it's a formatting bug, not evidence Llama-3.3-70B is a "dumb" model.
  //
  // Exact id, NOT the plain Hugging Face id — confirmed 2026-08-13 against
  // DeepInfra's own model/demo/API-reference pages (deepinfra.com/meta-llama/
  // Llama-3.3-70B-Instruct-Turbo and its /api subpage's curl example, plus
  // api.deepinfra.com/models/meta-llama/Llama-3.3-70B-Instruct-Turbo):
  // DeepInfra only serves the FP8-quantized "-Turbo" variant — the bare
  // 'meta-llama/Llama-3.3-70B-Instruct' id 404s on DeepInfra's own site.
  // Context window 131,072 (same pages, consistently) — see CTX.deepinfra
  // above for why the 128_000 default didn't need to change for this. Caveat
  // worth flagging: DeepInfra's own bulk /v1/openai/models catalog listing
  // truncates before reaching this entry (150+ models), so its presence
  // there specifically could not be confirmed the same way; the per-model
  // pages were consistent across four independent fetches, which is the
  // basis for this swap. Pricing (informational): ~$0.10/1M input, ~$0.32/1M
  // output (standard tier) — meaningfully cheaper than DeepSeek-V3 too,
  // though cost was not the reason for this swap.
  //
  // supportsJsonSchema() (router-shared.ts) was deliberately NOT extended to
  // match Llama here: docs.deepinfra.com/chat/structured-outputs, re-checked
  // 2026-08-13, names only DeepSeek-V3 explicitly (in its code examples) and
  // links out to a general "many of our models" JSON list without enumerating
  // Llama — not the explicit per-model confirmation this codebase requires
  // before granting strict json_schema mode (see that function's own comment
  // for why: Cerebras's weaker enforcement burned this once already). Llama
  // therefore ran on the existing json_object fallback path, same as every
  // other unconfirmed model — this is NOT the regression the DeepSeek-V3
  // comment below warns about (that was Llama-3.1-8B silently falling back
  // without anyone deciding it should); this was a deliberate, documented
  // choice to stay on the conservative path pending real confirmation. That
  // conservative path is exactly where the fence-wrapping failure happened:
  // the model itself chose to prose-wrap its JSON in markdown, precisely what
  // strict json_schema mode is designed to prevent. Whether strict mode would
  // have avoided this is unconfirmed (Llama was never granted it) but is a
  // reasonable hypothesis if this model id is ever revisited.
  //
  // ── DeepSeek-V3 swap (2026-08-13, real-time incident review with Samir and
  // a senior engineer, both watching the deployed pipeline fail live), kept
  // here for history — swapped from 'openai/gpt-oss-20b'. gpt-oss-20b's
  // Harmony response format has a hidden internal reasoning phase before it
  // writes the visible answer; real production traffic that same evening
  // showed it sometimes never hands off — 5 consecutive real failures on
  // global-assumptions-generate (up to 3 same-target retries each, so ~15
  // real underlying calls, all empty) — see
  // plans/active/reasoning-pipeline/23 and 24. DeepSeek-V3 is a plain
  // non-reasoning chat model — no hidden channel, so it can't fail this
  // specific way by construction, which was the actual point of that swap
  // (not a quality upgrade). Confirmed via DeepInfra's own docs
  // (docs.deepinfra.com/chat/structured-outputs) as one of the models they
  // explicitly support strict json_schema structured output for — see
  // supportsJsonSchema()'s 'deepseek-v3' branch (router-shared.ts), added
  // alongside that swap so DeepInfra calls don't silently fall back to the
  // looser json_object mode the way Llama-3.1-8B did during this target's
  // PREVIOUS model swap (below) — that regression is exactly what this
  // comment warns the next swap not to repeat. (It wasn't: see above.)
  //
  // Prior history: this target started on Llama-3.1-8B-Instruct, moved to
  // gpt-oss-20b (2026-08-10, Samir's call) because real review-panel runs
  // showed Llama wasn't reliably incorporating the panel's regeneration
  // feedback — repeatedly re-failing the same standards instead of
  // converging. That's a genuinely different failure mode than gpt-oss's
  // (content quality vs. empty output), DeepSeek-V3's (speed), or
  // Llama-3.3-70B's (JSON formatting) — the current Qwen3-235B-A22B-2507
  // default has NOT been real-verified against ANY of these four prior risks
  // yet; watch early real runs for all of them the same way this whole
  // session has watched for everything else. Swap the string below (or
  // DEEPINFRA_MODEL env) to revert or try something else again.
  deepinfra: {
    provider: 'deepinfra',
    model: process.env.DEEPINFRA_MODEL ?? 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    keyEnv: process.env.DEEPINFRA_KEY_ENV ?? 'DEEP_INFRA_API_KEY',
    contextWindow: CTX.deepinfra,
  },
  // Reasoning-pipeline-only, per-step model tiers (2026-09-12, Samir's call,
  // own research — see TARGETS.deepinfra's own comment above for the full
  // "why 3 models" rationale). Same account/key/context as TARGETS.deepinfra
  // above — only the model id differs, so both new targets reuse its keyEnv
  // and CTX.deepinfra rather than minting their own env-var names for those.
  //
  // 'large': perspectives-generate-stances/-details and global-assumptions-
  // generate ONLY (router-lanes.ts's swarmAttempts(), tier param) — the two
  // layers Samir specifically wants the 2.4T model reasoning about. Every
  // other swarm-role step (and synthesis) stays on TARGETS.deepinfra above —
  // NOT this target, despite the name "deepinfraLarge" possibly suggesting
  // otherwise; the name is about the MODEL'S size, not usage breadth.
  deepinfraLarge: {
    provider: 'deepinfra',
    model: process.env.DEEPINFRA_LARGE_MODEL ?? 'Qwen/Qwen3.8-2.4T-A95B',
    keyEnv: process.env.DEEPINFRA_KEY_ENV ?? 'DEEP_INFRA_API_KEY',
    contextWindow: CTX.deepinfra,
  },
  // 'critic': every review-panel standard-verdict call AND master-review
  // (orchestrator-panel.ts's runReviewPanel/runMasterReview — the ONLY two
  // functions any review step ever calls through, per that file's own
  // header) — every one of the 6 review gates plus master-review escalation
  // routes through here, nothing else does.
  //
  // Active default: 'deepseek-ai/DeepSeek-V3' (2026-09-12, Samir's call,
  // replacing 'Qwen/Qwen3.8-27B' — real-verified failure, not a guess).
  // Qwen3.8-27B's very first real test on this target halted the pipeline
  // at perspectives-review: `standard_verdict` calls (effort 'low',
  // maxTokens 800) repeatedly came back EMPTY with finishReason "length" —
  // the model burning its entire 800-token budget on hidden reasoning
  // before ever writing the verdict JSON, the exact failure shape that
  // broke gpt-oss-20b earlier in this codebase's history. Tolerated once at
  // frame-review (2 failures, still passed 9/9); fatal at perspectives-
  // review (more standard×perspective combinations, more failures than the
  // retry budget absorbs), ending in a 502 and a halted run. ~21 identical
  // "upstream empty output" errors across both gates it reached — this is
  // the model's actual token behavior on this task, not a one-off blip.
  //
  // DeepSeek-V3 is this file's single most evidence-backed choice for a
  // small, high-volume classification-shaped call: (1) STRUCTURALLY
  // non-thinking (plain model, no hidden reasoning channel at all — not
  // "believed" non-thinking the way Qwen3-235B's own page claims, this one
  // has no mechanism to burn a token budget on invisible thinking in the
  // first place); (2) the one model on this whole target with CONFIRMED
  // strict `json_schema` support on DeepInfra (docs.deepinfra.com/chat/
  // structured-outputs); (3) already real-verified clean doing the HARDER
  // job on this exact codebase (full generation, not just an 800-token
  // verdict) — see TARGETS.deepinfra's own history below: Frame 9/9, both
  // Perspectives bundles 9/9, zero regenerations, zero empty-output. Its
  // one known weakness there — slow on BIG generation (2.3 min for a full
  // Frame) — is a different load profile than a single 800-token pass/fail
  // verdict; unconfirmed whether that weakness transfers here, worth
  // watching on the first few real critic-tier runs the same way every
  // other swap on this target gets watched.
  deepinfraCritic: {
    provider: 'deepinfra',
    model: process.env.DEEPINFRA_CRITIC_MODEL ?? 'deepseek-ai/DeepSeek-V3',
    keyEnv: process.env.DEEPINFRA_KEY_ENV ?? 'DEEP_INFRA_API_KEY',
    contextWindow: CTX.deepinfra,
  },
  groqQwen: {
    provider: 'groq',
    model: process.env.GROQ_QWEN_MODEL ?? 'qwen/qwen3.6-27b',
    keyEnv: process.env.GROQ_QWEN_KEY_ENV ?? 'GROQ_QWEN_3_POINT_6_27B_API_KEY',
    contextWindow: CTX.groq,
  },
  groqGptOss20b: {
    provider: 'groq',
    model: process.env.GROQ_GPT_OSS_MODEL ?? 'openai/gpt-oss-20b',
    keyEnv: process.env.GROQ_GPT_OSS_KEY_ENV ?? 'GROQ_OPENAI_GPT_OSS_20B_API_KEY',
    contextWindow: CTX.groq,
  },
  geminiFlash: {
    provider: 'google',
    model: process.env.GEMINI_FLASH_MODEL ?? 'gemini-2.5-flash',
    keyEnv: process.env.GEMINI_KEY_ENV ?? 'GEMINI_FLASH_2_POINT_5_API_KEY',
    contextWindow: CTX.gemini,
  },
  cerebrasGptOss120b: {
    provider: 'cerebras',
    model: process.env.CEREBRAS_GPT_OSS_MODEL ?? 'gpt-oss-120b',
    keyEnv: process.env.CEREBRAS_KEY_ENV ?? 'CEREBRAS_GPT_OSS_120B_API_KEY',
    contextWindow: CTX.cerebras,
  },
  openrouterFree: {
    provider: 'openrouter',
    // Free qwen coder. NB: the spec's 'qwen/qwen-2.5-coder-32b:free' is not a real
    // OpenRouter model id (it 400s); the live free coder is 'qwen/qwen3-coder:free'.
    model: process.env.OPENROUTER_FREE_MODEL ?? 'qwen/qwen3-coder:free',
    keyEnv: process.env.OPENROUTER_KEY_ENV ?? 'OPENROUTER_API_KEY',
    contextWindow: CTX.openrouter,
  },
} satisfies Record<string, Target>

export function targetName(t: Target): string {
  return `${t.provider}/${t.model}`
}

// Test seam: injects a fake OpenAI client per target so the failover state
// machine is testable without keys or network; pass null to restore the real
// client cache. Deliberately NOT cleared by __resetRouterState.
let testClientFactory: ((t: Target) => OpenAI | null) | null = null
export function __setClientFactory(
  fn: ((t: { provider: string; model: string; keyEnv: string }) => unknown) | null
): void {
  testClientFactory = fn as ((t: Target) => OpenAI | null) | null
}

// Lazily built, cached one-per-key. Returns null when the target's key is not
// configured so that target is *skipped* (not treated as a fatal upstream error).
const clients = new Map<string, OpenAI | null>()
export function clientFor(target: Target): OpenAI | null {
  if (testClientFactory) return testClientFactory(target)
  if (clients.has(target.keyEnv)) return clients.get(target.keyEnv)!
  const apiKey = process.env[target.keyEnv]
  const client = apiKey
    ? // maxRetries: 0 — the engine's own lane owns failover. We want an instant
      // hop on 429 (not the SDK's Retry-After backoff) and an immediate throw on
      // non-429s, so the SDK must never silently retry the same target.
      new OpenAI({
        apiKey,
        baseURL: BASE_URLS[target.provider],
        timeout: 25_000,
        maxRetries: 0,
      })
    : null
  if (!client) {
    log.error('ai', 'no API key for target — skipping', {
      keyEnv: target.keyEnv,
      provider: target.provider,
      model: target.model,
    })
  }
  clients.set(target.keyEnv, client)
  return client
}

export function __resetClients(): void {
  clients.clear()
}
