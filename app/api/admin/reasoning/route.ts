// POST /api/admin/reasoning — the reasoning pipeline's step dispatcher
// (decision 019; architecture: plans/active/reasoning-pipeline/). One route,
// 17 step types, stateless: the client resends the whole accumulated run
// state every call (like /api/ai/draft's "house-so-far in" pattern) and this
// route returns only the new fields that step produced (`patch`), which the
// client merges in.
//
// maxDuration=280 (raised from 60, 2026-08-12 — Samir, root-causing "the
// pipeline consistently stops on perspectives-generate or global-
// assumptions" on real Vercel Hobby traffic): CONFIRMED live in the Vercel
// dashboard — Fluid Compute is enabled on this project, which raises Hobby's
// real ceiling to 300s (was mistakenly assumed to be a flat 60s; the old 60s
// was this codebase's own self-imposed number, not something Hobby actually
// required — see Vercel's function-duration docs). 280 leaves ~20s under
// that real 300s ceiling for Vercel's own per-invocation overhead. See
// lib/ai/router.ts's CHAIN_DEADLINE_MS and lib/ai/router-lanes.ts's
// DEEPINFRA_SWARM_TIMEOUT_MS/DEEPINFRA_SWARM_LARGE_TIMEOUT_MS, all kept in
// lockstep with this number — none may promise more than this route can
// honor. Full real-verified diagnosis:
// plans/active/reasoning-pipeline/20-deepinfra-tuning-real-verification.md's
// addendum. A review-gated layer is always split into two steps (generate,
// review) — and Perspectives generation into two more — so a single request
// never chains two dependent completeJSON-latency-bounded batches. See
// lib/ai/reasoning/steps.ts.
//
// Admin-only (403 before any quota is spent).

import { NextResponse, after } from 'next/server'
import { AiError, drafterLaneStress } from '@/lib/ai/router'
import { isCallerAdmin } from '@/lib/auth/admin'
import { log } from '@/lib/log'
import { type StepId, STEP_FAILURE_MODE, type PipelineMode, nextStepForMode, isReviewStep } from '@/lib/ai/reasoning/steps'
import { MAX_N_PHASE1, MAX_REGENERATION_ATTEMPTS, clampNForStress } from '@/lib/ai/reasoning/budget'
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
import { runMasterReview } from '@/lib/ai/reasoning/orchestrator-panel'
import { persistRunStep, runStatusFrom } from '@/lib/ai/reasoning/persistence'
import {
  RequestSchema,
  failingStandardIds,
  missing,
  buildExtraContext,
  buildAdHocContext,
  degradedPerspectiveNotes,
} from './route-schema'

export const maxDuration = 280

// Larger than the draft route's 100KB — this run state accumulates n
// perspective bundles plus every packet/verdict produced so far, not one house.
const MAX_BODY_BYTES = 300 * 1024

