// Server-only orchestration for the Perspectives layer — the pipeline's one
// fan-out point (decisions/019). Split into multiple generate rounds because
// later rounds need an earlier round's own generated text as input
// (lib/ai/reasoning/steps.ts explains why that can't be one request):
// stances first, then sub_questions/assumptions/counterargument, then
// evidence's own 3-phase split (strategy → populate → confidence — see
// runPerspectivesEvidenceStrategy below). Failure here is the one place that
// degrades instead of hard-blocking: a bundle whose panel fails gets its own
// bounded regenerations (MAX_REGENERATION_ATTEMPTS, lib/ai/reasoning/budget.ts)
// — only that bundle, not the others — and is marked degraded and passed
// forward only once those are exhausted, since the other bundles still give
// downstream layers something to work with.

import { completeJSON } from '@/lib/ai/router'
import {
  type FramePacket,
  type BreadthScopingPacket,
  PerspectiveStanceSchema,
  type PerspectiveStance,
  PerspectiveBundleSchema,
  type PerspectiveBundle,
  type PerspectivePartialBundle,
  type ReviewPanelVerdict,
  type PerspectiveSubElement,
  type SubElementFailure,
  EvidenceStrategySchema,
  type EvidenceStrategy,
  type EvidenceGatherUnit,
  type EvidenceGatherUnitAnswers,
  EvidencePopulateSchema,
  type EvidenceItemDraft,
  EvidenceConfidenceSchema,
} from './contracts'
import {
  REASONING_PERSONA,
  perspectiveStanceBlock,
  PERSPECTIVE_SUBQUESTIONS_BLOCK,
  PERSPECTIVE_ASSUMPTIONS_BLOCK,
  PERSPECTIVE_EVIDENCE_STRATEGY_BLOCK,
  PERSPECTIVE_EVIDENCE_POPULATE_BLOCK,
  PERSPECTIVE_EVIDENCE_CONFIDENCE_BLOCK,
  PERSPECTIVE_COUNTERARGUMENT_BLOCK,
  serializeFrame,
  appendRegenerationFeedback,
  formatGatherHistory,
} from './prompts'
import { runReviewPanel } from './orchestrator-panel'
import { runSearches } from './search'
import { MAX_REGENERATION_ATTEMPTS, REPAIR_TOKEN_HEADROOM } from './budget'
import type { WorkspaceMode } from '@/lib/profile/data'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/orchestrator-perspectives.ts is server-only and must not run in the browser')
}

const StanceModelSchema = PerspectiveStanceSchema.omit({ perspective_id: true, stance_label: true })

// Small and constant, matching runReviewPanel's REVIEWER_STAGGER_MS
// (orchestrator-panel.ts) — purely to avoid firing every call in the exact
// same instant. Retired 2026-08-12's 20s-per-call DRAFTER_STAGGER_MS (see
// git history / doc 22) — that number existed to protect Groq's TPM ceiling,
// which no longer applies to this DeepInfra-only lane.
const SWARM_STAGGER_MS = 150

export async function runPerspectivesGenerateStances(
  frame: FramePacket,
  scoping: BreadthScopingPacket,
  dryRun: boolean,
  // Phase 3 item 1's re-contextualization mechanism (context-gather-post +
  // any ad-hoc calls so far) — route.ts's buildExtraContext.
  extraContext?: string | null,
  // Business mode (decision 021): defaults to 'general' so the admin-only
  // pipeline (not to be touched — plan doc 27) keeps calling this unchanged.
  workspaceMode: WorkspaceMode = 'general'
): Promise<PerspectiveStance[]> {
  const frameText = serializeFrame(frame, extraContext)
  return Promise.all(
    scoping.candidate_viewpoint_labels.map(async (label, i) => {
      const perspective_id = `p${i + 1}`
      if (dryRun) {
        return {
          perspective_id,
          stance_label: label,
          stance_summary: `[dry run] stance summary for ${label}.`,
          key_claims: [`[dry run] key claim for ${label}.`],
        }
      }
      const modelOut = await completeJSON({
        role: 'swarm',
        system: `${REASONING_PERSONA}\n\n${perspectiveStanceBlock(workspaceMode)}`,
        user: `${frameText}\n\nYour assigned viewpoint label: ${label}`,
        schema: StanceModelSchema,
        schemaName: 'perspective_stance',
        // No repair path exists for stance generation (only the sub-
        // elements below get regenerated after a failed review) — always a
        // first-pass call, so always 'medium'. See allowHighReasoning
        // comments below for why 'high' is reserved for repair specifically.
        effort: 'medium',
        maxTokens: 1000,
      })
      return { perspective_id, stance_label: label, ...modelOut }
    })
  )
}

