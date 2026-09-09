'use client'

// House-scoped reasoning pipeline's client stage loop (plan doc
// plans/active/reasoning-pipeline/27-house-scoped-pipeline-integration.md
// §2). Adapted from components/admin/reasoning/ReasoningPipelinePage.tsx's
// step-loop effect — same "resend the whole RunState, merge the response's
// patch, advance" pattern — reshaped into a hook so it can live in
// BuildHousePage (survives tab switches / the mobile drawer closing, same
// rationale as useDraftRunner.ts) and drive the embedded
// ReasoningPipelineCard instead of a standalone admin page.
//
// Differences from the admin page's version (judgment calls, not oversights):
//  - houseId-scoped: calls POST /api/houses/[id]/reasoning, not the admin
//    route.
//  - dryRun/panelsOff/devForceNeedsInput are never exposed here — this is the
//    real thing for a real house, not a dev-testing surface.
//  - n (perspective count) is fixed at HOUSE_PIPELINE_N, not user-selectable
//    — the embedded UI has no room for (and this route has no rate limit
//    yet to justify exposing) a cost dial the way the admin form's n-picker
//    does.
//  - No ad-hoc "ask a clarifying question while paused" affordance — the
//    admin page's askClarifyingQuestion() has no equivalent here; scoped out
//    to keep the embedded surface simple. Pause/resume/reset (start over)
//    cover the same ground for a first version.
//  - On the run's genuine completion (nextStep === null, not halted), this
//    hook itself dispatches APPLY_REASONING_RESULT with the mapped actions
//    (lib/ai/reasoning/houseMapping.ts) — the admin page has no house to
//    write into, so it has nothing analogous.
//
// Loop C, sandbox reruns with a diff (plan doc
// plans/active/reasoning-pipeline/31-console-sandbox-reruns.md, Trap 3):
// rerunSandbox() is a third entry point, alongside start()/rerunFrom() —
// same shape (seed run/step/phase, let the SAME effect loop take over), but
// it marks the run as a candidate (?candidate=true on every step's fetch,
// read by app/api/houses/[id]/reasoning/route.ts to set is_candidate on the
// persisted row) and, critically, its own completion dispatches NOTHING —
// neither APPLY_REASONING_RESULT nor APPLY_RERUN_RESULT. A sandbox run must
// write to reasoning_runs (so it can be finalized into an addressable
// candidate and diffed) and NEVER to the house; ConsolePage reads
// `sandboxMode` once phase reaches 'done' to know it must finalize the
// candidate instead of saving. start()/rerunFrom() and this effect's
// existing retry/regeneration/gather handling are otherwise untouched.

import { useEffect, useRef, useState } from 'react'
import type { Action } from '@/lib/build/types'
import { isReviewStep, type StepId, type PipelineMode } from '@/lib/ai/reasoning/steps'
import { MIN_N } from '@/lib/ai/reasoning/budget'
import type { ContextGatherVerdict, EvidenceGatherUnit, SubElementFailure } from '@/lib/ai/reasoning/contracts'
import type { RunState } from '@/components/admin/reasoning/ReasoningStagesList'
import { mapReasoningRunToActions } from '@/lib/ai/reasoning/houseMapping'
import { RERUN_STAGE_INFO, cascadeStages } from '@/lib/ai/console'
import type { DraftStage } from '@/lib/ai/draft'

export type ReasoningPipelinePhase = 'idle' | 'running' | 'paused' | 'awaiting-input' | 'halted' | 'done'

export interface PendingGather {
  origin: 'pre' | 'post'
  verdict: ContextGatherVerdict
  resumeStep: StepId | null
}

export interface PendingEvidenceGather {
  kind: 'perspectives' | 'global'
  units: EvidenceGatherUnit[]
  resumeStep: StepId | null
}

interface StepResponse {
  step: StepId
  patch: Partial<RunState>
  nextStep: StepId | null
  halted: boolean
  haltReason?: string
  retry?: boolean
}