export async function POST(req: Request): Promise<Response> {
  if (!(await isCallerAdmin())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload-too-large' }, { status: 413 })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(json)
  if (!parsed.success) {
    // Was just { error: 'invalid-request' } with parsed.error thrown away —
    // 2026-08-20, real-verified live: a genuine RunState shape bug (evidence
    // array over its cap, contracts.ts) surfaced as this exact response with
    // zero field-level info, costing real diagnostic effort (client-side
    // fetch interception + a hand-written validator was the only way to find
    // it). issues is Zod's own path+message per violation — safe to return:
    // it describes the shape of what the CALLER already sent, not new data.
    return NextResponse.json(
      {
        error: 'invalid-request',
        detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 }
    )
  }
  const { step, run, runId, atStep } = parsed.data
  const dryRun = parsed.data.dryRun ?? false
  const panelsOff = parsed.data.panelsOff ?? false
  const capN = parsed.data.capN ?? MAX_N_PHASE1
  const attempt = parsed.data.attempt ?? 1
  const devForceNeedsInput = parsed.data.devForceNeedsInput ?? false
  // Express Mode (2026-09-02): the 7-step variant (see steps.ts's
  // EXPRESS_STEP_ORDER) — 'thorough' is the original 22-step pipeline and
  // stays the default for every existing caller that has never sent `mode`.
  const mode: PipelineMode = parsed.data.mode ?? 'thorough'
  // Phase 3 item 1's confirmed re-contextualization mechanism: context-gather-
  // post's + any ad-hoc calls' answers so far, folded into one block threaded
  // through every downstream generate/review call via serializeFrame's
  // extraContext param. Computed once per request since it doesn't depend on
  // which step is running.
  const extraContext = buildExtraContext(run)

  // Persistence (Phase 2 item 1, decision 019): every real (non-dry-run) step
  // response upserts the full merged run state — not just on completion, so a
  // halted run is captured too. See lib/ai/reasoning/persistence.ts and
  // 15-persistence.md. Nested (rather than module-level) so it closes over
  // this request's `run`/`runId`/`dryRun` without threading them through
  // every one of ok/retryStep/halted's ~15 call sites below.
  //
  // Scheduled via next/server's after() (2026-08-14, Samir/Claude — see the
  // Past Runs investigation this same session: most historical rows sit
  // frozen at some earlier step instead of their true last one, and the
  // 502 catch-all's own persist call — added moments earlier this session —
  // wasn't landing either). This used to be `void persistRunStep(...)`, a
  // genuinely untracked fire-and-forget: the route returns its
  // NextResponse.json(...) immediately after calling persist(), and Vercel's
  // serverless runtime is free to freeze the invocation right after the
  // response is flushed — there's no contractual guarantee an unawaited
  // promise's own network round-trip to Supabase finishes first. after()
  // is exactly Vercel/Next's answer to this: it defers the callback until
  // the response has been sent, but keeps the invocation alive until the
  // callback's own promise settles, so the write can no longer lose that
  // race. persistRunStep itself is unchanged — still never throws into the
  // caller (its own try/catch), so a genuine Supabase-side failure remains
  // exactly as non-fatal to the pipeline as before; this only fixes the
  // platform-timing loss, not add new failure handling.
  function persist(patchStep: StepId, patch: Record<string, unknown>, nextStep: StepId | null, isHalted: boolean, haltReason?: string): void {
    if (dryRun) return
    after(() =>
      // houseId/isCandidate stay null/false — same as every existing
      // admin-route call (see 0038's own comment: admin-triggered runs are
      // house_id: null exactly as before that column existed); `mode` is
      // this request's, threaded through so Past Runs can tell an express
      // run from a thorough one without parsing run_state.
      persistRunStep(
        runId,
        run.originalQuery,
        { ...run, ...patch },
        patchStep,
        runStatusFrom(nextStep, isHalted),
        haltReason,
        panelsOff,
        null,
        false,
        mode
      )
    )
  }

  function ok(step: StepId, patch: Record<string, unknown>): Response {
    const nextStep = nextStepForMode(step, mode)
    persist(step, patch, nextStep, false)
    return NextResponse.json({ step, patch, nextStep, halted: false })
  }

  // Shared by all 4 perspectives fan-out steps (generate-details, the 3
  // evidence steps) — 2026-08-13, Samir: make WHICH sub-element(s), for
  // WHICH perspective(s), failed durable and client-visible, not just a
  // line in Vercel's own logs (Hobby's 1-hour retention already cost real
  // debugging time this session — see doc 23). Persisted even though this
  // isn't a genuine hard-block halt (nextStep stays `step` itself — Retry
  // just re-attempts it) so it survives past this one response and shows up
  // in Past Runs too.
  function perspectivesFanOutFailure(step: StepId, err: PerspectivesGenerateError): Response {
    log.error('ai/reasoning/route', `${step} sub-element failure`, { failures: err.failures })
    persist(step, { lastSubElementFailures: err.failures }, step, false)
    return NextResponse.json({ error: 'ai-upstream-error', subElementFailures: err.failures }, { status: 502 })
  }

  // A failed panel verdict with regenerations still available: loop the client
  // back to `generateStep` (NOT the linear nextStep) instead of halting. The
  // client just follows whatever `nextStep` a response carries, so looping
  // backward needs no special client-side case — but it DOES need `retry:
  // true` to know to increment its attempt counter rather than reset it (see
  // ReasoningPipelinePage.tsx) — two review steps in the same STEP_ORDER
  // position (a fresh pass vs. a loop-back) would otherwise be indistinguishable.
  function retryStep(step: StepId, generateStep: StepId, patch: Record<string, unknown>): Response {
    // Express mode has no review panels (steps.ts's EXPRESS_STEP_ORDER omits
    // every *-review step), so nothing in this route should ever call
    // retryStep() for an express run — the client can't even send a review
    // step. Defensive only: guards against a future bug (or a malformed
    // client request) reaching this path under mode: 'express' anyway.
    if (mode === 'express' && isReviewStep(step)) {
      log.error('ai/reasoning/route', 'retryStep called for a review step in express mode', { step })
      return NextResponse.json(
        { error: 'invalid-request', detail: `${step} has no review panel in express mode` },
        { status: 400 }
      )
    }
    persist(step, patch, generateStep, false)
    return NextResponse.json({ step, patch, nextStep: generateStep, halted: false, retry: true })
  }

  // Only called for steps whose failure mode is 'hard-block' (steps.ts) once
  // MAX_REGENERATION_ATTEMPTS is exhausted; the dev-time check below guards
  // against a future edit adding a case here without updating
  // STEP_FAILURE_MODE, or vice versa.
  function halted(step: StepId, verdict: ReviewPanelVerdict, patch: Record<string, unknown>): Response {
    if (STEP_FAILURE_MODE[step] !== 'hard-block') {
      log.error('ai/reasoning/route', 'halted() called on a non-hard-block step', { step })
    }
    const failing = failingStandardIds(verdict)
    // attempt reflects however many tries this actually took — MAX_REGENERATION_ATTEMPTS
    // normally, or MASTER_REVIEW_ATTEMPT when the one master-guided try also failed
    // (tryMasterReviewOrHalt below).
    const haltReason = `${step} failed review after ${attempt} attempt${attempt === 1 ? '' : 's'}${run.masterReview?.forStep === step ? ' (including one master-reviewer-guided attempt)' : ''} — ${failing.length}/9 standards still failing (${failing.join(', ')}).`
    persist(step, patch, null, true, haltReason)
    return NextResponse.json({ step, patch, nextStep: null, halted: true, haltReason })
  }

  // Called instead of halted() when a hard-block layer's review still fails
  // at attempt === MAX_REGENERATION_ATTEMPTS (2026-08-11 addendum to 03-
  // orchestration-and-failure-handling.md): one last, master-guided attempt
  // before genuinely halting. A master reviewer sees all 9 standard verdicts
  // TOGETHER — something no single standard-reviewer does (orchestrator-
  // panel.ts's runReviewPanel, deliberately blind) — looks for a genuine
  // contradiction between them, and synthesizes one clear set of instructions
  // for the next *-generate call (via masterGuidance, threaded through the
  // matching generate case below) to follow instead of the raw 9-note dump.
  // Fires at most once per layer per run: run.masterReview.forStep already
  // matching `step` means this WAS that one extra attempt and it failed too
  // — no more chances, halt for real instead of looping forever.
  async function tryMasterReviewOrHalt(
    step: StepId,
    generateStep: StepId,
    artifact: unknown,
    verdict: ReviewPanelVerdict,
    context: string,
    patch: Record<string, unknown>
  ): Promise<Response> {
    if (run.masterReview?.forStep === step) {
      return halted(step, verdict, patch)
    }
    const guidance = await runMasterReview(verdict, artifact, context, dryRun)
    return retryStep(step, generateStep, { ...patch, masterReview: { forStep: step, guidance } })
  }

  try {
    // Phase 3 item 1's ad-hoc path: admin-triggered, not part of STEP_ORDER's
    // linear advance — handled before the switch below since it shares this
    // route's error handling but not ok()/retryStep()/halted()'s nextStep
    // semantics (there is no "next step" for an aside).
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
            { frameVerdict: verdict }
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
        // Phase 2 dynamic budget enforcement (03-orchestration-and-failure-
        // handling.md "Budget enforcement"): shrink n below what the client
        // requested when the drafter lane is already under detected live
        // pressure, rather than starting a large fan-out into a lane that's
        // cascading. See drafterLaneStress() (lib/ai/router-state.ts).
        const stress = drafterLaneStress()
        const effectiveN = clampNForStress(capN, stress)
        if (effectiveN !== capN) {
          log.warn('ai/reasoning/route', 'drafter lane under stress — shrinking n pre-flight', {
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
          // Clear any stale failure record from a prior failed attempt at
          // this step — this one succeeded.
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
            repair,
            extraContext
          )
          // Only the units that actually asked something (Phase 3 item 1's
          // pattern, extended to n independent units) — the client pauses
          // exactly when this is non-empty, same idea as ContextGatherVerdict's
          // needs_user_input but per-perspective.
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
          // The one place all three generate-side threads (details,
          // strategy, populate) actually come together — see
          // runPerspectivesEvidenceConfidence's own comment.
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
        // Degrade-and-continue, per bundle: a bundle whose verdict still
        // fails after MAX_REGENERATION_ATTEMPTS is marked degraded, but a
        // bundle with retries left loops the WHOLE step back to regenerate
        // (details → evidence strategy/populate/confidence again) — never
        // halts, even if every bundle is currently failing.
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
            { globalAssumptionsVerdict: verdict }
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
          repair,
          extraContext,
          masterGuidance
        )
        // Same idea as ContextGatherVerdict's needs_user_input, just scoped
        // to this one question-level unit (unitId 'global') instead of n
        // per-perspective ones — the client pauses exactly when this is set.
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
            { globalEvidenceVerdict: verdict }
          )
        }
        return ok(step, { globalEvidenceVerdict: verdict })
      }

      case 'conclusions-generate': {
        // Express mode (EXPRESS_STEP_ORDER, steps.ts) has no
        // perspectives-evidence-* or perspectives-review steps, so
        // run.perspectives (the evidence-bearing bundles set by
        // perspectives-evidence-confidence) is never populated — fall back
        // to perspectivePartials (the same bundle shape minus `evidence`,
        // PerspectivePartialBundleSchema) with an empty evidence array.
        // Express also has no global-assumptions/global-evidence layers at
        // all — runConclusionsGenerate treats both as optional and omits
        // their context sections when absent (orchestrator-global.ts).
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
        // Express mode never runs global-assumptions or global-evidence steps, so
        // both fields are undefined. Provide empty fallbacks — the orchestrator
        // serialises them into the context string; empty arrays produce no items.
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
            { conclusionsVerdict: verdict }
          )
        }
        return ok(step, { conclusionsVerdict: verdict })
      }

      case 'implications-generate': {
        if (!run.frame || !run.conclusions) return missing('frame/conclusions')
        const degradedNotes = degradedPerspectiveNotes(run)
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
            { implicationsVerdict: verdict }
          )
        }
        return ok(step, { implicationsVerdict: verdict })
      }

      case 'final-composition': {
        if (!run.frame || !run.conclusions || !run.implications) return missing('frame/conclusions/implications')
        const finalAnswer = await runFinalComposition(run.frame, run.conclusions, run.implications, dryRun, extraContext)
        return ok(step, { finalAnswer })
      }

      default:
        return NextResponse.json({ error: 'invalid-request', detail: 'unknown step' }, { status: 400 })
    }
  } catch (err) {
    // 2026-08-14, Samir: every other failure path in this route (halted(),
    // retryStep(), perspectivesFanOutFailure()) persists before responding —
    // this catch-all was the one gap. An AiError or any other unhandled
    // throw (upstream 5xx, timeout, network error) used to return straight
    // to the client with no DB write at all, leaving the run frozen at
    // whatever `status`/`lastStep` its last successful step left it in —
    // forever indistinguishable from "still genuinely in progress" in Past
    // Runs. Same non-hard-block shape as perspectivesFanOutFailure: nextStep
    // stays the step itself (Retry re-attempts it, no special client case),
    // just with haltReason now durable instead of silently dropped.
    const patchStep = step === 'context-gather-adhoc' ? atStep : step
    const message = err instanceof AiError ? err.message : (err as Error)?.message || 'unknown error'
    if (patchStep) persist(patchStep, {}, patchStep, false, `${patchStep} threw: ${message}`)
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    log.error('ai/reasoning/route', 'unhandled error', { step, error: message })
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }
}
