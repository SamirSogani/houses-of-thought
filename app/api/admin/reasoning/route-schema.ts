// Request/run-state contracts and pure helper functions for
// app/api/admin/reasoning/route.ts — split out (2026-08-11) purely to keep
// route.ts under the repo's 600-LOC rule as the master-review escalation
// (masterReview field, MASTER_REVIEW_ATTEMPT) grew it past that. No behavior
// change: everything here is a direct move, not a rewrite. route.ts still
// owns all the actual dispatch logic (the POST handler, ok/retryStep/halted/
// tryMasterReviewOrHalt) — this file is schemas and pure functions only, kept
// together because RunState is the one type nearly everything below threads
// through.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { STEP_ORDER, type StepId, type PipelineMode } from '@/lib/ai/reasoning/steps'
import { MIN_N, MAX_N_PHASE1, MASTER_REVIEW_ATTEMPT } from '@/lib/ai/reasoning/budget'
import { serializeFrame, serializePerspectives, formatContextGatherAnswers } from '@/lib/ai/reasoning/prompts'
import {
  ContextGatherVerdictSchema,
  ContextGatherAnswersSchema,
  AdHocContextGatherSchema,
  FramePacketSchema,
  BreadthScopingPacketSchema,
  PerspectiveStanceSchema,
  PerspectiveBundleSchema,
  PerspectivePartialBundleSchema,
  ReviewPanelVerdictSchema,
  GlobalAssumptionsPacketSchema,
  GlobalEvidencePacketSchema,
  ConclusionsPacketSchema,
  ImplicationsPacketSchema,
  MasterReviewGuidanceSchema,
  SubElementFailureSchema,
  EvidenceStrategySchema,
  EvidenceGatherUnitSchema,
  EvidenceGatherUnitAnswersSchema,
  EvidenceItemDraftSchema,
  GlobalEvidenceItemDraftSchema,
  type ReviewPanelVerdict,
} from '@/lib/ai/reasoning/contracts'