function dryRunPartial(stance: PerspectiveStance, authoredBy: string): PerspectivePartialBundle {
  return {
    ...stance,
    sub_questions: [`[dry run] sub-question for ${stance.stance_label}.`],
    assumptions: [`[dry run] assumption for ${stance.stance_label}.`],
    counterargument: {
      authored_by_perspective_id: authoredBy,
      target_claims: stance.key_claims.slice(0, 1),
      rebuttals: [`[dry run] rebuttal against ${stance.stance_label}.`],
    },
  }
}

// Only a bundle whose last verdict failed AND hasn't exhausted its retries
// needs regenerating — everything else (already passed, or already gave up
// and degraded) is carried forward untouched. Shared by every generate step
// below AND runPerspectivesReview so none of them can disagree about which
// bundles are "still live."
function needsRegeneration(verdict: ReviewPanelVerdict | undefined): boolean {
  return verdict != null && !verdict.overall_pass && !verdict.degraded
}

// How many attempts a bundle has now had, given its prior verdict — pure,
// no AI calls. Computed once (in runPerspectivesEvidenceConfidence, the last
// generate-side step before assembly) rather than redundantly in every one
// of the 4 generate functions.
function computeAttempts(stances: PerspectiveStance[], repair?: { priorVerdicts: ReviewPanelVerdict[]; priorAttempts: number[] }): number[] {
  return stances.map((_, i) => {
    if (!repair) return 1
    return needsRegeneration(repair.priorVerdicts[i]) ? repair.priorAttempts[i] + 1 : repair.priorAttempts[i]
  })
}

// Thrown by any of the 4 fan-out generate steps below when one or more units
// failed (2026-08-13, Samir) — carries every failure found, not just the
// first one Promise.allSettled happened to see, so app/api/admin/reasoning/
// route.ts can persist and surface exactly which sub-element(s), for which
// perspective(s), actually failed. See SubElementFailure (contracts.ts) for
// the shape and why this exists.
export class PerspectivesGenerateError extends Error {
  constructor(public readonly failures: SubElementFailure[]) {
    super(
      `perspectives fan-out generation failed: ${failures
        .map((f) => `${f.stanceLabel} (${f.perspectiveId})/${f.subElement}: ${f.errorMessage}`)
        .join('; ')}`
    )
    this.name = 'PerspectivesGenerateError'
  }
}

// Runs n parallel completeJSON calls, tagging any rejection with `subElement`
// + the calling perspective before re-throwing via Promise.allSettled — the
// shared machinery behind every one of the 4 fan-out steps below, so
// PerspectivesGenerateError's aggregation logic lives in exactly one place.
async function fanOutTracked<T>(
  stances: PerspectiveStance[],
  subElement: PerspectiveSubElement,
  perCall: (stance: PerspectiveStance, i: number) => Promise<T>
): Promise<{ values: T[] } | { failures: SubElementFailure[] }> {
  const settled = await Promise.allSettled(stances.map((stance, i) => perCall(stance, i)))
  const failures: SubElementFailure[] = []
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      failures.push({
        perspectiveId: stances[i].perspective_id,
        stanceLabel: stances[i].stance_label,
        subElement,
        errorMessage: (result.reason as Error)?.message ?? String(result.reason),
      })
    }
  })
  if (failures.length) return { failures }
  return { values: settled.map((r) => (r as PromiseFulfilledResult<T>).value) }
}

