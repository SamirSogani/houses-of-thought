// The reasoning pipeline's per-step dispatch for the house-scoped route
// (app/api/houses/[id]/reasoning/route.ts). Split out of that file once it
// passed the repo's ~600-line guideline; it is the same switch, moved, not a
// rewrite.
//
// Every case body is UNCHANGED. The route's POST builds the per-request
// values and closure helpers exactly as before and hands them over as one
// context object, which dispatchStep destructures back into the same
// identifiers the cases already used — so a case reads `run`, `ok(...)`,
// `persist(...)` here exactly as it did inline. That is deliberate: this
// file is the least-tested, most expensive-to-exercise code in the product
// (a real run costs money and minutes), so the split was done in the one
// shape that cannot change behaviour. None of the destructured values is
// ever reassigned inside the switch, which is what makes that safe.
//
// The helpers stay defined in the route because they close over things the
// dispatch has no business knowing — houseId, runId, isCandidate, the
// after() persistence hook. They arrive here already bound.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { drafterLaneStress } from '@/lib/ai/router'
import { log } from '@/lib/log'
import { type StepId, type PipelineMode } from '@/lib/ai/reasoning/steps'
import { MAX_REGENERATION_ATTEMPTS, clampNForStress } from '@/lib/ai/reasoning/budget'
import { serializeFrame, formatContextGatherAnswers } from '@/lib/ai/reasoning/prompts'
import { type ReviewPanelVerdict } from '@/lib/ai/reasoning/contracts'
import {
  runContextGather,
  runFrameGenerate,
  runFrameReview,
  runBreadthScoping,
} from '@/lib/ai/reasoning/orchestrator-setup'
import {
  runPerspectivesGenerateStances,
  runPerspectivesGenerateDetails,
  runPerspectivesEvidenceStrategy,
  runPerspectivesEvidencePopulate,
  runPerspectivesEvidenceConfidence,
  runPerspectivesReview,
  PerspectivesGenerateError,
  collectEvidenceGatherUnits,
  flattenEvidenceGatherAnswers,
} from '@/lib/ai/reasoning/orchestrator-perspectives'
import {
  runGlobalAssumptionsGenerate,
  runGlobalAssumptionsReview,
  runGlobalEvidenceStrategy,
  runGlobalEvidencePopulate,
  runGlobalEvidenceConfidence,
  runGlobalEvidenceReview,
  runConclusionsGenerate,
  runConclusionsReview,
  runImplicationsGenerate,
  runImplicationsReview,
  runFinalComposition,
  questionContext,
} from '@/lib/ai/reasoning/orchestrator-global'
import {
  RequestSchema,
  missing,
  buildAdHocContext,
  degradedLayerNotes,
} from '@/app/api/admin/reasoning/route-schema'

// Derived from the route's own request schema rather than hand-written, so
// these can never drift from what POST actually parses — `step` is wider
// than StepId (it also admits 'context-gather-adhoc') and `atStep` is
// nullish, both of which a hand-written StepId would have got wrong.
type ReasoningRequestBody = z.infer<typeof RequestSchema>

export interface StepDispatchContext {
  step: ReasoningRequestBody['step']
  run: ReasoningRequestBody['run']
  runId: ReasoningRequestBody['runId']
  atStep: ReasoningRequestBody['atStep']
  dryRun: boolean
  panelsOff: boolean
  capN: number
  attempt: number
  devForceNeedsInput: boolean
  extraContext: string | null
  // Express Mode (plan doc 32): the dispatch needs to know this for the
  // conclusions-generate case, which must fall back to perspectivePartials
  // when run.perspectives is absent (express skips evidence + review).
  mode: PipelineMode
  ok: (step: StepId, patch: Record<string, unknown>) => Response
  persist: (patchStep: StepId, patch: Record<string, unknown>, nextStep: StepId | null, isHalted: boolean, haltReason?: string) => void
  retryStep: (step: StepId, generateStep: StepId, patch: Record<string, unknown>) => Response
  perspectivesFanOutFailure: (step: StepId, err: PerspectivesGenerateError) => Response
  // verdictField (was `patch: Record<string, unknown>`, 2026-09-09, Samir's
  // spec) — see route.ts's tryMasterReviewOrHalt for why: the 5 hard-block
  // layers now degrade-and-continue instead of halting, and both branches
  // need to write `{ [verdictField]: ... }`, so the field name travels
  // instead of a whole pre-built patch object.
  tryMasterReviewOrHalt: (
    step: StepId,
    generateStep: StepId,
    artifact: unknown,
    verdict: ReviewPanelVerdict,
    context: string,
    verdictField: string
  ) => Promise<Response>
}