export const RunStateSchema = z.object({
  // 2000 -> 100_000 (2026-09-09, Samir's call, "for now" — not a considered
  // ceiling, just generous headroom): this app exists to reason about hard,
  // detailed questions, and a genuinely hard question routinely runs past
  // 2000 characters — the co-pilot's question textarea has no client-side
  // limit at all, so the old cap meant a sufficiently thorough question
  // 400'd here with no useful message (just "Could not reach the reasoning
  // pipeline"), real-verified live the same session this was raised. Must
  // stay in sync with contracts.ts's originalQueryStr, which mirrors this
  // exact ceiling for FramePacketSchema.original_query — see that constant's
  // own comment for why they have to match.
  originalQuery: z.string().min(1).max(100_000),
  contextGatherPre: ContextGatherVerdictSchema.nullish(),
  // Phase 3 item 1 (decision 019): the admin's answers to contextGatherPre's
  // questions_for_user, same index alignment. Threaded into frame-generate's
  // prompt only (orchestrator-setup.ts's userAnswers param) — never
  // re-threaded downstream via extraContext, since the resulting frame
  // already reflects them for everything after.
  contextGatherPreAnswers: ContextGatherAnswersSchema.nullish(),
  frame: FramePacketSchema.nullish(),
  frameVerdict: ReviewPanelVerdictSchema.nullish(),
  contextGatherPost: ContextGatherVerdictSchema.nullish(),
  // Threaded into every downstream generate/review call's context via
  // buildExtraContext below (serializeFrame's extraContext param) — the frame
  // itself is already locked by this checkpoint, so there's no "regenerate
  // frame" step for these to converge through the way contextGatherPreAnswers
  // does.
  contextGatherPostAnswers: ContextGatherAnswersSchema.nullish(),
  breadthScoping: BreadthScopingPacketSchema.nullish(),
  // Admin-triggered, ad-hoc context-gather calls (Phase 3 item 1's larger
  // scope — README's "any layer can trigger 'ask the user something'
  // mid-pipeline," confirmed with Samir 2026-08-04). Append-only; each
  // entry's `answers` starts null and is filled in once the admin resolves
  // it. Capped generously — bounded by how many times an admin actually
  // clicks the control, not a real limit.
  adHocContextGathers: z.array(AdHocContextGatherSchema).max(20).nullish(),
  perspectiveStances: z.array(PerspectiveStanceSchema).nullish(),
  // perspectives-generate-details' own output (2026-08-13: evidence moved
  // out to its own 3 steps below) — stance + sub_questions + assumptions +
  // counterargument, no evidence yet.
  perspectivePartials: z.array(PerspectivePartialBundleSchema).nullish(),
  // Evidence's own 3-phase output, index-aligned with perspectiveStances —
  // see lib/ai/reasoning/orchestrator-perspectives.ts's
  // runPerspectivesEvidenceStrategy/Populate/Confidence.
  perspectiveEvidenceStrategies: z.array(EvidenceStrategySchema).nullish(),
  // Only the units that asked something (a subset of perspectiveStances,
  // possibly empty) — set only when strategy produced at least one
  // needs_user_input: true, cleared on the next fresh (non-repair) attempt.
  perspectiveEvidenceGatherUnits: z.array(EvidenceGatherUnitSchema).nullish(),
  // Index-aligned with perspectiveEvidenceGatherUnits (NOT perspectiveStances
  // — only the units that actually asked have an entry here). Starts as an
  // array of nulls once gather units are set, filled in as the admin answers.
  perspectiveEvidenceGatherAnswers: z.array(EvidenceGatherUnitAnswersSchema.nullable()).nullish(),
  // 2026-09-09, Samir's spec — evidence-strategy's own memory across
  // regeneration rounds (fixes "the model re-asks the same question 2-3
  // rounds in a row": perspectiveEvidenceGatherAnswers above is single-round
  // and overwritten on every fresh strategy call, so nothing durable used to
  // survive a loop-back). Append-only, never cleared mid-run, accumulated
  // client-side (useReasoningPipelineRunner.ts / ReasoningPipelinePage.tsx's
  // resolvePendingEvidenceGather) — keyed by perspective_id (matches
  // EvidenceGatherUnit.unitId for a perspective unit) so each perspective's
  // own transcript only ever sees its own prior questions, never a
  // sibling's.
  perspectiveEvidenceGatherHistory: z.record(z.string(), z.string().max(2000)).nullish(),
  // evidence-populate's own output, index-aligned with perspectiveStances —
  // claim_id/source_ref/caveats, no confidence yet (that's the next step).
  perspectiveEvidenceDrafts: z.array(z.array(EvidenceItemDraftSchema)).nullish(),
  perspectives: z.array(PerspectiveBundleSchema).nullish(),
  perspectiveVerdicts: z.array(ReviewPanelVerdictSchema).nullish(),
  // Per-bundle regeneration count (03-orchestration-and-failure-handling.md);
  // parallel to `perspectives`. Absent/null means "never regenerated yet."
  perspectiveAttempts: z.array(z.number().int()).nullish(),
  // 2026-08-13, Samir: which sub-element(s), for which perspective(s), the
  // MOST RECENT perspectives fan-out step (generate-details, or any of the
  // 3 evidence steps) failed on — set only when that call throws
  // PerspectivesGenerateError (orchestrator-perspectives.ts), cleared
  // (nullish) on the next successful attempt at whichever step set it. See
  // SubElementFailure (contracts.ts) for why this exists — makes a transient
  // provider failure durable and specific instead of relying on Vercel's own
  // (1-hour, Hobby plan) log retention.
  lastSubElementFailures: z.array(SubElementFailureSchema).nullish(),
  globalAssumptions: GlobalAssumptionsPacketSchema.nullish(),
  globalAssumptionsVerdict: ReviewPanelVerdictSchema.nullish(),
  // Global evidence's own 3-phase output (2026-08-13) — same shapes as the
  // perspective-level ones above, just for the ONE question-level unit
  // (unitId 'global' in globalEvidenceGatherUnit, if it asks).
  globalEvidenceStrategy: EvidenceStrategySchema.nullish(),
  globalEvidenceGatherUnit: EvidenceGatherUnitSchema.nullish(),
  globalEvidenceGatherAnswer: EvidenceGatherUnitAnswersSchema.nullish(),
  // 2026-09-09, Samir's spec — same fix as perspectiveEvidenceGatherHistory
  // above, just for the ONE question-level unit: append-only, never cleared
  // mid-run (route.ts's global-evidence-strategy case sets
  // globalEvidenceGatherAnswer: null on every call — that single-round field
  // is meant to reset; this one must not).
  globalEvidenceGatherHistory: z.string().max(4000).nullish(),
  globalEvidenceDraft: z.array(GlobalEvidenceItemDraftSchema).nullish(),
  globalEvidence: GlobalEvidencePacketSchema.nullish(),
  globalEvidenceVerdict: ReviewPanelVerdictSchema.nullish(),
  conclusions: ConclusionsPacketSchema.nullish(),
  conclusionsVerdict: ReviewPanelVerdictSchema.nullish(),
  implications: ImplicationsPacketSchema.nullish(),
  implicationsVerdict: ReviewPanelVerdictSchema.nullish(),
  // Set once, only when a hard-block layer exhausts MAX_REGENERATION_ATTEMPTS
  // still failing (2026-08-11 addendum) — tryMasterReviewOrHalt's synthesized
  // guidance for that layer's ONE extra attempt. forStep is which *-review
  // step earned it, so the matching *-generate case knows to use it instead
  // of the raw per-standard feedback, and so tryMasterReviewOrHalt itself
  // knows whether a repeat visit to the same review step is the (already
  // master-guided) extra attempt failing too — genuinely halt then, not loop.
  masterReview: z
    .object({
      forStep: z.enum(STEP_ORDER),
      guidance: MasterReviewGuidanceSchema,
    })
    .nullish(),
  // Post-pipeline console only (plan doc 28, 2026-08-19): free-text
  // correction/context from a chat message, set when the person confirms a
  // stage rerun. Folded into buildExtraContext below alongside
  // contextGatherPost/adHocContextGathers — that function's output already
  // threads into every downstream generate call across the WHOLE pipeline
  // (perspectives-generate-stances included), which matters because
  // perspectives has no masterReview channel of its own (no per-bundle
  // review-driven regen path exists — see plan doc 28's table). masterReview
  // still gets set too, for the four stages that DO have that channel — it
  // gives the one stage actually being corrected a more precise "here's your
  // prior output, revise it per this" framing; this field is what keeps the
  // correction live through the rest of a cascading rerun, since
  // masterReview.forStep only ever matches one step. Untouched by every
  // existing caller (admin page, inline pipeline) — always null for them.
  consoleGuidance: z.string().nullish(),
  // Business mode (decision 021, Phase 5, plans/active/business-mode/
  // 05-rag-retrieval.md): RAG-retrieved chunks, computed ONCE by the
  // house-scoped route (app/api/houses/[id]/reasoning/route.ts) on whichever
  // step first needs extraContext, then carried forward via this field on
  // every subsequent step instead of being recomputed — this is the actual
  // latency/cost driver (an embedding-API round trip + vector search) that
  // was previously repeated on every one of ~20 step POSTs despite
  // run.originalQuery (what it searches for) never changing within a run.
  // The tradeoff, confirmed with Samir: a document uploaded mid-run won't be
  // searched until the NEXT run — accepted, since re-checking every step
  // would reintroduce the exact cost this field exists to avoid.
  //
  // Deliberately NOT caching the owning project's context text (Phase 3)
  // alongside this — that's one cheap DB row read, not the latency source,
  // and staying live means an edit to /projects/[id] mid-run is reflected
  // in the very next step rather than frozen at run-start (see route.ts,
  // where it's recomputed fresh every step).
  //
  // Untouched by every existing caller (admin page, inline pipeline) —
  // always undefined for them, same convention as consoleGuidance above.
  // Nullable (not just optional) so "computed, found nothing" (general
  // mode, no project, no matching chunks) is distinguishable from "not
  // computed yet" (undefined) — that distinction is what makes the
  // cache-or-compute check in route.ts work.
  ragText: z.string().nullish(),
  // Business mode (decision 021, Phase 5) — companion to ragText above, same
  // once-per-run caching (folded into the same patch by route.ts's
  // withRagCache). Deliberately NOT the retrieved text itself (that's
  // ragText, prompt-only) — just enough for the UI to say, plainly, that a
  // step used the person's own project material and roughly which document
  // it came from, mirroring InterviewCard's ragSources (decision 021 §5's
  // "labeled, not laundered" requirement extends to the UI, not only the
  // prompt). [] (not undefined) once computed and nothing was retrieved.
  ragSources: z.array(z.object({ sourceType: z.enum(['document', 'house', 'project_context']), label: z.string() })).nullish(),
})
export type RunState = z.infer<typeof RunStateSchema>

