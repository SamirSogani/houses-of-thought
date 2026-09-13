// Server-only reasoning-pipeline primitive: gates one artifact through the
// nine-standard review panel (decisions/019 §3 — "review panel," not
// "critic," to avoid conflating with the shipped six-standard Socratic critic
// at /api/ai/critique). This is the ONE shared runner reused at every gate,
// including nested once per perspective bundle at perspectives-review.

import { completeJSON } from '@/lib/ai/router'
import { log } from '@/lib/log'
import { STANDARDS, LAYER_STANDARD_CRITERIA } from './standards'
import { buildReviewerPrompt, buildMasterReviewPrompt } from './prompts'
import {
  SingleStandardVerdictSchema,
  ReviewPanelVerdictSchema,
  MasterReviewGuidanceSchema,
  type ReviewPanelVerdict,
  type MasterReviewGuidance,
} from './contracts'
import type { ReviewGateStep } from './steps'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/orchestrator-panel.ts is server-only and must not run in the browser')
}

// All 9 calls use one role — originally 'critic' (Mistral-first), now 'swarm'
// (DeepInfra-first, 2026-08-10 addendum to decision 013 — see lib/ai/router.ts
// swarmAttempts()): free-tier Mistral/Groq couldn't sustain this call's real
// volume (9 parallel calls per gate, repeated across every gate in a run), so
// this and every other reasoning-pipeline generate/review call moved to the
// pipeline's own DeepInfra-led lane, leaving 'critic' for the rest of the app.
// A round-robin across multiple DIFFERENT roles was tried here first, on the
// theory that 9 concurrent calls on one provider was causing malformed
// output; that theory was wrong (the real bug was a too-tight schema
// max-length, fixed in contracts.ts) and the round-robin turned out actively
// counterproductive live during Phase 1 verification (2026-07-30): heavy
// same-day testing pushed Gemini and Cerebras into real rate-limiting
// (confirmed via the AI monitor — both showing HTTP 429 with several
// failures) while Mistral stayed perfectly healthy throughout (100+ calls,
// zero failures) — so spreading 6 of 9 calls onto other roles was routing
// INTO the two providers already under load. One role's own multi-provider
// failover chain already gives resilience if its primary gets rate-limited;
// a small stagger avoids firing all 9 in the same instant.
const REVIEWER_STAGGER_MS = 150

// A genuinely good artifact rarely satisfies all nine independent reviewers at
// once: each is a separate, noisy binary judgment, and AND-ing nine of them
// makes unanimity a near-coin-flip even on strong content — worse, the failing
// subset is DIFFERENT each attempt, which is what drove the observed
// regenerate-and-halt behaviour (a standard passes, a sibling in tension with
// it fails, the repair flips them, repeat). Tolerate up to this many failing
// standards so one noisy or finicky reviewer can't halt an otherwise-sound run.
// The integrity of the gate is preserved by the regeneration loop and the
// per-standard notes, not by demanding a perfect nine. Set to 0 to restore
// decision 019's original strict unanimity.
const MAX_PANEL_FAILURES = 1

function dryRunVerdict(subjectId: string): ReviewPanelVerdict {
  const standards = Object.fromEntries(
    STANDARDS.map((s) => [s.id, { pass: true, notes: `[dry run] ${s.name} not actually graded.` }])
  ) as ReviewPanelVerdict['standards']
  return { subject_id: subjectId, standards, overall_pass: true, degraded: false }
}

// Decision 019 verification stage 3 (04-verification-and-open-questions.md):
// A/B the review panel by running identical queries with panels on vs. off.
// Unlike dryRunVerdict, this is NOT a stand-in for skipped generation — the
// whole point is comparing real generated content with vs. without review
// gating, so callers still make every real *-generate call. Only this
// function's own panel call is replaced with an all-pass verdict.
function autoPassVerdict(subjectId: string): ReviewPanelVerdict {
  const standards = Object.fromEntries(
    STANDARDS.map((s) => [s.id, { pass: true, notes: `[panels off] ${s.name} not actually graded.` }])
  ) as ReviewPanelVerdict['standards']
  return { subject_id: subjectId, standards, overall_pass: true, degraded: false }
}