export async function dispatchStep(ctx: StepDispatchContext): Promise<Response> {
  const {
    step,
    run,
    atStep,
    dryRun,
    panelsOff,
    capN,
    attempt,
    devForceNeedsInput,
    extraContext,
    mode,
    ok,
    persist,
    retryStep,
    perspectivesFanOutFailure,
    tryMasterReviewOrHalt,
  } = ctx

    if (step === 'context-gather-adhoc') {
      if (!atStep) return missing('atStep')
      const context = buildAdHocContext(run, atStep)
      const verdict = await runContextGather(context, dryRun, devForceNeedsInput)
      const adHocContextGathers = [...(run.adHocContextGathers ?? []), { atStep, verdict, answers: null }]
      persist(atStep, { adHocContextGathers }, atStep, false)
      return NextResponse.json({ step, patch: { adHocContextGathers }, nextStep: null, halted: false })
    }

    switch (step) {
      case 'context-gather-pre': {
        const verdict = await runContextGather(`Original question: ${run.originalQuery}`, dryRun, devForceNeedsInput)
        return ok(step, { contextGatherPre: verdict })
      }

      case 'frame-generate': {
        const masterGuidance =
          run.masterReview?.forStep === 'frame-review' && run.frame
            ? { priorFrame: run.frame, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.frame && run.frameVerdict && !run.frameVerdict.overall_pass
            ? { priorFrame: run.frame, priorVerdict: run.frameVerdict }
            : undefined
        const userAnswers = formatContextGatherAnswers(run.contextGatherPre, run.contextGatherPreAnswers)
        const frame = await runFrameGenerate(run.originalQuery, dryRun, repair, userAnswers, masterGuidance)
        return ok(step, { frame })
      }

      case 'frame-review': {
        if (!run.frame) return missing('frame')
        const verdict = await runFrameReview(run.frame, dryRun, panelsOff)
        if (!verdict.overall_pass) {
          if (attempt < MAX_REGENERATION_ATTEMPTS) return retryStep(step, 'frame-generate', { frameVerdict: verdict })
          return tryMasterReviewOrHalt(
            step,
            'frame-generate',
            run.frame,
            verdict,
            `Original question: ${run.frame.original_query}`,
            'frameVerdict'
          )
        }
        return ok(step, { frameVerdict: verdict })
      }

      case 'context-gather-post': {
        if (!run.frame) return missing('frame')
        const verdict = await runContextGather(
          `${serializeFrame(run.frame, extraContext)}\n\nIs this frame complete enough to proceed?`,
          dryRun,
          devForceNeedsInput
        )
        return ok(step, { contextGatherPost: verdict })
      }

      case 'breadth-scoping': {
        if (!run.frame) return missing('frame')
        const stress = drafterLaneStress()
        const effectiveN = clampNForStress(capN, stress)
        if (effectiveN !== capN) {
          log.warn('houses/reasoning', 'drafter lane under stress — shrinking n pre-flight', {
            stress,
            requestedN: capN,
            effectiveN,
          })
        }
        const scoping = await runBreadthScoping(run.frame, effectiveN, dryRun, extraContext)
        return ok(step, { breadthScoping: scoping })
      }

      case 'perspectives-generate-stances': {
        if (!run.frame || !run.breadthScoping) return missing('frame/breadthScoping')
        const stances = await runPerspectivesGenerateStances(run.frame, run.breadthScoping, dryRun, extraContext)
        return ok(step, { perspectiveStances: stances })
      }

      case 'perspectives-generate-details': {
        if (!run.frame || !run.perspectiveStances) return missing('frame/perspectiveStances')
        const repair =
          run.perspectivePartials && run.perspectiveVerdicts
            ? {
                priorPartials: run.perspectivePartials,
                priorVerdicts: run.perspectiveVerdicts,
                priorAttempts: run.perspectiveAttempts ?? run.perspectiveStances.map(() => 1),
              }
            : undefined
        try {
          const partials = await runPerspectivesGenerateDetails(run.frame, run.perspectiveStances, dryRun, repair, extraContext)
          return ok(step, { perspectivePartials: partials, lastSubElementFailures: null })
        } catch (err) {
          if (err instanceof PerspectivesGenerateError) {
            return perspectivesFanOutFailure(step, err)
          }
          throw err
        }
      }

      case 'perspectives-evidence-strategy': {
        if (!run.frame || !run.perspectiveStances || !run.perspectivePartials) {
          return missing('frame/perspectiveStances/perspectivePartials')
        }
        const repair =
          run.perspectiveEvidenceStrategies && run.perspectiveVerdicts
            ? {
                priorStrategies: run.perspectiveEvidenceStrategies,
                priorPartials: run.perspectivePartials,
                priorVerdicts: run.perspectiveVerdicts,
              }
            : undefined
        try {
          const strategies = await runPerspectivesEvidenceStrategy(
            run.frame,
            run.perspectiveStances,
            dryRun,
            devForceNeedsInput,
            // 2026-09-09, Samir's spec — see route-schema.ts's
            // perspectiveEvidenceGatherHistory comment for why this exists.
            run.perspectiveEvidenceGatherHistory,
            repair,
            extraContext
          )
          const units = collectEvidenceGatherUnits(run.perspectiveStances, strategies)
          return ok(step, {
            perspectiveEvidenceStrategies: strategies,
            perspectiveEvidenceGatherUnits: units.length ? units : null,
            perspectiveEvidenceGatherAnswers: units.length ? units.map(() => null) : null,
            lastSubElementFailures: null,
          })
        } catch (err) {
          if (err instanceof PerspectivesGenerateError) {
            return perspectivesFanOutFailure(step, err)
          }
          throw err
        }
      }

      case 'perspectives-evidence-populate': {
        if (!run.frame || !run.perspectiveStances || !run.perspectivePartials || !run.perspectiveEvidenceStrategies) {
          return missing('frame/perspectiveStances/perspectivePartials/perspectiveEvidenceStrategies')
        }
        const userAnswers =
          run.perspectiveEvidenceGatherUnits && run.perspectiveEvidenceGatherAnswers
            ? flattenEvidenceGatherAnswers(run.perspectiveStances, run.perspectiveEvidenceGatherUnits, run.perspectiveEvidenceGatherAnswers)
            : null
        const repair =
          run.perspectiveEvidenceDrafts && run.perspectiveVerdicts
            ? {
                priorDrafts: run.perspectiveEvidenceDrafts,
                priorPartials: run.perspectivePartials,
                priorVerdicts: run.perspectiveVerdicts,
              }
            : undefined
        try {
          const drafts = await runPerspectivesEvidencePopulate(
            run.frame,
            run.perspectiveStances,
            run.perspectiveEvidenceStrategies,
            userAnswers,
            dryRun,
            repair,
            extraContext
          )
          return ok(step, { perspectiveEvidenceDrafts: drafts, lastSubElementFailures: null })
        } catch (err) {
          if (err instanceof PerspectivesGenerateError) {
            return perspectivesFanOutFailure(step, err)
          }
          throw err
        }
      }

      case 'perspectives-evidence-confidence': {
        if (!run.frame || !run.perspectiveStances || !run.perspectivePartials || !run.perspectiveEvidenceDrafts) {
          return missing('frame/perspectiveStances/perspectivePartials/perspectiveEvidenceDrafts')
        }
        const repair =
          run.perspectives && run.perspectiveVerdicts
            ? {
                priorBundles: run.perspectives,
                priorVerdicts: run.perspectiveVerdicts,
                priorAttempts: run.perspectiveAttempts ?? run.perspectiveStances.map(() => 1),
              }
            : undefined
        try {
          const { bundles, attempts } = await runPerspectivesEvidenceConfidence(
            run.frame,
            run.perspectiveStances,
            run.perspectivePartials,
            run.perspectiveEvidenceDrafts,
            dryRun,
            repair,
            extraContext
          )
          return ok(step, { perspectives: bundles, perspectiveAttempts: attempts, lastSubElementFailures: null })
        } catch (err) {
          if (err instanceof PerspectivesGenerateError) {
            return perspectivesFanOutFailure(step, err)
          }
          throw err
        }
      }

      case 'perspectives-review': {
        if (!run.frame || !run.perspectives) return missing('frame/perspectives')
        const verdicts = await runPerspectivesReview(
          run.frame,
          run.perspectives,
          run.perspectiveVerdicts ?? null,
          run.perspectiveAttempts ?? null,
          dryRun,
          panelsOff,
          extraContext
        )
        const stillRetrying = verdicts.some((v) => !v.overall_pass && !v.degraded)
        if (stillRetrying) return retryStep(step, 'perspectives-generate-details', { perspectiveVerdicts: verdicts })
        return ok(step, { perspectiveVerdicts: verdicts })
      }

      case 'global-assumptions-generate': {
        if (!run.frame || !run.perspectives) return missing('frame/perspectives')
        const masterGuidance =
          run.masterReview?.forStep === 'global-assumptions-review' && run.globalAssumptions
            ? { priorArtifact: run.globalAssumptions, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.globalAssumptions && run.globalAssumptionsVerdict && !run.globalAssumptionsVerdict.overall_pass
            ? { priorArtifact: run.globalAssumptions, priorVerdict: run.globalAssumptionsVerdict }
            : undefined
        const packet = await runGlobalAssumptionsGenerate(run.frame, run.perspectives, dryRun, repair, extraContext, masterGuidance)
        return ok(step, { globalAssumptions: packet })
      }

      case 'global-assumptions-review': {
        if (!run.frame || !run.perspectives || !run.globalAssumptions) return missing('frame/perspectives/globalAssumptions')
        const verdict = await runGlobalAssumptionsReview(
          run.frame,
          run.perspectives,
          run.globalAssumptions,
          dryRun,
          panelsOff,
          extraContext
        )
        if (!verdict.overall_pass) {
          if (attempt < MAX_REGENERATION_ATTEMPTS) {
            return retryStep(step, 'global-assumptions-generate', { globalAssumptionsVerdict: verdict })
          }
          return tryMasterReviewOrHalt(
            step,
            'global-assumptions-generate',
            run.globalAssumptions,
            verdict,
            questionContext(run.frame, run.perspectives, extraContext),
            'globalAssumptionsVerdict'
          )
        }
        return ok(step, { globalAssumptionsVerdict: verdict })
      }

      case 'global-evidence-strategy': {
        if (!run.frame || !run.perspectives) return missing('frame/perspectives')
        const masterGuidance =
          run.masterReview?.forStep === 'global-evidence-review' && run.globalEvidence
            ? { priorArtifact: run.globalEvidence, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.globalEvidence && run.globalEvidenceVerdict && !run.globalEvidenceVerdict.overall_pass
            ? { priorArtifact: run.globalEvidence, priorVerdict: run.globalEvidenceVerdict }
            : undefined
        const strategy = await runGlobalEvidenceStrategy(
          run.frame,
          run.perspectives,
          dryRun,
          devForceNeedsInput,
          // 2026-09-09, Samir's spec — see route-schema.ts's
          // globalEvidenceGatherHistory comment for why this exists.
          run.globalEvidenceGatherHistory,
          repair,
          extraContext,
          masterGuidance
        )
        const unit = strategy.needs_user_input
          ? { unitId: 'global', unitLabel: 'Global evidence', reason: strategy.reason, questions: strategy.questions_for_user }
          : null
        return ok(step, {
          globalEvidenceStrategy: strategy,
          globalEvidenceGatherUnit: unit,
          globalEvidenceGatherAnswer: null,
        })
      }

      case 'global-evidence-populate': {
        if (!run.frame || !run.perspectives || !run.globalEvidenceStrategy) {
          return missing('frame/perspectives/globalEvidenceStrategy')
        }
        const masterGuidance =
          run.masterReview?.forStep === 'global-evidence-review' && run.globalEvidence
            ? { priorArtifact: run.globalEvidence, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.globalEvidence && run.globalEvidenceVerdict && !run.globalEvidenceVerdict.overall_pass
            ? { priorArtifact: run.globalEvidence, priorVerdict: run.globalEvidenceVerdict }
            : undefined
        const userAnswer = run.globalEvidenceGatherAnswer?.find((a) => a != null) ?? null
        const draft = await runGlobalEvidencePopulate(
          run.frame,
          run.perspectives,
          run.globalEvidenceStrategy,
          userAnswer,
          dryRun,
          repair,
          extraContext,
          masterGuidance
        )
        return ok(step, { globalEvidenceDraft: draft })
      }

      case 'global-evidence-confidence': {
        if (!run.frame || !run.globalEvidenceDraft) return missing('frame/globalEvidenceDraft')
        const masterGuidance =
          run.masterReview?.forStep === 'global-evidence-review' && run.globalEvidence
            ? { priorArtifact: run.globalEvidence, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.globalEvidence && run.globalEvidenceVerdict && !run.globalEvidenceVerdict.overall_pass
            ? { priorArtifact: run.globalEvidence, priorVerdict: run.globalEvidenceVerdict }
            : undefined
        const packet = await runGlobalEvidenceConfidence(run.frame, run.globalEvidenceDraft, dryRun, repair, extraContext, masterGuidance)
        return ok(step, { globalEvidence: packet })
      }

      case 'global-evidence-review': {
        if (!run.frame || !run.globalEvidence) return missing('frame/globalEvidence')
        const verdict = await runGlobalEvidenceReview(run.frame, run.globalEvidence, dryRun, panelsOff, extraContext)
        if (!verdict.overall_pass) {
          if (attempt < MAX_REGENERATION_ATTEMPTS) {
            return retryStep(step, 'global-evidence-strategy', { globalEvidenceVerdict: verdict })
          }
          return tryMasterReviewOrHalt(
            step,
            'global-evidence-strategy',
            run.globalEvidence,
            verdict,
            serializeFrame(run.frame, extraContext),
            'globalEvidenceVerdict'
          )
        }
        return ok(step, { globalEvidenceVerdict: verdict })
      }

      case 'conclusions-generate': {
        // Express mode (EXPRESS_STEP_ORDER, steps.ts) has no
        // perspectives-evidence-* or perspectives-review steps, so
        // run.perspectives (the evidence-bearing bundles set by
        // perspectives-evidence-confidence) is never populated — fall back
        // to perspectivePartials (same bundle shape minus `evidence`) with
        // an empty evidence array. Express also has no global-assumptions/
        // global-evidence layers — runConclusionsGenerate treats both as
        // optional and omits their context sections when absent.
        const perspectivesForConclusions =
          run.perspectives ??
          (mode === 'express' && run.perspectivePartials
            ? run.perspectivePartials.map((p) => ({ ...p, evidence: [] }))
            : undefined)
        if (!run.frame || !perspectivesForConclusions) return missing('frame/perspectives')
        if (mode === 'thorough' && (!run.globalAssumptions || !run.globalEvidence)) {
          return missing('frame/perspectives/globalAssumptions/globalEvidence')
        }
        const masterGuidance =
          run.masterReview?.forStep === 'conclusions-review' && run.conclusions
            ? { priorArtifact: run.conclusions, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.conclusions && run.conclusionsVerdict && !run.conclusionsVerdict.overall_pass
            ? { priorArtifact: run.conclusions, priorVerdict: run.conclusionsVerdict }
            : undefined
        // Express mode never runs global-assumptions or global-evidence steps,
        // so both fields are undefined. Provide empty fallbacks — the
        // orchestrator serialises them into the context string.
        const ga = run.globalAssumptions ?? { question_level_assumptions: [], cross_perspective_notes: '' }
        const ge = run.globalEvidence ?? { question_level_evidence: [] }
        const packet = await runConclusionsGenerate(
          run.frame,
          perspectivesForConclusions,
          ga,
          ge,
          dryRun,
          repair,
          extraContext,
          masterGuidance
        )
        return ok(step, { conclusions: packet })
      }

      case 'conclusions-review': {
        if (!run.frame || !run.conclusions) return missing('frame/conclusions')
        const verdict = await runConclusionsReview(run.frame, run.conclusions, dryRun, panelsOff, extraContext)
        if (!verdict.overall_pass) {
          if (attempt < MAX_REGENERATION_ATTEMPTS) {
            return retryStep(step, 'conclusions-generate', { conclusionsVerdict: verdict })
          }
          return tryMasterReviewOrHalt(
            step,
            'conclusions-generate',
            run.conclusions,
            verdict,
            serializeFrame(run.frame, extraContext),
            'conclusionsVerdict'
          )
        }
        return ok(step, { conclusionsVerdict: verdict })
      }

      case 'implications-generate': {
        if (!run.frame || !run.conclusions) return missing('frame/conclusions')
        const degradedNotes = degradedLayerNotes(run)
        const masterGuidance =
          run.masterReview?.forStep === 'implications-review' && run.implications
            ? { priorArtifact: run.implications, guidance: run.masterReview.guidance }
            : undefined
        const repair =
          !masterGuidance && run.implications && run.implicationsVerdict && !run.implicationsVerdict.overall_pass
            ? { priorArtifact: run.implications, priorVerdict: run.implicationsVerdict }
            : undefined
        const packet = await runImplicationsGenerate(
          run.frame,
          run.conclusions,
          degradedNotes,
          dryRun,
          repair,
          extraContext,
          masterGuidance
        )
        return ok(step, { implications: packet })
      }

      case 'implications-review': {
        if (!run.frame || !run.implications) return missing('frame/implications')
        const verdict = await runImplicationsReview(run.frame, run.implications, dryRun, panelsOff, extraContext)
        if (!verdict.overall_pass) {
          if (attempt < MAX_REGENERATION_ATTEMPTS) {
            return retryStep(step, 'implications-generate', { implicationsVerdict: verdict })
          }
          return tryMasterReviewOrHalt(
            step,
            'implications-generate',
            run.implications,
            verdict,
            serializeFrame(run.frame, extraContext),
            'implicationsVerdict'
          )
        }
        return ok(step, { implicationsVerdict: verdict })
      }

      case 'final-composition': {
        if (!run.frame || !run.conclusions || !run.implications) return missing('frame/conclusions/implications')
        // 2026-09-09, Samir's spec — see route.ts's matching case for why:
        // implications-generate couldn't have known its OWN review would
        // degrade, since that review hadn't run yet.
        const extraCaveats = run.implicationsVerdict?.degraded ? ['Implications: review panel did not fully pass.'] : undefined
        const finalAnswer = await runFinalComposition(run.frame, run.conclusions, run.implications, dryRun, extraCaveats, extraContext)
        return ok(step, { finalAnswer })
      }

      default:
        return NextResponse.json({ error: 'invalid-request', detail: 'unknown step' }, { status: 400 })
    }
}
