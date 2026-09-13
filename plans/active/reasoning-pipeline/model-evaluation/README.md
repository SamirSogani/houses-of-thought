# Model evaluation — index

**Started:** 2026-08-14. A standing doc set for comparing the models/providers
the reasoning pipeline's `swarm`/`synthesis` lanes have run against, separate
from the numbered narrative docs one level up (those are dated session
write-ups; this folder is a living comparison you update as new data comes
in, not a sequence to read in order).

Scope is the reasoning pipeline's dedicated lanes
([decision 020](../../../../decisions/020-deepinfra-swarm-synthesis-lanes.md),
[router-lanes.ts](../../../../lib/ai/router-lanes.ts)) — `swarm` (every
generate/review call except final composition) and `synthesis` (final
composition only), both currently DeepInfra-only by deliberate, temporary
policy ("no matter what for now" — Samir, doc 20's addendum). The provider
docs also cover the other four lanes (suggestor/realtime/drafter) where
relevant, since those share providers even though they don't share models.

## Docs in this folder

- [latency.md](latency.md) — side-by-side latency across every model tested
  on the DeepInfra swarm/synthesis target, broken down by pipeline area.
- [reliability.md](reliability.md) — did it actually complete a real run?
  Pass/fail per model, real failure modes observed, with counts where known.
- [cost.md](cost.md) — per-token pricing where known, the pipeline's call-
  count formula, and planning-vs-measured cost — mostly ⏳ pending real
  telemetry, see that doc's own note.
- [concurrency.md](concurrency.md) — 9 simultaneous real production runs:
  a 33% persistence-write loss rate, one genuine content halt, and the
  UX reality that every run needs manual intervention. See also
  [concurrency-2026-09-13-local-dev-9way.md](concurrency-2026-09-13-local-dev-9way.md)
  — a 3rd 9-way test, local dev, the new 3-tier model system, cut short by
  an unrelated session interruption but showing real review-panel
  degradation under load.
- `providers/` — one doc per provider (`deepinfra.md`, `groq.md`,
  `mistral.md`, `google.md`, `cerebras.md`, `openrouter.md`): that provider's
  role across every lane it's used in, and every quirk/bug this codebase has
  had to work around on it.

## Data provenance — read this before trusting a number

Every figure in this folder is tagged:

- 🟢 **Real-verified this session** (2026-08-14) — Claude ran it directly
  (browser-driven admin panel or local dev server) and is reporting a
  first-hand result.
- 📋 **From commit history / a prior numbered doc** — real, but Claude did
  not witness it directly; sourced from a specific commit message, code
  comment, or doc in `plans/active/reasoning-pipeline/`, cited inline.
- ⏳ **TBD** — not available to Claude from the repo or this session. Samir:
  paste in raw data (Vercel logs, DeepInfra dashboard exports, `/admin`
  monitor screenshots, whatever you have) and these get filled in for real
  rather than estimated.

Nothing in this folder is fabricated or interpolated — an ⏳ stays an ⏳
rather than getting a plausible-looking guess.

## Models covered so far

1-7 below were all on the single, shared `TARGETS.deepinfra`
([router-config.ts](../../../../lib/ai/router-config.ts)), in swap order.
2026-09-12 (Samir's call) split the reasoning pipeline off that single-model
model onto **three concurrent tiers** instead of one more swap — see #8;
the critic tier's own model was then real-verified and swapped again the
same day (#9), the large tier's maxTokens was raised for the same failure
class rather than swapping it too (#10, confirmed fixed by a real run), and
that same run's discovery of a third call site hitting the same wall led to
blanket-raising every reasoning-pipeline maxTokens to 8000 (#11).

1. `Llama-3.1-8B-Instruct` — original default, pre-decision-020 era
2. `openai/gpt-oss-20b` — 2026-08-10 → 2026-08-13
3. `deepseek-ai/DeepSeek-V3` — 2026-08-13 (same-day incident response)
4. `meta-llama/Llama-3.3-70B-Instruct-Turbo` — 2026-08-13 (hours later)
5. `Qwen/Qwen3-235B-A22B-Instruct-2507` — 2026-08-13 (same evening) → 2026-08-14
6. `deepseek-ai/DeepSeek-V4-Flash-0731` — 2026-08-14 → 2026-08-15 (production rollback)
7. `Qwen/Qwen3-235B-A22B-Instruct-2507` — 2026-08-15, rollback (env-var only, no code
   change at the time — see `TARGETS.deepinfra`'s own history in
   [router-config.ts](../../../../lib/ai/router-config.ts))
8. **2026-09-12, per-step tiering** (Samir's own research, not a
   real-verification-driven swap — see `TARGETS.deepinfra`/`deepinfraLarge`/
   `deepinfraCritic`'s own comments, router-config.ts): `Qwen/Qwen3-235B-A22B-
   Instruct-2507` stays the shared default (`TARGETS.deepinfra` — coach/
   critic/suggestor/feedback/console, and the pipeline's "draft" tier for
   every step except the two below); `Qwen/Qwen3.8-2.4T-A95B`
   (`TARGETS.deepinfraLarge`) for perspectives-generate-*/global-assumptions-
   generate ONLY; `Qwen/Qwen3.8-27B` (`TARGETS.deepinfraCritic`) for every
   review-panel/master-review call. Mechanism: `swarmAttempts()`'s `tier`
   param, router-lanes.ts.
9. **2026-09-12, same day, critic tier real-verified and swapped** —
   `Qwen/Qwen3.8-27B` (the critic tier's first choice in #8) halted its very
   first real test run at perspectives-review: `standard_verdict` calls
   (800 maxTokens) repeatedly came back empty, `finishReason: "length"` —
   burning the whole token budget on hidden reasoning before ever writing
   the verdict, the same failure shape that broke gpt-oss-20b earlier in
   this doc. Replaced with `deepseek-ai/DeepSeek-V3` — structurally
   non-thinking, DeepInfra's own confirmed `json_schema` model, and already
   real-verified clean doing the harder job (full generation) on swap #3
   above. Full incident: see `TARGETS.deepinfraCritic`'s own comment,
   router-config.ts.
10. **2026-09-12, same day, large tier: maxTokens bumped, not swapped** — the
    critic fix (#9) re-tested clean, but the run then halted one layer later
    at `global-assumptions-generate` (large tier, `Qwen/Qwen3.8-2.4T-A95B`):
    same failure shape, one tier over. Samir chose headroom over a swap —
    `runGlobalAssumptionsGenerate`'s `maxTokens` raised 900 → 8000
    (orchestrator-global.ts). **Real-verified 2026-09-12, 3rd test run:
    fixed** — full pipeline completed end to end for the first time.
11. **2026-09-12, same day, blanket maxTokens bump, every reasoning-pipeline
    call** — the same run that confirmed #10 also caught `standard_verdict`
    (critic tier, all 6 review gates, `orchestrator-panel.ts`) needing
    ~7,400 tokens against its 800 cap — same failure class, a third call
    site. Samir's call: raise all ~19 reasoning-pipeline `maxTokens` values
    to a uniform 8000 rather than keep re-tuning them one at a time.
    **Real-verified 2026-09-12, 4th test run: completely clean** — zero
    errors of any kind, zero regenerations, ≈16m15s (~42% faster than the
    prior run, which spent that time retrying `standard_verdict` timeouts).

Full narrative for all eleven:
[providers/deepinfra-model-history.md](providers/deepinfra-model-history.md)
(moved out of `deepinfra.md` the same day — see that file).