// Same bounded wait-then-retry model as the admin page (decision 019's "2
// retries/3 attempts") — see that file's comment for why this is short, not
// long: the whole loop must fit inside this route's serverless budget.
// [5_000, 15_000] -> [5_000, 15_000, 30_000, 60_000] (2026-09-09, Samir's
// spec): Samir's explicit call — real runs barely cost anything and
// multi-hour autonomous testing is expected, so err toward more automatic
// retrying before ever giving up, now that Part A's degrade-and-continue fix
// means the pipeline itself no longer dead-ends either.
const RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]
const MAX_STEP_ATTEMPTS = RATE_LIMIT_RETRY_DELAYS_MS.length + 1

// Every code here is a transient upstream/pipeline hiccup where a fresh
// attempt (a fresh model sample, a fresh connection) can plausibly succeed —
// as opposed to ai-unauthorized/ai-bad-request/ai-not-configured/
// ai-context-overflow/search-not-configured/invalid-request, which are
// genuine misconfiguration or a structurally-too-large input that retrying
// the identical request cannot fix. 2026-09-09, Samir's spec: the user asked
// that error states essentially never reach them — broadened alongside Part
// A's degrade-and-continue fix so the two together mean a visible error is
// now a real, rare, unrecoverable exception, not routine.
const TRANSIENT_ERROR_CODES = new Set(['ai-rate-limited', 'ai-upstream-error', 'ai-timeout', 'ai-invalid-output'])

// Fixed, not user-selectable — see module comment above.
const HOUSE_PIPELINE_N = MIN_N

// Formats one evidence-gather round's Q&A for a single unit, appended onto
// that unit's accumulated history (route-schema.ts's
// perspectiveEvidenceGatherHistory/globalEvidenceGatherHistory) — 2026-09-09,
// Samir's spec fix for the "model re-asks the same question 2-3 rounds in a
// row" bug: evidence-strategy previously had no memory of its own prior
// questions across a regeneration loop-back. A skipped question still gets
// logged as "(not answered)" (not omitted) so the next round can tell
// "asked, not answered" apart from "never asked" — resolvePendingEvidenceGather
// is called with all-null answers by skipPendingEvidenceGather() below, and
// that skip must land in history too, or the model would ask a third time
// thinking it never asked at all.
function appendGatherRound(priorHistory: string | null | undefined, unit: EvidenceGatherUnit, answers: (string | null)[]): string {
  const round = unit.questions.map((q, i) => `Q: ${q.question}\nA: ${answers[i] ?? '(not answered)'}`).join('\n')
  return priorHistory ? `${priorHistory}\n${round}` : round
}

export interface ReasoningPipelineRunner {
  phase: ReasoningPipelinePhase
  step: StepId | null
  run: RunState
  pendingGather: PendingGather | null
  pendingEvidenceGather: PendingEvidenceGather | null
  errorCode: string | null
  subElementFailures: SubElementFailure[] | null
  haltReason: string | null
  // reason distinguishes an upstream 429 from a client-side fetch exception
  // (2026-09-09) so the UI can show accurate copy for each — see the catch
  // block below for why a network error now retries the same way a
  // rate-limit already did.
  retryInfo: { attempt: number; waitMs: number; reason: 'rate-limited' | 'network' } | null
  regenerationInfo: { attempt: number } | null
  // Loop C (plan doc 31) — true for the run currently in `run`/`phase` iff
  // it was started via rerunSandbox(), not start()/rerunFrom(). Reactive
  // (not just an internal ref) because ConsolePage/SandboxPanel need to
  // render differently while it's true and to decide, once phase reaches
  // 'done', whether to save the house (false) or finalize a candidate
  // (true).
  sandboxMode: boolean
  // The active run's own id (minted by start()/rerunFrom()/rerunSandbox()).
  // Empty string when idle. Loop C's finalize step (POST
  // .../console/candidate) needs this to know which reasoning_runs row a
  // just-finished sandbox run wrote to.
  runId: string
  // The pipeline mode this runner uses. The public hook defaults to
  // 'thorough'; express mode is admin-only.
  mode: PipelineMode
  start: (question: string) => void
  // Post-pipeline console only (plan doc 28) — see its own comment above.
  rerunFrom: (existingRun: RunState, stage: DraftStage, reason: string, guidance: string) => void
  // Loop C (plan doc 31) — see this file's own header comment. Same
  // signature as rerunFrom; the only difference is what happens at
  // completion.
  rerunSandbox: (existingRun: RunState, stage: DraftStage, reason: string, guidance: string) => void
  pause: () => void
  resume: () => void
  reset: () => void
  resolvePendingGather: (answers: (string | null)[]) => void
  skipPendingGather: () => void
  resolvePendingEvidenceGather: (answersPerUnit: (string | null)[][]) => void
  skipPendingEvidenceGather: () => void
}

