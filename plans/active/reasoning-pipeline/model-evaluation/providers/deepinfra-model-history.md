# DeepInfra — model history

Split out of [deepinfra.md](deepinfra.md) 2026-09-12 (that file was about to
exceed CLAUDE.md's 200-line hard split threshold). See that file for role,
lane context, and known open items; see [README.md](../README.md) for the
🟢/📋/⏳ provenance legend.

## Model history — eleven swaps/tuning changes, one target family

`TARGETS.deepinfra.model` ([router-config.ts](../../../../../lib/ai/router-config.ts))
is deliberately model-agnostic in naming (not `deepinfraGptOss20b` etc.) —
2026-08-10, after the first swap required a 4-file rename. Every entry below
is 📋 from that file's own comment history plus commit `e8a8682`, except the
last four (this session, 🟢).

1. **`Llama-3.1-8B-Instruct`** (original). Swapped away: didn't reliably
   incorporate the review panel's regeneration feedback — repeatedly
   re-failed the same standards instead of converging.
2. **`openai/gpt-oss-20b`** (2026-08-10). Chosen for the same-model-family
   confidence Groq already had with it. Failure mode: its "Harmony" response
   format has a hidden internal reasoning phase that sometimes never hands
   off to the visible answer — 5 consecutive real failures on
   `global-assumptions-generate` in one incident, confirmed via DeepInfra's
   own dashboard (received, billed, no rate limit — model behavior, not
   infra). Full investigation: [doc 23](../../23-deepinfra-intermittent-reliability-and-same-target-retry.md).
3. **`deepseek-ai/DeepSeek-V3`** (2026-08-13, same-day incident response).
   Plain non-reasoning model — no hidden channel, structurally can't hit
   gpt-oss-20b's failure class. Real-verified twice, clean both times
   (Frame 9/9, both Perspectives 9/9, zero regenerations). Only problem:
   very slow (671B/37B active MoE) — one step alone took 2.3 minutes; the
   whole Perspectives layer over 8 minutes. Forced
   `DEEPINFRA_SWARM_TIMEOUT_MS` 60s→200s just to let it finish; never
   right-sized back down since. The only model on this target with
   confirmed strict `json_schema` support
   (`supportsJsonSchema()`, router-shared.ts — DeepInfra's docs explicitly
   name it).
4. **`meta-llama/Llama-3.3-70B-Instruct-Turbo`** (2026-08-13, hours later).
   Theory: keep DeepSeek-V3's no-hidden-channel win, smaller (70B dense) so
   faster. Speed theory held (~25-27s/call) but never got assessed properly:
   **4/4 real attempts failed** — wrapped valid JSON in a markdown code
   fence, breaking `JSON.parse`. Root cause: never granted
   `supportsJsonSchema()` (unconfirmed on DeepInfra), so it ran on the
   looser `json_object` fallback with no constrained-decoding guarantee.
   Note the exact id matters: the bare `meta-llama/Llama-3.3-70B-Instruct`
   404s on DeepInfra — only the FP8-quantized `-Turbo` variant is served.
5. **`Qwen/Qwen3-235B-A22B-Instruct-2507`** (2026-08-13, same evening).
   Chosen for a *structural* guarantee against gpt-oss-20b's failure class:
   its model page states it "supports only non-thinking mode and does not
   generate `<think></think>` blocks" — not a default that could be
   accidentally overridden. Real-verified once, clean (22/22, zero
   regenerations, zero JSON-parsing failures) — added
   `stripMarkdownFence()` (router.ts) as general insurance the same session,
   whether or not Qwen actually needed it is unconfirmed either way. **Then
   failed in real production traffic the next day** (this session,
   `ai-invalid-output` at `perspectives-evidence-strategy`) — see
   [reliability.md](../reliability.md)'s caveat section for why one clean
   run isn't proof.
6. **`deepseek-ai/DeepSeek-V4-Flash-0731`** (2026-08-14, merged to
   production; **rolled back 2026-08-15, see #7**) 🟢. Exploratory swap —
   Qwen hadn't failed *its own* real-verification, this was tried because
   DeepSeek released V4-Flash the same week (284B/13B active MoE, 1M
   context, "agentic"-tuned). Confirmed the exact dated id (`-0731`) over
   the bare `DeepSeek-V4-Flash`, which DeepInfra's own page copy marks as
   the superseded preview. **Known, flagged-before-testing risk:** unlike
   DeepSeek-V3 and Qwen, this model's page documents a `reasoning_effort`
   param and `reasoning_content` field — it *does* have a hidden reasoning
   channel, the same shape of mechanism that broke gpt-oss-20b. Solo
   real-verification (22/22, zero regenerations, zero `ai-empty-output`)
   came back clean — but the risk was real: a **9-way concurrent real-load
   test the next day found 3/9 (33%) permanent failures**, 5
   `ai-invalid-output` events across 3 questions plus a separate silent-stall
   pattern on 2 more, after 2 retries each with no recovery. Full data:
   [26-deepseek-v4-flash-model-swap-plan.md](../../26-deepseek-v4-flash-model-swap-plan.md),
   [reliability.md](../reliability.md). Also never granted
   `supportsJsonSchema()` — DeepInfra's structured-outputs docs still only
   confirm DeepSeek-V3.
7. **`Qwen/Qwen3-235B-A22B-Instruct-2507`** (2026-08-15, rollback; still the
   shared default today, see #8) 🟢. Reverted to swap #5 via the
   `DEEPINFRA_MODEL` Vercel env var (Production) — no code deploy, per
   `router-config.ts`'s own comment on the override (the code's hardcoded
   default string kept reading `deepseek-ai/DeepSeek-V4-Flash-0731` for a
   month; the env var is what actually governed production in the
   meantime). Chosen because Qwen's own known failure (`ai-invalid-output`,
   1 production incident, see swap #5) is a single data point against
   DeepSeek-V4-Flash-0731's 3/9 concurrent-load failure rate — not a clean
   bill of health, but the better-evidenced option between two
   thinly-verified models. The 9-way concurrent-load re-test this entry
   called for still hasn't been done — see reliability.md's "Still needed".
8. **Per-step tiering, 2026-09-12** (Samir's own research, not this
   codebase's usual real-verification-first discipline — treat all three as
   unverified on this app's own traffic until real runs happen). Briefly
   (a few hours, same session) the hardcoded default itself became
   `Qwen/Qwen3.8-2.4T-A95B` for every role sharing this target; Samir then
   corrected that to the narrower split below — worth knowing if the
   history reads as churn, because it was, all in one day:
   - **`Qwen/Qwen3-235B-A22B-Instruct-2507`** stays the shared default
     (`TARGETS.deepinfra`) for coach/critic/suggestor/feedback/console, AND
     the pipeline's "draft" tier for every swarm/synthesis step except the
     two below.
   - **`Qwen/Qwen3.8-2.4T-A95B`** (`TARGETS.deepinfraLarge`) — perspectives-
     generate-stances/-details and global-assumptions-generate ONLY. 2.4T
     total / 95B active MoE (Qwen3.5 architecture), 262,144-token native
     context (same as #5/#7, no CTX.deepinfra change needed), ~$2.00/1M in,
     ~$6.00/1M out — roughly 30x #7's cost, spent only on these two layers.
   - **`Qwen/Qwen3.8-27B`** (`TARGETS.deepinfraCritic`, first choice — see
     swap #9 below) — every review-panel standard-verdict call and
     master-review, i.e. all 6 review gates plus escalation. 262,144-token
     native context, ~$0.40/1M in, ~$3.00/1M out.
   - Reasons given for the two non-default models: (1) meaningfully better
     strict `json_schema` handling on DeepInfra than Qwen3-235B despite
     neither being on DeepInfra's own explicit list (see
     `supportsJsonSchema()` below); (2) the 2.4T model exposes reasoning via
     `stream: true` rather than mixing it into `content` — unconfirmed
     whether that holds on a non-streamed call, which is all this codebase
     makes (`callProvider`, router.ts, doesn't stream).
   - Mechanism: `swarmAttempts()`'s `tier` param (router-lanes.ts), threaded
     through `completeJSON`'s `swarmTier` option — only the 7 call sites
     above pass 'large'/'critic' explicitly; every other swarm-role call
     site is unchanged and silently gets 'draft'.
9. **Critic tier swapped, same day** — `Qwen/Qwen3.8-27B` halted its first
   real test at perspectives-review: `standard_verdict` calls (800
   maxTokens) came back empty ~21 times, `finishReason: "length"` — burning
   the whole budget on hidden reasoning before writing the verdict, same
   shape as gpt-oss-20b's own failure. Replaced with `deepseek-ai/DeepSeek-V3`
   — structurally non-thinking, DeepInfra-confirmed `json_schema`, already
   real-verified clean on the harder job (full generation, swap #3).
   `supportsJsonSchema()` needed no new entry — `deepseek-v3` already
   matched.
10. **Large tier: maxTokens bumped, not swapped, same day** — the
    DeepSeek-V3 critic fix (#9) confirmed clean on its 2nd real test
    (Frame-review, both Perspectives-review, zero errors), but the run then
    halted one layer later at `global-assumptions-generate` (the **large**
    tier, `Qwen/Qwen3.8-2.4T-A95B`): 3x `upstream empty output`,
    `finishReason: "length"`, `maxTokens: 900` — the identical failure
    shape as #9, one tier over. Samir's call: try headroom before a model
    swap, since 2.4T was chosen specifically for stronger schema/JSON
    behavior he wants to keep if possible. `runGlobalAssumptionsGenerate`'s
    `maxTokens` (orchestrator-global.ts) raised 900 → 8000. **Real-verified
    2026-09-12, 3rd test run: fixed** — clean 35.4s generation call, zero
    errors, full pipeline completed end to end for the first time in three
    attempts. See #11 for what that same run also surfaced.
11. **Blanket maxTokens bump, every reasoning-pipeline call, same day** —
    run #3 (the retest that confirmed #10) also caught `standard_verdict`
    (the critic tier's per-standard review call, `orchestrator-panel.ts`,
    all 6 review gates) needing ~7,400 tokens against its 800 cap: 6x
    `upstream call failed`/`Request timed out`, `neededTokens: 7409-7447`,
    self-recovered via the run's own retries before hitting a hard wall —
    same failure class as #9/#10, a third call site. Rather than keep
    individually re-tuning each of the reasoning pipeline's ~19 completeJSON
    call sites against an unknown, apparently model-specific hidden-
    reasoning-token appetite, Samir's call: raise every one of them to a
    uniform 8000 (`REPAIR_TOKEN_HEADROOM` still layers on top for
    repair-mode calls, unchanged). Touches every generate/review/synthesis
    call across `orchestrator-setup.ts`, `orchestrator-perspectives.ts`,
    `orchestrator-global.ts`, and `orchestrator-panel.ts` — full rationale
    inline at each site, cross-referenced to `runGlobalAssumptionsGenerate`'s
    comment (orchestrator-global.ts). **Real-verified 2026-09-12, 4th test
    run: completely clean** — zero errors of any kind (transient or hard),
    zero review-gate regenerations, full pipeline done in ≈16m15s vs. the
    prior run's ≈27m49s (~42% faster — almost exactly the time that run
    burned retrying `standard_verdict` timeouts). The perspectives-review
    timeout/502 pattern from run #3 did not recur. One standard
    ("fairness") failed at global-evidence-review but was *tolerated*
    (`MAX_PANEL_FAILURES = 1`, orchestrator-panel.ts) — expected panel
    behavior, not a regression. First of four test runs across this whole
    per-tier/maxTokens effort with a fully clean log.

## `supportsJsonSchema()` status — three models, out of nine

`deepseek-ai/DeepSeek-V3`, `Qwen/Qwen3-235B-A22B-Instruct-2507` (shared
default), and `Qwen/Qwen3.8-2.4T-A95B` (the "large" tier) all have strict
`json_schema` support granted in
[router-shared.ts](../../../../../lib/ai/router-shared.ts). DeepSeek-V3 and
Qwen3-235B via an explicit DeepInfra-docs mention (docs.deepinfra.com/chat/
structured-outputs, re-checked 2026-09-12, now names both — matched via
`deepseek-v3`/`qwen3-235b` substrings, deliberately not bare `deepseek` so R1
and other variants don't silently inherit it); Qwen3.8-2.4T-A95B via Samir's
own research rather than a DeepInfra-docs mention — the deliberate exception
to this file's own "badge/claim alone isn't enough" rule (see swap #8
above). Qwen3.8-27B was granted the same way and then removed after swap #9
found it failing in practice — see that entry; leaving its grant in place
would just be a stale, unused rule. Every other model this target has ever
run falls back to the looser `json_object` mode (schema described in the
prompt, not enforced), backed only by `JSON_SHAPE_GUARDRAIL` (a prompt-level
ask) and `stripMarkdownFence()` (a parse-time defense).