export async function runPerspectivesGenerateDetails(
  frame: FramePacket,
  stances: PerspectiveStance[],
  dryRun: boolean,
  // Present only on a retry loop-back from perspectives-review (03-
  // orchestration-and-failure-handling.md: "only the failing unit
  // regenerates... one perspective's bundle failing doesn't touch any other
  // perspective"). A bundle whose prior verdict already settled (passed, or
  // exhausted retries and degraded) is returned unchanged, not re-asked for.
  repair?: { priorPartials: PerspectivePartialBundle[]; priorVerdicts: ReviewPanelVerdict[]; priorAttempts: number[] },
  // Phase 3 item 1's re-contextualization mechanism — route.ts's buildExtraContext.
  extraContext?: string | null
): Promise<PerspectivePartialBundle[]> {
  const frameText = serializeFrame(frame, extraContext)
  const n = stances.length

  type Result = { partial: PerspectivePartialBundle } | { failures: SubElementFailure[] }

  const results: Result[] = await Promise.all(
    stances.map(async (stance, i): Promise<Result> => {
      const authoredBy = stances[(i + 1) % n].perspective_id
      if (dryRun) return { partial: dryRunPartial(stance, authoredBy) }

      const priorVerdict = repair?.priorVerdicts[i]
      if (repair && !needsRegeneration(priorVerdict)) return { partial: repair.priorPartials[i] }

      const stanceText = `${frameText}\n\n## This perspective's stance\n${stance.stance_label}: ${stance.stance_summary}\nKey claims:\n${stance.key_claims.map((c) => `- ${c}`).join('\n')}`
      const feedback = repair && priorVerdict
        ? { priorArtifact: repair.priorPartials[i], priorVerdict }
        : undefined

      // Flattened across bundles AND sub-elements (i*3+j) — see
      // SWARM_STAGGER_MS above.
      const stagger = (j: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, (i * 3 + j) * SWARM_STAGGER_MS))

      // medium(first pass)/high(repair) — 2026-08-11, Samir: same split as
      // every other generate call in the pipeline. `feedback` presence
      // already distinguishes first-pass from repair for this bundle
      // (computed once above), so it doubles as the effort switch too.
      const genEffort = feedback ? 'high' : 'medium'

      // Promise.allSettled, not Promise.all (2026-08-13, Samir): captures
      // every sub-element that failed, not just whichever one settled
      // first — see PerspectivesGenerateError above and SubElementFailure
      // (contracts.ts). Deliberate tradeoff: up to the slowest single
      // call's own timeout in added latency vs. the old short-circuit.
      const settled = await Promise.allSettled([
        stagger(0).then(() =>
          completeJSON({
            role: 'swarm',
            system: `${REASONING_PERSONA}\n\n${PERSPECTIVE_SUBQUESTIONS_BLOCK}`,
            user: appendRegenerationFeedback(stanceText, feedback),
            schema: PerspectiveBundleSchema.pick({ sub_questions: true }),
            schemaName: 'perspective_subquestions',
            effort: genEffort,
            allowHighReasoning: !!feedback,
            // +REPAIR_TOKEN_HEADROOM on repair only — see budget.ts for why.
            maxTokens: feedback ? 1100 + REPAIR_TOKEN_HEADROOM : 1100,
          })
        ),
        stagger(1).then(() =>
          completeJSON({
            role: 'swarm',
            system: `${REASONING_PERSONA}\n\n${PERSPECTIVE_ASSUMPTIONS_BLOCK}`,
            user: appendRegenerationFeedback(stanceText, feedback),
            schema: PerspectiveBundleSchema.pick({ assumptions: true }),
            schemaName: 'perspective_assumptions',
            effort: genEffort,
            allowHighReasoning: !!feedback,
            // +REPAIR_TOKEN_HEADROOM on repair only — see budget.ts for why.
            maxTokens: feedback ? 1200 + REPAIR_TOKEN_HEADROOM : 1200,
          })
        ),
        stagger(2).then(() =>
          completeJSON({
            role: 'swarm',
            system: `${REASONING_PERSONA}\n\n${PERSPECTIVE_COUNTERARGUMENT_BLOCK}`,
            user: appendRegenerationFeedback(stanceText, feedback),
            schema: PerspectiveBundleSchema.shape.counterargument.omit({ authored_by_perspective_id: true }),
            schemaName: 'perspective_counterargument',
            effort: genEffort,
            allowHighReasoning: !!feedback,
            // +REPAIR_TOKEN_HEADROOM on repair only — see budget.ts for why.
            maxTokens: feedback ? 1600 + REPAIR_TOKEN_HEADROOM : 1600,
          })
        ),
      ])
      const [subQuestionsResult, assumptionsResult, counterargumentResult] = settled

      const failures: SubElementFailure[] = []
      const record = (result: PromiseSettledResult<unknown>, subElement: PerspectiveSubElement) => {
        if (result.status === 'rejected') {
          failures.push({
            perspectiveId: stance.perspective_id,
            stanceLabel: stance.stance_label,
            subElement,
            errorMessage: (result.reason as Error)?.message ?? String(result.reason),
          })
        }
      }
      record(subQuestionsResult, 'sub_questions')
      record(assumptionsResult, 'assumptions')
      record(counterargumentResult, 'counterargument')
      if (failures.length) return { failures }

      const subQuestions = (subQuestionsResult as PromiseFulfilledResult<{ sub_questions: string[] }>).value
      const assumptions = (assumptionsResult as PromiseFulfilledResult<{ assumptions: string[] }>).value
      const counterargument = (
        counterargumentResult as PromiseFulfilledResult<Omit<PerspectiveBundle['counterargument'], 'authored_by_perspective_id'>>
      ).value

      return {
        partial: {
          ...stance,
          ...subQuestions,
          ...assumptions,
          counterargument: { authored_by_perspective_id: authoredBy, ...counterargument },
        },
      }
    })
  )

  const allFailures = results.flatMap((r) => ('failures' in r ? r.failures : []))
  if (allFailures.length) throw new PerspectivesGenerateError(allFailures)
  return results.map((r) => (r as { partial: PerspectivePartialBundle }).partial)
}