export function useReasoningPipelineRunner(
  dispatch: React.Dispatch<Action>,
  houseId: string | undefined,
  mode: PipelineMode = 'thorough'
): ReasoningPipelineRunner {
  const [phase, setPhase] = useState<ReasoningPipelinePhase>('idle')
  const [step, setStep] = useState<StepId | null>(null)
  const [run, setRun] = useState<RunState>({ originalQuery: '' })
  const [pendingGather, setPendingGather] = useState<PendingGather | null>(null)
  const [pendingEvidenceGather, setPendingEvidenceGather] = useState<PendingEvidenceGather | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [subElementFailures, setSubElementFailures] = useState<SubElementFailure[] | null>(null)
  const [haltReason, setHaltReason] = useState<string | null>(null)
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; waitMs: number; reason: 'rate-limited' | 'network' } | null>(
    null
  )
  const [regenerationInfo, setRegenerationInfo] = useState<{ attempt: number } | null>(null)
  // Loop C (plan doc 31) — reactive twin of sandboxModeRef below, for
  // rendering; see the interface's own doc comment.
  const [sandboxMode, setSandboxMode] = useState(false)
  // Reactive twin of runIdRef, exposed for Loop C: ConsolePage needs the
  // just-finished sandbox run's own id to finalize it into a candidate
  // (POST .../console/candidate), and had no way to read it before this —
  // nothing needed it until now.
  const [runId, setRunId] = useState('')

  const runIdRef = useRef('')
  const runRef = useRef(run)
  runRef.current = run
  const layerAttemptRef = useRef(1)
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch
  // Post-pipeline console only (plan doc 28) — null for a normal start(),
  // the cascade (lib/ai/console.ts's cascadeStages) for a rerunFrom(); read
  // once, at completion, to decide which action the finish dispatches.
  const rerunStagesRef = useRef<DraftStage[] | null>(null)
  // Loop C (plan doc 31) — the ref the async effect below actually reads
  // (avoids a stale closure the way runRef/rerunStagesRef already do for
  // their own fields); sandboxMode (state) exists only so the rest of the
  // component tree can react to it.
  const sandboxModeRef = useRef(false)

  useEffect(() => {
    if (phase !== 'running' || !step || !houseId) return
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
        try {
          // Loop C (plan doc 31): every step of a sandbox run carries
          // ?candidate=true, read by the route to mark the persisted row
          // is_candidate — from the FIRST step, not just at completion.
          const url = sandboxModeRef.current ? `/api/houses/${houseId}/reasoning?candidate=true` : `/api/houses/${houseId}/reasoning`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step,
              runId: runIdRef.current,
              capN: HOUSE_PIPELINE_N,
              attempt: layerAttemptRef.current,
              run: runRef.current,
              mode,
            }),
            signal: controller.signal,
          })
          if (cancelled) return
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string
              subElementFailures?: SubElementFailure[]
            }
            const code = body.error ?? 'ai-upstream-error'
            const waitMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt - 1]
            if (TRANSIENT_ERROR_CODES.has(code) && waitMs !== undefined) {
              setRetryInfo({ attempt, waitMs, reason: 'rate-limited' })
              await new Promise((resolve) => setTimeout(resolve, waitMs))
              if (cancelled) return
              continue
            }
            setRetryInfo(null)
            setErrorCode(code)
            setSubElementFailures(body.subElementFailures ?? null)
            setPhase('paused')
            return
          }
          setRetryInfo(null)
          setSubElementFailures(null)
          const data = (await res.json()) as StepResponse
          setRun((prev) => ({ ...prev, ...data.patch }))

          const gatherVerdict =
            step === 'context-gather-pre'
              ? data.patch.contextGatherPre
              : step === 'context-gather-post'
                ? data.patch.contextGatherPost
                : undefined
          if (gatherVerdict?.needs_user_input) {
            setPendingGather({
              origin: step === 'context-gather-pre' ? 'pre' : 'post',
              verdict: gatherVerdict,
              resumeStep: data.nextStep,
            })
            setPhase('awaiting-input')
            return
          }

          if (step === 'perspectives-evidence-strategy' && data.patch.perspectiveEvidenceGatherUnits?.length) {
            setPendingEvidenceGather({
              kind: 'perspectives',
              units: data.patch.perspectiveEvidenceGatherUnits,
              resumeStep: data.nextStep,
            })
            setPhase('awaiting-input')
            return
          }
          if (step === 'global-evidence-strategy' && data.patch.globalEvidenceGatherUnit) {
            setPendingEvidenceGather({
              kind: 'global',
              units: [data.patch.globalEvidenceGatherUnit],
              resumeStep: data.nextStep,
            })
            setPhase('awaiting-input')
            return
          }

          if (data.retry) {
            layerAttemptRef.current += 1
            setRegenerationInfo({ attempt: layerAttemptRef.current })
          } else if (isReviewStep(step)) {
            layerAttemptRef.current = 1
            setRegenerationInfo(null)
          }
          if (data.halted) {
            setHaltReason(data.haltReason ?? 'Pipeline halted.')
            setPhase('halted')
            return
          }
          if (data.nextStep === null) {
            // Loop C, Trap 3 (plan doc 31): a sandbox run dispatches
            // NOTHING — no APPLY_REASONING_RESULT, no APPLY_RERUN_RESULT.
            // Its finished run_state is already durable in reasoning_runs
            // (persisted per-step by the route, is_candidate: true); the
            // house stays untouched, and the caller (ConsolePage) reads
            // `run`/`sandboxMode` from here to finalize a candidate instead
            // of saving.
            if (sandboxModeRef.current) {
              setPhase('done')
              return
            }
            // final-composition just landed — map every finished packet into
            // the house as one unclaimed draft batch (plan doc 27 §3) before
            // settling. mapReasoningRunToActions deliberately never touches
            // houses.question/conclusion/reasoning — see that module's own
            // header comment for why.
            const finished = { ...runRef.current, ...data.patch }
            const actions = mapReasoningRunToActions(finished)
            // rerunStagesRef set only by rerunFrom() (plan doc 28) — a rerun
            // must land via APPLY_RERUN_RESULT (clears the cascaded stages
            // first, then applies), never APPLY_REASONING_RESULT (guarded on
            // a blank house — state.draft already exists by definition here,
            // the console is only reachable once a run finished, so that
            // action would just no-op).
            if (rerunStagesRef.current) {
              dispatchRef.current({ type: 'APPLY_RERUN_RESULT', stages: rerunStagesRef.current, actions })
            } else if (actions.length > 0) {
              dispatchRef.current({ type: 'APPLY_REASONING_RESULT', actions })
            }
            setPhase('done')
            return
          }
          setStep(data.nextStep)
          return
        } catch (err) {
          if ((err as Error)?.name === 'AbortError' || cancelled) return
          // Auto-retry a bare fetch() exception the same bounded way a 429
          // already does (2026-09-09, real-verified on production traffic
          // from a phone: a single step here can legitimately hold the
          // connection open for minutes — swarm/synthesis's own DeepInfra
          // timeout runs up to 240s, router-lanes.ts's
          // DEEPINFRA_SWARM_LARGE_TIMEOUT_MS — with no bytes sent until the
          // very end, since this route doesn't stream. Mobile networks and
          // carrier/proxy idle timeouts are far more likely than desktop
          // broadband to kill a connection that looks silent that long, and
          // every prior "Could not reach the pipeline" this session hit
          // succeeded cleanly on a bare retry — so a transient network drop
          // should get the same automatic second chance a rate limit does,
          // not force the person to notice and click Retry themselves).
          const waitMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt - 1]
          if (waitMs !== undefined) {
            setRetryInfo({ attempt, waitMs, reason: 'network' })
            await new Promise((resolve) => setTimeout(resolve, waitMs))
            if (cancelled) return
            continue
          }
          setRetryInfo(null)
          setErrorCode('ai-network-error')
          setPhase('paused')
          return
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [phase, step, houseId, mode])

  function start(question: string) {
    const q = question.trim()
    if (!q || !houseId) return
    runIdRef.current = crypto.randomUUID()
    setRunId(runIdRef.current)
    rerunStagesRef.current = null
    sandboxModeRef.current = false
    setSandboxMode(false)
    setRun({ originalQuery: q })
    setErrorCode(null)
    setSubElementFailures(null)
    setHaltReason(null)
    setRetryInfo(null)
    setRegenerationInfo(null)
    setPendingGather(null)
    setPendingEvidenceGather(null)
    layerAttemptRef.current = 1
    // Express mode skips context-gather-pre (no pre-flight check, no
    // pausing for user input before the frame) — jump straight to
    // frame-generate. Thorough mode starts at context-gather-pre as before.
    setStep(mode === 'express' ? 'frame-generate' : 'context-gather-pre')
    setPhase('running')
  }

  // Post-pipeline console (plan doc 28) — resumes an EXISTING, already-
  // finished run at an earlier stage, instead of start()'s fresh one.
  // Deliberately reuses this hook's own effect/retry/regeneration/gather
  // handling rather than a parallel implementation: both entry points just
  // seed run/step/phase differently, then the same loop takes over either
  // way. Always mints a fresh runId (matching start()'s own behavior) rather
  // than reusing the original one, so the pre-rerun run's persisted row
  // (reasoning_runs) is never overwritten — getReasoningRunByHouseId always
  // returns the most recent by house_id, so this naturally becomes "the"
  // run for this house going forward without erasing the one before it.
  function rerunFrom(existingRun: RunState, stage: DraftStage, reason: string, guidance: string): void {
    if (!houseId) return
    const info = RERUN_STAGE_INFO[stage]
    runIdRef.current = crypto.randomUUID()
    setRunId(runIdRef.current)
    rerunStagesRef.current = cascadeStages(stage)
    sandboxModeRef.current = false
    setSandboxMode(false)
    setRun({
      ...existingRun,
      consoleGuidance: guidance,
      masterReview: info.masterReviewStep
        ? {
            forStep: info.masterReviewStep,
            guidance: {
              // Starts with "None" so appendMasterGuidance (prompts.ts) skips
              // the conflicting-reviewers note entirely — there is no panel
              // disagreement to report here, this came directly from the
              // person.
              contradictions: 'None — this regeneration was requested directly by the person, not the review panel.',
              guidance: `${reason}\n\n${guidance}`,
            },
          }
        : null,
    })
    setErrorCode(null)
    setSubElementFailures(null)
    setHaltReason(null)
    setRetryInfo(null)
    setRegenerationInfo(null)
    setPendingGather(null)
    setPendingEvidenceGather(null)
    layerAttemptRef.current = 1
    setStep(info.resumeStep)
    setPhase('running')
  }

  // Loop C (plan doc plans/active/reasoning-pipeline/31-console-sandbox-
  // reruns.md, Trap 3) — identical seeding to rerunFrom() (same
  // RERUN_STAGE_INFO/cascadeStages/masterReview construction; a sandbox
  // rerun targets the exact same stage/guidance a real one would, the only
  // difference is what happens to the result), plus sandboxModeRef/
  // sandboxMode set true so the effect above skips both dispatches at
  // completion and appends ?candidate=true to every step's fetch.
  function rerunSandbox(existingRun: RunState, stage: DraftStage, reason: string, guidance: string): void {
    if (!houseId) return
    const info = RERUN_STAGE_INFO[stage]
    runIdRef.current = crypto.randomUUID()
    setRunId(runIdRef.current)
    rerunStagesRef.current = cascadeStages(stage)
    sandboxModeRef.current = true
    setSandboxMode(true)
    setRun({
      ...existingRun,
      consoleGuidance: guidance,
      masterReview: info.masterReviewStep
        ? {
            forStep: info.masterReviewStep,
            guidance: {
              contradictions: 'None — this regeneration was requested directly by the person, not the review panel.',
              guidance: `${reason}\n\n${guidance}`,
            },
          }
        : null,
    })
    setErrorCode(null)
    setSubElementFailures(null)
    setHaltReason(null)
    setRetryInfo(null)
    setRegenerationInfo(null)
    setPendingGather(null)
    setPendingEvidenceGather(null)
    layerAttemptRef.current = 1
    setStep(info.resumeStep)
    setPhase('running')
  }

  function pause() {
    setPhase('paused')
    setRetryInfo(null)
  }

  function resume() {
    setErrorCode(null)
    setRetryInfo(null)
    setPhase('running')
  }

  function reset() {
    setPhase('idle')
    setStep(null)
    setRun({ originalQuery: '' })
    setErrorCode(null)
    setSubElementFailures(null)
    setHaltReason(null)
    setRetryInfo(null)
    setRegenerationInfo(null)
    setPendingGather(null)
    setPendingEvidenceGather(null)
    layerAttemptRef.current = 1
    rerunStagesRef.current = null
    sandboxModeRef.current = false
    setSandboxMode(false)
  }

  function resolvePendingGather(answers: (string | null)[]) {
    if (!pendingGather) return
    const { origin, resumeStep } = pendingGather
    setRun((prev) =>
      origin === 'pre' ? { ...prev, contextGatherPreAnswers: answers } : { ...prev, contextGatherPostAnswers: answers }
    )
    setPendingGather(null)
    setPhase('running')
    setStep(resumeStep)
  }

  function skipPendingGather() {
    if (!pendingGather) return
    resolvePendingGather(pendingGather.verdict.questions_for_user.map(() => null))
  }

  function resolvePendingEvidenceGather(answersPerUnit: (string | null)[][]) {
    if (!pendingEvidenceGather) return
    const { kind, units, resumeStep } = pendingEvidenceGather
    setRun((prev) => {
      if (kind === 'perspectives') {
        const history = { ...(prev.perspectiveEvidenceGatherHistory ?? {}) }
        units.forEach((unit, i) => {
          history[unit.unitId] = appendGatherRound(history[unit.unitId], unit, answersPerUnit[i] ?? [])
        })
        return { ...prev, perspectiveEvidenceGatherAnswers: answersPerUnit, perspectiveEvidenceGatherHistory: history }
      }
      return {
        ...prev,
        globalEvidenceGatherAnswer: answersPerUnit[0] ?? null,
        globalEvidenceGatherHistory: appendGatherRound(prev.globalEvidenceGatherHistory, units[0], answersPerUnit[0] ?? []),
      }
    })
    setPendingEvidenceGather(null)
    setPhase('running')
    setStep(resumeStep)
  }

  function skipPendingEvidenceGather() {
    if (!pendingEvidenceGather) return
    resolvePendingEvidenceGather(pendingEvidenceGather.units.map((u) => u.questions.map(() => null)))
  }

  return {
    phase,
    step,
    run,
    pendingGather,
    pendingEvidenceGather,
    errorCode,
    subElementFailures,
    haltReason,
    retryInfo,
    regenerationInfo,
    sandboxMode,
    runId,
    mode,
    start,
    rerunFrom,
    rerunSandbox,
    pause,
    resume,
    reset,
    resolvePendingGather,
    skipPendingGather,
    resolvePendingEvidenceGather,
    skipPendingEvidenceGather,
  }
}