// 'context-gather-adhoc' (Phase 3 item 1) is deliberately NOT part of
// STEP_ORDER — it's admin-triggered at whatever step the run is currently
// paused at, not a fixed position in the linear sequence, so it must never
// flow through nextStepAfter()/STEP_ORDER's indexOf-based advance logic the
// way every other step does.
export const StepOrAdHocSchema = z.union([z.enum(STEP_ORDER), z.literal('context-gather-adhoc')])

export const RequestSchema = z.object({
  step: StepOrAdHocSchema,
  // Client-generated once per pipeline run (crypto.randomUUID(), see
  // ReasoningPipelinePage.tsx's start()) and resent on every step call — the
  // persistence key for reasoning_runs (Phase 2 item 1, decision 019). Not
  // used for anything else; the route stays otherwise stateless per-request.
  runId: z.string().uuid(),
  capN: z.number().int().min(MIN_N).max(MAX_N_PHASE1).nullish(),
  dryRun: z.boolean().optional(),
  // Required only for step === 'context-gather-adhoc': which real step the
  // client was paused at/before when the admin triggered it — used both as
  // the ad-hoc call's own context ("where in the pipeline is this") and as
  // the `last_step` value persistRunStep records for it (persistence.ts
  // requires a real StepId, and 'context-gather-adhoc' itself isn't one).
  atStep: z.enum(STEP_ORDER).nullish(),
  // Dev-testing only (Phase 3 item 1): forces runContextGather's dryRun
  // branch to simulate needs_user_input: true instead of always false, so the
  // pause/ask/resume UI can be exercised for free. Never has any effect
  // outside dryRun — see orchestrator-setup.ts's runContextGather.
  devForceNeedsInput: z.boolean().optional(),
  // Decision 019 verification stage 3 (A/B the review panel,
  // 04-verification-and-open-questions.md): unlike dryRun, generation stays
  // real — only every runReviewPanel call is replaced with an auto-pass
  // verdict (orchestrator-panel.ts). Lets the same real question be run twice
  // (panels on vs. off) and compared for final-answer quality.
  panelsOff: z.boolean().optional(),
  // Which attempt (1-indexed) this is for the layer currently in flight — the
  // client increments it only across a regenerate-then-re-review loop-back
  // (see `retry` on the response below) and resets it to 1 on any genuinely
  // new layer. Read only by hard-block review steps to decide retry vs halt;
  // perspectives-review tracks its own per-bundle counts in run state instead
  // (a single scalar can't represent "n independent bundles' attempt counts").
  // Max raised to MASTER_REVIEW_ATTEMPT (2026-08-11): attempt 4 is the one
  // master-guided attempt tryMasterReviewOrHalt grants a hard-block layer
  // before it genuinely halts — see budget.ts.
  attempt: z.number().int().min(1).max(MASTER_REVIEW_ATTEMPT).nullish(),
  run: RunStateSchema,
  mode: z.enum(['thorough', 'express']).optional().default('thorough'),
})