// ── Evidence, phase 1/3: strategy (2026-08-13, Samir) ───────────────────────
// Decide search_queries and/or needs_user_input per perspective — nothing
// else. n parallel calls, same repair semantics as every other fan-out step
// (a settled bundle's prior strategy carries forward unchanged).
export async function runPerspectivesEvidenceStrategy(
  frame: FramePacket,
  stances: PerspectiveStance[],
  dryRun: boolean,
  // Dev-testing only (mirrors runContextGather's forceNeedsInput,
  // orchestrator-setup.ts) — forces EVERY stance's dry-run strategy to ask a
  // question, so the multi-unit pause UI (EvidenceGatherAnswerBox) can be
  // exercised for free instead of only ever showing one unit at a time. No
  // effect outside dryRun.
  forceNeedsInput = false,
  // 2026-09-09, Samir's spec — every real Q&A round THIS perspective's own
  // evidence strategy has already asked/received, keyed by perspective_id so
  // a sibling's history never leaks in. Same fix/rationale as
  // orchestrator-global.ts's runGlobalEvidenceStrategy — see
  // route-schema.ts's perspectiveEvidenceGatherHistory for how this
  // accumulates client-side.
  priorGatherHistory?: Record<string, string> | null,
  repair?: { priorStrategies: EvidenceStrategy[]; priorPartials: PerspectivePartialBundle[]; priorVerdicts: ReviewPanelVerdict[] },
  extraContext?: string | null
): Promise<EvidenceStrategy[]> {
  const frameText = serializeFrame(frame, extraContext)
  const result = await fanOutTracked(stances, 'evidence_strategy', async (stance, i) => {
    if (dryRun) {
      if (forceNeedsInput) {
        return {
          search_queries: [],
          needs_user_input: true,
          questions_for_user: [{ question: `[dry run] Anything specific ${stance.stance_label} should look for?`, options: [] }],
          reason: '[dry run] simulated clarification need, for UI testing only.',
        }
      }
      return { search_queries: [], needs_user_input: false, questions_for_user: [], reason: '[dry run] no evidence strategy needed.' }
    }
    const priorVerdict = repair?.priorVerdicts[i]
    if (repair && !needsRegeneration(priorVerdict)) return repair.priorStrategies[i]
    const stanceText =
      `${frameText}\n\n## This perspective's stance\n${stance.stance_label}: ${stance.stance_summary}\nKey claims:\n${stance.key_claims.map((c) => `- ${c}`).join('\n')}` +
      formatGatherHistory(priorGatherHistory?.[stance.perspective_id])
    const feedback = repair && priorVerdict ? { priorArtifact: repair.priorPartials[i], priorVerdict } : undefined
    return completeJSON({
      role: 'swarm',
      system: `${REASONING_PERSONA}\n\n${PERSPECTIVE_EVIDENCE_STRATEGY_BLOCK}`,
      user: appendRegenerationFeedback(stanceText, feedback),
      schema: EvidenceStrategySchema,
      schemaName: 'perspective_evidence_strategy',
      // Deciding search-vs-ask is a simple call by design (Samir's explicit
      // scoping) — 'medium' always, no repair-mode 'high' bump; there's no
      // real content to "revise" here the way populate/confidence have.
      effort: 'medium',
      maxTokens: 500,
    })
  })
  if ('failures' in result) throw new PerspectivesGenerateError(result.failures)
  return result.values
}