// Runs all 9 standard-reviewer calls in parallel (Promise.all) and aggregates.
// A batch's wall-clock time is bounded by its slowest single completeJSON call
// (~26s worst case), not the sum — see the Phase 1 plan for why this is safe
// inside one 30s route invocation even nested n-deep at perspectives-review.
export async function runReviewPanel(
  subjectId: string,
  stepId: ReviewGateStep,
  artifact: unknown,
  context: string,
  dryRun = false,
  panelsOff = false,
  // Only perspectives-review (orchestrator-perspectives.ts) passes this — the
  // other stance labels in the same run, so the panel doesn't fault one
  // perspective for not covering ground a sibling perspective owns. See
  // buildReviewerPrompt's siblingPerspectiveLabels comment (prompts.ts).
  siblingPerspectiveLabels?: string[]
): Promise<ReviewPanelVerdict> {
  if (dryRun) return dryRunVerdict(subjectId)
  if (panelsOff) return autoPassVerdict(subjectId)

  const criteria = LAYER_STANDARD_CRITERIA[stepId]
  const entries = await Promise.all(
    STANDARDS.map(async (standard, i) => {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, i * REVIEWER_STAGGER_MS))
      const { system, user } = buildReviewerPrompt(
        standard,
        criteria[standard.id],
        artifact,
        context,
        siblingPerspectiveLabels
      )
      try {
        const verdict = await completeJSON({
          role: 'swarm',
          // Samir's 2026-09-12 per-step tiering (router-config.ts's
          // TARGETS.deepinfraCritic) — every one of the 6 review gates
          // routes through here, so this one line covers all of them.
          swarmTier: 'critic',
          system,
          user,
          schema: SingleStandardVerdictSchema,
          schemaName: 'standard_verdict',
          // 'low' (was 'high', 2026-08-11, Samir): a per-standard pass/fail is
          // matching a specific artifact against one specific written
          // criterion — closer to classification than open-ended reasoning, so
          // it doesn't need deliberation budget the same way generation does.
          // Reversing the 2026-07-30ish call to use 'high' here (that reasoning
          // — "more deliberation cuts reviewer noise" — wasn't wrong, but the
          // review panel isn't where this session's regeneration-quality
          // problem was found; freeing this budget lets generate/repair calls
          // spend it instead, see orchestrator-perspectives.ts/
          // orchestrator-global.ts's allowHighReasoning). Now that
          // reasoningEffortFor (router-shared.ts) actually passes 'low' through
          // to gpt-oss (rather than flooring every request to 'low' regardless,
          // as it did before medium/allowHighReasoning existed), this is a real
          // behavior change for gpt-oss too, not just Gemini.
          effort: 'low',
          // 800 → 8000, 2026-09-12 (Samir): real-verified this session
          // (full test house, orchestrator-global.ts's tier-8 large-tier
          // fix) that DeepSeek-V3 (the critic tier) needed ~7400 tokens to
          // answer THIS schema on a real run — 6 `upstream call failed`/
          // `Request timed out` errors here, `neededTokens: 7409-7447`
          // against this 800 cap, before the run's own retries recovered
          // it. Part of the blanket 8000-everywhere bump across the whole
          // reasoning pipeline — see orchestrator-global.ts's
          // runGlobalAssumptionsGenerate for the full rationale.
          maxTokens: 8000,
        })
        return [standard.id, verdict] as const
      } catch (err) {
        log.error('ai/reasoning/panel', 'standard reviewer call failed', {
          stepId,
          subjectId,
          standard: standard.id,
          error: (err as Error)?.message,
        })
        throw err
      }
    })
  )
  const standards = Object.fromEntries(entries) as ReviewPanelVerdict['standards']
  const failing = STANDARDS.filter((s) => !standards[s.id].pass).map((s) => s.id)
  const overall_pass = failing.length <= MAX_PANEL_FAILURES
  const result: ReviewPanelVerdict = { subject_id: subjectId, standards, overall_pass, degraded: false }
  // Defensive: catches a shape bug here rather than surfacing downstream.
  ReviewPanelVerdictSchema.parse(result)

  log.info('ai/reasoning/panel', 'panel verdict', { stepId, subjectId, overall_pass, failing, tolerated: MAX_PANEL_FAILURES })
  return result
}

// Master-review arbitration (contracts.ts's MasterReviewGuidance, prompts.ts's
// buildMasterReviewPrompt) — the one call that sees all 9 standard verdicts
// together, fired only once, only after a hard-block layer has exhausted
// MAX_REGENERATION_ATTEMPTS still failing (app/api/admin/reasoning/route.ts's
// halt-vs-escalate decision). 'high' + allowHighReasoning: true — unlike the
// 9 standard-reviewer calls above (now 'low'), synthesizing across 9
// independent verdicts and resolving any real tension between them genuinely
// benefits from deliberation, and at one call per hard-halt (rare by
// construction) the empty-completion risk allowHighReasoning accepts is well
// worth it here specifically. See reasoningEffortFor, router-shared.ts.
export async function runMasterReview(
  verdict: ReviewPanelVerdict,
  artifact: unknown,
  context: string,
  dryRun = false
): Promise<MasterReviewGuidance> {
  if (dryRun) {
    return {
      contradictions: '[dry run] none identified.',
      guidance: '[dry run] synthesized guidance for the final regeneration attempt.',
    }
  }
  const { system, user } = buildMasterReviewPrompt(verdict, artifact, context)
  const guidance = await completeJSON({
    role: 'swarm',
    // Samir's 2026-09-12 per-step tiering (router-config.ts's
    // TARGETS.deepinfraCritic) — master review is reviewer-adjacent work
    // (synthesizing 9 standard verdicts), same tier as runReviewPanel above.
    swarmTier: 'critic',
    system,
    user,
    schema: MasterReviewGuidanceSchema,
    schemaName: 'master_review_guidance',
    effort: 'high',
    allowHighReasoning: true,
    // Generous relative to the ~575-token visible-output cap (contradictions
    // 800 chars + guidance 1500 chars) — 'high' reasoning on a synthesis task
    // over a large input (full artifact JSON + 9 verdicts' notes) can spend
    // real tokens thinking before it writes anything, see reasoningEffortFor.
    // Blanket-bumped 2600 → 8000, 2026-09-12 — see runReviewPanel above.
    maxTokens: 8000,
  })
  log.info('ai/reasoning/panel', 'master review', {
    subjectId: verdict.subject_id,
    hasContradiction: !/^\s*none\b/i.test(guidance.contradictions),
  })
  return guidance
}