export function failingStandardIds(verdict: ReviewPanelVerdict): string[] {
  return (Object.keys(verdict.standards) as (keyof ReviewPanelVerdict['standards'])[]).filter(
    (id) => !verdict.standards[id].pass
  )
}

export function missing(what: string): Response {
  return NextResponse.json({ error: 'invalid-request', detail: `missing ${what} in run state` }, { status: 400 })
}

// Phase 3 item 1 (decision 019): folds context-gather-post's + every ad-hoc
// call's answers into one block for serializeFrame's extraContext param.
// contextGatherPre's answers are deliberately excluded — those already fold
// into frame-generate directly (route.ts's frame-generate case), so by the
// time this runs the frame itself already reflects them.
export function buildExtraContext(run: RunState): string | null {
  const parts: string[] = []
  const post = formatContextGatherAnswers(run.contextGatherPost, run.contextGatherPostAnswers)
  if (post) parts.push(post)
  for (const gather of run.adHocContextGathers ?? []) {
    const text = formatContextGatherAnswers(gather.verdict, gather.answers)
    if (text) parts.push(`${text}\n(asked while paused at: ${gather.atStep})`)
  }
  // Post-pipeline console rerun guidance (plan doc 28) — see RunStateSchema's
  // own comment on this field for why it's folded in here rather than only
  // read via masterReview.
  if (run.consoleGuidance) parts.push(`Correction from the person, mid-review:\n${run.consoleGuidance}`)
  return parts.length ? parts.join('\n\n') : null
}