// ── Evidence, phase 2/3: populate ("another agent... fetch the data then
// input it into the JSON", Samir) ───────────────────────────────────────────
// Runs each perspective's requested search (if any) via runSearches
// (search.ts) — sequential per-perspective call, same as context-gather's
// existing pattern, NOT generateWithOptionalSearch's old multi-round loop
// (that loop no longer exists anywhere in evidence generation: strategy
// decides search terms ONCE, up front, so there's nothing left to iterate
// on — this also resolves the multi-round CHAIN_DEADLINE_MS-sharing
// complexity doc 20/22 flagged as a known gap for perspective_evidence).
export async function runPerspectivesEvidencePopulate(
  frame: FramePacket,
  stances: PerspectiveStance[],
  strategies: EvidenceStrategy[],
  // The admin's answers to any unit that asked (Phase 3 item 1's pattern,
  // extended — EvidenceGatherUnit/Answers, contracts.ts). Index-aligned with
  // stances; a stance that never asked (or the admin skipped) gets null.
  userAnswers: (string | null)[] | null,
  dryRun: boolean,
  repair?: { priorDrafts: EvidenceItemDraft[][]; priorPartials: PerspectivePartialBundle[]; priorVerdicts: ReviewPanelVerdict[] },
  extraContext?: string | null
): Promise<EvidenceItemDraft[][]> {
  const frameText = serializeFrame(frame, extraContext)
  const result = await fanOutTracked(stances, 'evidence_populate', async (stance, i) => {
    if (dryRun) return [{ claim_id: `dry-run-${stance.perspective_id}`, source_ref: '[dry run] source', caveats: null }]
    const priorVerdict = repair?.priorVerdicts[i]
    if (repair && !needsRegeneration(priorVerdict)) return repair.priorDrafts[i]

    const strategy = strategies[i]
    const searchFindings = strategy.search_queries.length ? await runSearches(strategy.search_queries) : null
    const answer = userAnswers?.[i] ?? null
    let stanceText = `${frameText}\n\n## This perspective's stance\n${stance.stance_label}: ${stance.stance_summary}\nKey claims:\n${stance.key_claims.map((c) => `- ${c}`).join('\n')}`
    if (searchFindings) stanceText += `\n\n## Real search results\n${searchFindings}`
    if (answer) stanceText += `\n\n## The person's answer to your question\n${answer}`

    const feedback = repair && priorVerdict ? { priorArtifact: repair.priorPartials[i], priorVerdict } : undefined
    const out = await completeJSON({
      role: 'swarm',
      system: `${REASONING_PERSONA}\n\n${PERSPECTIVE_EVIDENCE_POPULATE_BLOCK}`,
      user: appendRegenerationFeedback(stanceText, feedback),
      schema: EvidencePopulateSchema,
      schemaName: 'perspective_evidence_populate',
      effort: feedback ? 'high' : 'medium',
      allowHighReasoning: !!feedback,
      // 2400 (2026-08-10 finding, carried over from the old single-call
      // version): gpt-oss-20b's evidence items (citations: study names,
      // years, journals) run long. +REPAIR_TOKEN_HEADROOM on repair only.
      maxTokens: feedback ? 2400 + REPAIR_TOKEN_HEADROOM : 2400,
    })
    return out.evidence
  })
  if ('failures' in result) throw new PerspectivesGenerateError(result.failures)
  return result.values
}

