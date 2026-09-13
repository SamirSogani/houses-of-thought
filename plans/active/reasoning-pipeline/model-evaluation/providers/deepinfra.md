# Provider: DeepInfra

See [README.md](../README.md) for the 🟢/📋/⏳ provenance legend. Cross-refs:
[latency.md](../latency.md), [reliability.md](../reliability.md),
[cost.md](../cost.md).

## Role across lanes

- **`swarm`/`synthesis`** ([router-lanes.ts](../../../../../lib/ai/router-lanes.ts)):
  the *only* target, no fallback — "DeepInfra, no matter what for now"
  (Samir, verbatim, [doc 20](../../20-deepinfra-tuning-real-verification.md)'s
  addendum). Deliberate, temporary reduction in resilience: a genuine
  DeepInfra outage now fails a swarm/synthesis call outright. Retried on
  itself `DEEPINFRA_SAME_TARGET_ATTEMPTS = 3` times per call before giving
  up (added after [doc 23](../../23-deepinfra-intermittent-reliability-and-same-target-retry.md)
  found DeepInfra's own failures are intermittent, not systemic).
- **Realtime (`coach`/`critic`)**: paid relief valve, second in the chain
  after Mistral — added 2026-08-10 when Mistral's free tier plus the
  reasoning pipeline's 9-parallel review panels were exhausting shared quota
  fast enough that even n=2 test runs failed roughly half the time.
- Not in `drafter` or `suggestor` — see those providers' own docs.

## Model history and `supportsJsonSchema()` status

Moved to [deepinfra-model-history.md](deepinfra-model-history.md) 2026-09-12
— eleven swaps/tuning changes deep, that section alone was pushing this file
past the 200-line hard split threshold (CLAUDE.md). See that file for the
full swap-by-swap narrative (`TARGETS.deepinfra`/`deepinfraLarge`/
`deepinfraCritic`, [router-config.ts](../../../../../lib/ai/router-config.ts))
and which models have strict `json_schema` support granted
([router-shared.ts](../../../../../lib/ai/router-shared.ts)).

## Known open items

- `perspective_evidence`/`global_evidence` — the two step-families that
  route through `generateWithOptionalSearch`'s multi-round search chain —
  are the most exposed by the no-fallback policy: a slow/empty DeepInfra
  round has nothing to fail over to. Flagged in doc 20's addendum, partly
  addressed by [doc 22](../../22-vercel-hobby-duration-and-stagger-fix.md)
  (duration/stagger) and [doc 23](../../23-deepinfra-intermittent-reliability-and-same-target-retry.md)
  (same-target retry), not eliminated.
- Gemini truncates `global_assumptions_packet` at 900 tokens on repair —
  a DeepInfra-adjacent finding (surfaced while DeepInfra was the primary
  suspect), not yet fixed; see doc 20's "Known gaps."
- Every reasoning-pipeline `maxTokens` (orchestrator-*.ts) is now a uniform
  8000, 2026-09-12 (deepinfra-model-history.md #11) — replaces per-schema
  tuning as the fix for hidden-reasoning-token models burning a tight
  budget before writing JSON (#9, #10, #11). Real-verified clean same day.
- No per-request cost/token telemetry — see [cost.md](../cost.md).