// What an admin-triggered ad-hoc context-gather call (Phase 3 item 1) sees —
// whatever's accumulated so far, richest-available first. Reuses the same
// serialize* helpers every other step already calls; the closing line names
// where in the pipeline the admin paused, since CONTEXT_GATHER_BLOCK
// (prompts.ts) is otherwise layer-agnostic.
export function buildAdHocContext(run: RunState, atStep: StepId): string {
  const parts = [`Original question: ${run.originalQuery}`]
  if (run.frame) parts.push(serializeFrame(run.frame, buildExtraContext(run)))
  if (run.perspectives) parts.push(`## Vetted perspectives\n${serializePerspectives(run.perspectives)}`)
  if (run.globalAssumptions) {
    parts.push(`## Global assumptions\n${run.globalAssumptions.question_level_assumptions.join('; ')}`)
  }
  if (run.globalEvidence) {
    parts.push(`## Global evidence\n${run.globalEvidence.question_level_evidence.map((e) => e.claim_id).join('; ')}`)
  }
  if (run.conclusions) parts.push(`## Conclusions\n${run.conclusions.conclusions.join('; ')}`)
  if (run.implications) parts.push(`## Implications\n${run.implications.implications.map((i) => i.text).join('; ')}`)
  parts.push(
    `The admin has manually paused the pipeline just before "${atStep}" to ask: is there anything essential still missing or ambiguous given everything produced so far?`
  )
  return parts.join('\n\n')
}

// Renamed from degradedPerspectiveNotes (2026-09-09, Samir's spec): the 5
// hard-block layers now degrade-and-continue instead of halting
// (tryMasterReviewOrHalt, route.ts), so implications-generate's caveat list
// needs a plain-language note for each of THOSE degradations too, not just a
// per-perspective one. implicationsVerdict is deliberately NOT checked
// here — implications-generate runs before implications-review, so it
// can't know its own review outcome yet; the final-composition case handles
// that one separately (extraCaveats, orchestrator-global.ts's
// runFinalComposition).
export function degradedLayerNotes(run: RunState): string[] {
  const notes: string[] = []
  if (run.frameVerdict?.degraded) notes.push('Frame: review panel did not fully pass.')
  if (run.globalAssumptionsVerdict?.degraded) notes.push('Global assumptions: review panel did not fully pass.')
  if (run.globalEvidenceVerdict?.degraded) notes.push('Global evidence: review panel did not fully pass.')
  if (run.conclusionsVerdict?.degraded) notes.push('Conclusions: review panel did not fully pass.')
  if (run.perspectiveVerdicts) {
    notes.push(
      ...run.perspectiveVerdicts
        .map((v, i) => (v.degraded ? `${run.perspectives?.[i]?.stance_label ?? v.subject_id}: review panel did not pass` : null))
        .filter((x): x is string => x !== null)
    )
  }
  return notes
}