// ── Evidence, phase 3/3: confidence ("a separate request/subagent", Samir) ──
// Sees ONLY the finished items (not the stance, not sourcing context) —
// scoring how well each item's OWN source backs its OWN claim, nothing else.
// Matches confidence entries back to drafts by claim_id, not array position
// — a missing match falls back to 'medium' with a logged warning rather
// than either side needing to stay positionally in sync. Also does the
// final merge (partial bundle + evidence + attempts) into the assembled
// PerspectiveBundle[] perspectives-review expects — the one place all three
// generate-side threads (details, strategy, populate) actually come
// together.
export async function runPerspectivesEvidenceConfidence(
  frame: FramePacket,
  stances: PerspectiveStance[],
  partials: PerspectivePartialBundle[],
  drafts: EvidenceItemDraft[][],
  dryRun: boolean,
  repair?: { priorBundles: PerspectiveBundle[]; priorVerdicts: ReviewPanelVerdict[]; priorAttempts: number[] },
  extraContext?: string | null
): Promise<{ bundles: PerspectiveBundle[]; attempts: number[] }> {
  const context = serializeFrame(frame, extraContext)
  const result = await fanOutTracked(stances, 'evidence_confidence', async (stance, i) => {
    const draft = drafts[i]
    if (dryRun) return draft.map((d) => ({ ...d, confidence: 'medium' as const }))
    const priorVerdict = repair?.priorVerdicts[i]
    if (repair && !needsRegeneration(priorVerdict)) {
      return repair.priorBundles[i].evidence
    }
    if (draft.length === 0) return []

    const feedback = repair && priorVerdict ? { priorArtifact: repair.priorBundles[i].evidence, priorVerdict } : undefined
    const out = await completeJSON({
      role: 'swarm',
      system: `${REASONING_PERSONA}\n\n${PERSPECTIVE_EVIDENCE_CONFIDENCE_BLOCK}`,
      user: appendRegenerationFeedback(`## Evidence items\n${JSON.stringify(draft, null, 2)}\n\n${context}`, feedback),
      schema: EvidenceConfidenceSchema,
      schemaName: 'perspective_evidence_confidence',
      effort: feedback ? 'high' : 'medium',
      allowHighReasoning: !!feedback,
      maxTokens: feedback ? 800 + REPAIR_TOKEN_HEADROOM : 800,
    })
    const byId = new Map(out.confidence.map((c) => [c.claim_id, c.confidence]))
    return draft.map((d) => {
      const confidence = byId.get(d.claim_id)
      return { ...d, confidence: confidence ?? 'medium' }
    })
  })
  if ('failures' in result) throw new PerspectivesGenerateError(result.failures)

  const bundles: PerspectiveBundle[] = partials.map((partial, i) => ({ ...partial, evidence: result.values[i] }))
  const attempts = computeAttempts(stances, repair)
  return { bundles, attempts }
}

// The one step that degrades instead of hard-blocking: a bundle that still
// fails after MAX_REGENERATION_ATTEMPTS is marked degraded and kept, since
// the remaining bundles still give the global layers something to work with
// (03-orchestration-and-failure-handling.md). A bundle already settled last
// cycle (passed, or already degraded) is NOT re-submitted to a fresh panel —
// its prior verdict is final and carried forward as-is.
export async function runPerspectivesReview(
  frame: FramePacket,
  bundles: PerspectiveBundle[],
  priorVerdicts: ReviewPanelVerdict[] | null,
  attempts: number[] | null,
  dryRun: boolean,
  panelsOff = false,
  // Phase 3 item 1's re-contextualization mechanism — route.ts's buildExtraContext.
  extraContext?: string | null
): Promise<ReviewPanelVerdict[]> {
  const context = serializeFrame(frame, extraContext)
  return Promise.all(
    bundles.map(async (b, i) => {
      const prior = priorVerdicts?.[i]
      if (prior && !needsRegeneration(prior)) return prior
      // The other perspectives' labels — so the panel knows this bundle is
      // deliberately narrow and doesn't fault it for ground a sibling
      // perspective owns (see buildReviewerPrompt, prompts.ts).
      const siblingLabels = bundles.filter((_, j) => j !== i).map((sib) => sib.stance_label)
      const verdict = await runReviewPanel(
        b.perspective_id,
        'perspectives-review',
        b,
        context,
        dryRun,
        panelsOff,
        siblingLabels
      )
      if (verdict.overall_pass) return verdict
      const attemptsUsed = attempts?.[i] ?? 1
      return attemptsUsed >= MAX_REGENERATION_ATTEMPTS ? { ...verdict, degraded: true } : verdict
    })
  )
}

// ── Evidence-gather pause aggregation (route.ts helper) ─────────────────────
// Turns n independent EvidenceStrategy verdicts into the units that actually
// need to pause the run — only the ones with needs_user_input: true. Empty
// array means "nothing to pause for," same as ContextGatherVerdict's
// needs_user_input: false.
export function collectEvidenceGatherUnits(stances: PerspectiveStance[], strategies: EvidenceStrategy[]): EvidenceGatherUnit[] {
  return strategies.flatMap((s, i) =>
    s.needs_user_input
      ? [{ unitId: stances[i].perspective_id, unitLabel: stances[i].stance_label, reason: s.reason, questions: s.questions_for_user }]
      : []
  )
}

// Reassembles per-unit answers (from the aggregated pause above) back into
// an array index-aligned with `stances`, one flattened answer per
// perspective — runPerspectivesEvidencePopulate's userAnswers param. A
// perspective's OWN answer is its first answered question, if any (evidence-
// strategy asks at most 3, but populate only needs one combined signal, not
// a per-question breakdown the way context-gather's frame-level answers do).
export function flattenEvidenceGatherAnswers(
  stances: PerspectiveStance[],
  units: EvidenceGatherUnit[],
  answers: (EvidenceGatherUnitAnswers | null)[]
): (string | null)[] {
  const byUnitId = new Map<string, string | null>()
  units.forEach((unit, i) => {
    const unitAnswers = answers[i]
    const firstAnswered = unitAnswers?.find((a) => a != null) ?? null
    byUnitId.set(unit.unitId, firstAnswered)
  })
  return stances.map((s) => byUnitId.get(s.perspective_id) ?? null)
}
