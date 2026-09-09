'use client'

// Reasoning pipeline (decision 019) — admin-only, standalone page (not wired
// into House Chat; see decision 019's Deferred/open on why). Pre-run form,
// then a client-driven loop generalizing useDraftRunner's "one fetch per
// state advance" pattern (decision 016) to the pipeline's 22 steps: one
// request per step, full run state resent each time (stateless server), the
// response's `patch` merged in, then the next step fires automatically.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { useAuthedPage } from '@/components/useAuthedPage'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'
import { isReviewStep, type PipelineMode, type StepId } from '@/lib/ai/reasoning/steps'
import {
  estimatePipelineCost,
  estimateExpressCost,
  MIN_N,
  MAX_N_PHASE1,
  MAX_REGENERATION_ATTEMPTS,
  MASTER_REVIEW_ATTEMPT,
} from '@/lib/ai/reasoning/budget'
import type { ContextGatherVerdict, EvidenceGatherUnit, SubElementFailure } from '@/lib/ai/reasoning/contracts'
import { ReasoningStagesList, type RunState } from './ReasoningStagesList'
import { ContextGatherAnswerBox } from './ContextGatherAnswerBox'
import { EvidenceGatherAnswerBox } from './EvidenceGatherAnswerBox'
import { FinalAnswerCard } from './FinalAnswerCard'

// 'awaiting-input' (Phase 3 item 1, decision 019) is distinct from both
// 'paused' (the admin clicked Pause) and 'halted' (a hard-block review step
// exhausted its retries) — a context-gather checkpoint or ad-hoc call
// returned needs_user_input: true and is waiting on the admin's answer/skip
// before the run can continue. See PendingGather below.
type Phase = 'form' | 'running' | 'paused' | 'awaiting-input' | 'halted' | 'done'

// Tracks the one context-gather verdict currently awaiting the admin's
// response, regardless of where it came from:
// - 'pre'/'post': one of the two fixed checkpoints, mid-step-loop — resolving
//   it resumes the loop at `resumeStep` (the step that would have run next).
// - 'adhoc': the admin manually asked (askClarifyingQuestion below) while
//   already paused — resolving it returns to 'paused', not 'running'; the
//   admin decides separately when to actually resume.
interface PendingGather {
  origin: 'pre' | 'post' | 'adhoc'
  verdict: ContextGatherVerdict
  resumeStep: StepId | null
}

// Analogous to PendingGather but for evidence generation's own "decide
// whether to ask the user" checkpoint (Phase 5, 2026-08-13 — the evidence
// redesign). 'perspectives' aggregates however many of the n independent
// perspectives actually asked something into one pause (route.ts's
// collectEvidenceGatherUnits); 'global' is always exactly the one
// question-level unit. Unlike PendingGather there's no 'adhoc' origin —
// evidence-strategy only ever runs as a fixed step in the loop, so resolving
// always resumes the loop at resumeStep rather than returning to 'paused'.
interface PendingEvidenceGather {
  kind: 'perspectives' | 'global'
  units: EvidenceGatherUnit[]
  resumeStep: StepId | null
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em' }

const smallBtn: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--ink)',
  borderRadius: 7,
  padding: '5px 12px',
  cursor: 'pointer',
}

interface StepResponse {
  step: StepId
  patch: Partial<RunState>
  nextStep: StepId | null
  halted: boolean
  haltReason?: string
  // true only when the server looped `nextStep` BACKWARD to regenerate after
  // a failed panel verdict (route.ts's retryStep()) — distinguishes that from
  // ordinary forward progression that happens to land on the same step id
  // (e.g. context-gather-pre's normal nextStep is also 'frame-generate').
  retry?: boolean
}

// Bounded wait-then-retry for a transient upstream provider 429 (decision
// 019's "2 retries/3 attempts" model, Phase 1.5 #2). Scoped ONLY to
// 'ai-rate-limited' — our own daily-cap code ('rate-limited', see
// lib/ai/findings.ts) never clears mid-run, so retrying it is pointless, and
// every other AiError (invalid-output, context-overflow, ...) already gets
// its own same-instant self-correction retry inside completeJSON
// (lib/ai/router.ts) — stacking a second, identical retry on top of that
// wouldn't address a different failure mode, just spend more quota on one
// that already had its shot. A short backoff (not a long one) because the
// whole loop must fit inside this route's 30s serverless budget.
const RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 15_000]
const MAX_STEP_ATTEMPTS = RATE_LIMIT_RETRY_DELAYS_MS.length + 1

export function ReasoningPipelinePage() {
  const { accountType, caps, signOut } = useAuthedPage()
  const showClassroom = caps.canCreateClasses || accountType === 'student'
  const [phase, setPhase] = useState<Phase>('form')
  const [question, setQuestion] = useState('')
  const [n, setN] = useState(MIN_N)
  const [dryRun, setDryRun] = useState(true)
  // "Thorough" (existing 22-step behavior, default) vs "Express" (7-step
  // streamlined variant — no review panels, no evidence, no context-gather
  // pauses). Threaded into every step fetch (see the loop effect below) and
  // into ReasoningStagesList so the checklist renders the right steps.
  const [mode, setMode] = useState<PipelineMode>('thorough')
  // Decision 019 verification stage 3 (A/B the review panel): threaded
  // alongside dryRun end-to-end, but generation stays real — only every
  // review-gate call is replaced server-side with an auto-pass verdict (see
  // route.ts, orchestrator-panel.ts). Lets the same real question be run
  // twice (panels on vs. off) and compared via /admin/reasoning/runs.
  const [panelsOff, setPanelsOff] = useState(false)
  // Dev-testing only (Phase 3 item 1): forces a synthetic needs_user_input on
  // every context-gather call while dryRun is on, so the pause/ask/resume UI
  // can be exercised for free — dryRun's own runContextGather branch
  // otherwise always returns needs_user_input: false (orchestrator-setup.ts).
  // Has no effect at all outside dryRun (route.ts only reads it there).
  const [devForceNeedsInput, setDevForceNeedsInput] = useState(false)
  const [step, setStep] = useState<StepId | null>(null)
  const [run, setRun] = useState<RunState>({ originalQuery: '' })
  // The context-gather verdict currently awaiting the admin, if any — see
  // PendingGather above. null whenever phase !== 'awaiting-input'.
  const [pendingGather, setPendingGather] = useState<PendingGather | null>(null)
  // The evidence-strategy pause currently awaiting the admin, if any — see
  // PendingEvidenceGather above. null whenever phase !== 'awaiting-input' via
  // this path (pendingGather and pendingEvidenceGather are never both set —
  // they're populated by disjoint step branches in the loop effect below).
  const [pendingEvidenceGather, setPendingEvidenceGather] = useState<PendingEvidenceGather | null>(null)
  const [adHocBusy, setAdHocBusy] = useState(false)
  // Generated fresh per run (start()), resent on every step call — the
  // server's persistence key for reasoning_runs (Phase 2 item 1, decision
  // 019). Not used for anything client-side; the run is still tracked here
  // by React state exactly as before.
  const runIdRef = useRef('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  // 2026-08-13, Samir: which sub-element(s), for which perspective(s), a
  // perspectives-generate-details failure was actually on — set only when
  // the route's error response carries it (route.ts's PerspectivesGenerateError
  // handling). null for every other kind of error.
  const [subElementFailures, setSubElementFailures] = useState<SubElementFailure[] | null>(null)
  const [haltReason, setHaltReason] = useState<string | null>(null)
  // reason distinguishes an upstream 429 from a client-side fetch exception
  // (2026-09-09) so the UI can show accurate copy for each — see the loop
  // effect's catch block below for why a network error now retries the same
  // way a rate-limit already did.
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; waitMs: number; reason: 'rate-limited' | 'network' } | null>(
    null
  )
  const [regenerationInfo, setRegenerationInfo] = useState<{ attempt: number } | null>(null)
  const runRef = useRef(run)
  runRef.current = run
  // Which attempt (1-indexed) the layer currently in flight is on — sent as
  // `attempt` so hard-block review steps can decide retry-vs-halt (route.ts).
  // Incremented only on a `retry: true` response, reset to 1 once a review
  // step actually passes (or a fresh run starts) — see StepResponse.retry
  // above. Real-verified (2026-08-01) that resetting on EVERY non-retry
  // response — including a `*-generate` step's own response, which is never
  // itself `retry: true` even mid-loop — silently wiped the count back to 1
  // every time a retry looped back through generate. Review would then
  // always see attempt=1, `attempt < MAX_REGENERATION_ATTEMPTS` would always
  // hold, and a layer that never contentfully improves (unlike Frame, which
  // always happened to genuinely pass first) would regenerate forever
  // instead of halting after 3 real attempts — confirmed live: 20+ real
  // global-assumptions-review calls, the halt path never reached. Only a
  // completed REVIEW step (isReviewStep) is a legitimate place to reset —
  // its own generate step's response must leave the count untouched so the
  // NEXT review call still sees the real, escalating attempt number.
  const layerAttemptRef = useRef(1)

  useEffect(() => {
    if (phase !== 'running' || !step) return
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
        try {
          const res = await fetch('/api/admin/reasoning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step,
              runId: runIdRef.current,
              capN: n,
              dryRun,
              panelsOff: mode === 'express' ? true : panelsOff, // express auto-skips panels
              devForceNeedsInput,
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
            if (code === 'ai-rate-limited' && waitMs !== undefined) {
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

          // Phase 3 item 1 (decision 019): a fixed checkpoint returning
          // needs_user_input pauses the loop instead of auto-advancing to
          // nextStep — resolvePendingGather (below) resumes at resumeStep
          // once the admin answers or skips. See PendingGather above.
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

          // Same pattern, extended to evidence generation's own strategy
          // checkpoint (Phase 5): route.ts always returns nextStep as if
          // advancing straight to *-evidence-populate — it's the client's
          // job to notice non-empty gather units and pause instead, exactly
          // like gatherVerdict above.
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
            // A generate step's own (always non-retry) response must NOT
            // reset this — see layerAttemptRef's comment above.
            layerAttemptRef.current = 1
            setRegenerationInfo(null)
          }
          if (data.halted) {
            setHaltReason(data.haltReason ?? 'Pipeline halted.')
            setPhase('halted')
            return
          }
          if (data.nextStep === null) {
            setPhase('done')
            return
          }
          setStep(data.nextStep)
          return
        } catch (err) {
          if ((err as Error)?.name === 'AbortError' || cancelled) return
          // Auto-retry a bare fetch() exception the same bounded way a 429
          // already does (2026-09-09) — see useReasoningPipelineRunner.ts's
          // matching catch block for the full rationale (long-held,
          // non-streaming connections dying on mobile networks/proxies, and
          // every such failure this session real-verified succeeding on a
          // bare retry).
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
  }, [phase, step, n, dryRun, panelsOff, devForceNeedsInput, mode])

  function start() {
    if (!question.trim()) return
    runIdRef.current = crypto.randomUUID()
    setRun({ originalQuery: question.trim() })
    setErrorCode(null)
    setSubElementFailures(null)
    setHaltReason(null)
    setRetryInfo(null)
    setRegenerationInfo(null)
    setPendingGather(null)
    setPendingEvidenceGather(null)
    layerAttemptRef.current = 1
    setStep(mode === 'express' ? 'frame-generate' : 'context-gather-pre')
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
    setPhase('form')
    setStep(null)
    setRun({ originalQuery: '' })
    setErrorCode(null)
    setHaltReason(null)
    setRetryInfo(null)
    setRegenerationInfo(null)
    setPendingGather(null)
    setPendingEvidenceGather(null)
    layerAttemptRef.current = 1
  }

  // Answering or skipping a pending gather (Phase 3 item 1): stores the
  // answers in `run` (parallel to the verdict's questions_for_user — null
  // entries are skipped questions) so the NEXT real step call both persists
  // them (route.ts's persist()) and re-contextualizes generation with them
  // (route.ts's buildExtraContext / frame-generate's userAnswers). A fixed
  // checkpoint ('pre'/'post') then resumes the step loop at resumeStep; an
  // ad-hoc ask just returns to 'paused' — the admin resumes separately,
  // since they paused for their own reason, not because of this question.
  function resolvePendingGather(answers: (string | null)[]) {
    if (!pendingGather) return
    const { origin, resumeStep } = pendingGather
    setRun((prev) => {
      if (origin === 'pre') return { ...prev, contextGatherPreAnswers: answers }
      if (origin === 'post') return { ...prev, contextGatherPostAnswers: answers }
      const list = [...(prev.adHocContextGathers ?? [])]
      if (list.length > 0) list[list.length - 1] = { ...list[list.length - 1], answers }
      return { ...prev, adHocContextGathers: list }
    })
    setPendingGather(null)
    if (origin === 'adhoc') {
      setPhase('paused')
    } else {
      setPhase('running')
      setStep(resumeStep)
    }
  }

  function skipPendingGather() {
    if (!pendingGather) return
    resolvePendingGather(pendingGather.verdict.questions_for_user.map(() => null))
  }

  // Evidence-strategy's analogue of resolvePendingGather/skipPendingGather
  // above. answersPerUnit is index-aligned with pendingEvidenceGather.units;
  // 'perspectives' stores the whole array (route.ts's
  // flattenEvidenceGatherAnswers reassembles it against perspectiveStances
  // at the populate step), 'global' has exactly one unit so its answers are
  // the array's sole entry. Always resumes the loop — see
  // PendingEvidenceGather's comment on why there's no 'adhoc' branch here.
  function resolvePendingEvidenceGather(answersPerUnit: (string | null)[][]) {
    if (!pendingEvidenceGather) return
    const { kind, resumeStep } = pendingEvidenceGather
    setRun((prev) =>
      kind === 'perspectives'
        ? { ...prev, perspectiveEvidenceGatherAnswers: answersPerUnit }
        : { ...prev, globalEvidenceGatherAnswer: answersPerUnit[0] ?? null }
    )
    setPendingEvidenceGather(null)
    setPhase('running')
    setStep(resumeStep)
  }

  function skipPendingEvidenceGather() {
    if (!pendingEvidenceGather) return
    resolvePendingEvidenceGather(pendingEvidenceGather.units.map((u) => u.questions.map(() => null)))
  }

  // Admin-triggered ad-hoc context-gather (Phase 3 item 1's larger scope) —
  // available only while paused, at whatever step is currently sitting in
  // `step`. A one-off fetch outside the main step-loop effect: the pipeline
  // stays 'paused' throughout (unless the call itself surfaces a question, in
  // which case 'awaiting-input' takes over — see resolvePendingGather above).
  async function askClarifyingQuestion() {
    if (!step || adHocBusy) return
    setAdHocBusy(true)
    setErrorCode(null)
    try {
      const res = await fetch('/api/admin/reasoning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'context-gather-adhoc',
          runId: runIdRef.current,
          atStep: step,
          dryRun,
          devForceNeedsInput,
          run: runRef.current,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorCode(body.error ?? 'ai-upstream-error')
        return
      }
      const data = (await res.json()) as { patch: Partial<RunState> }
      setRun((prev) => ({ ...prev, ...data.patch }))
      const gathers = data.patch.adHocContextGathers
      const last = gathers && gathers.length > 0 ? gathers[gathers.length - 1] : undefined
      if (last?.verdict.needs_user_input) {
        setPendingGather({ origin: 'adhoc', verdict: last.verdict, resumeStep: null })
        setPhase('awaiting-input')
      }
      // Else: nothing needed asking — stay paused as-is, nothing more to show.
    } catch {
      setErrorCode('ai-network-error')
    } finally {
      setAdHocBusy(false)
    }
  }

  const cost = mode === 'express' ? estimateExpressCost(n) : estimatePipelineCost(n, panelsOff)
  const peakConcurrent = panelsOff ? 4 * n : 9 * n
  const nOptions = Array.from({ length: MAX_N_PHASE1 - MIN_N + 1 }, (_, i) => MIN_N + i)

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--parchment)' }}>
      <DashboardHeader onSignOut={() => void signOut()} active="admin" showClassroom={showClassroom} classroomHref={caps.canCreateClasses ? '/classroom' : '/classes'} />

      <div className="container" style={{ paddingBlock: 32, maxWidth: 820 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: 'var(--ink)' }}>
              Reasoning Pipeline
              <span style={{ ...mono, color: 'var(--ink-subtle)', textTransform: 'uppercase', marginLeft: 10, fontWeight: 400 }}>
                phase 1 · admin only
              </span>
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 4 }}>
              A multi-agent reasoning pipeline, reviewed by a nine-standard panel at every gate — decision 019.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <Link
              href="/admin/reasoning/runs"
              style={{ ...mono, textTransform: 'uppercase', color: 'var(--ink-subtle)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Past runs
            </Link>
            <Link
              href="/admin"
              style={{ ...mono, textTransform: 'uppercase', color: 'var(--ink-subtle)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Monitor
            </Link>
          </div>
        </div>

        {phase === 'form' && (
          <div style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 11, padding: '18px 20px', marginTop: 24 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => setMode('thorough')}
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '10px 14px',
                  borderRadius: 9,
                  border: mode === 'thorough' ? '2px solid var(--ink)' : '1px solid var(--rule)',
                  background: mode === 'thorough' ? 'var(--amber-tint)' : 'var(--white)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>Thorough</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-subtle)', marginTop: 2 }}>
                  22 steps · 6 review gates · evidence search · ~5-10 min
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('express')}
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '10px 14px',
                  borderRadius: 9,
                  border: mode === 'express' ? '2px solid var(--ink)' : '1px solid var(--rule)',
                  background: mode === 'express' ? 'var(--amber-tint)' : 'var(--white)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>Express</div>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-subtle)', marginTop: 2 }}>
                  7 steps · no review panels · no evidence · ~30-60 sec
                </div>
              </button>
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Question</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Should our school ban homework?"
              rows={3}
              style={{
                width: '100%',
                marginTop: 6,
                fontSize: 14,
                padding: '10px 12px',
                border: '1px solid var(--rule)',
                borderRadius: 9,
                background: 'var(--white)',
                color: 'var(--ink)',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                Perspectives (n)
                <select
                  value={n}
                  onChange={(e) => setN(Number(e.target.value))}
                  style={{
                    fontSize: 13,
                    padding: '4px 8px',
                    border: '1px solid var(--rule)',
                    borderRadius: 7,
                    background: 'var(--white)',
                    color: 'var(--ink)',
                  }}
                >
                  {nOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <span style={{ ...mono, color: 'var(--ink-subtle)' }}>
                ≈ {cost.total} calls ({cost.generators} generators + {cost.reviewers} reviewers), peak ~{peakConcurrent} concurrent
              </span>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12.5, color: 'var(--ink-subtle)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                style={{ accentColor: 'var(--amber)', margin: 0 }}
              />
              Dry run (no real AI calls — exercises the 22-step state machine and UI for free)
            </label>

            {dryRun && mode === 'thorough' && (
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, marginLeft: 22, fontSize: 12, color: 'var(--ink-subtle)', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={devForceNeedsInput}
                  onChange={(e) => setDevForceNeedsInput(e.target.checked)}
                  style={{ accentColor: 'var(--amber)', margin: 0 }}
                />
                Simulate a clarifying question (dev testing — every context-gather call, fixed or ad-hoc, returns a fake question)
              </label>
            )}

            {mode === 'thorough' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12.5, color: 'var(--ink-subtle)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={panelsOff}
                  onChange={(e) => setPanelsOff(e.target.checked)}
                  style={{ accentColor: 'var(--amber)', margin: 0 }}
                />
                Panels off (auto-pass every review gate — real generation, no reviewer calls; for A/B comparison against a panels-on run)
              </label>
            )}

            {!dryRun && (
              <div style={{ fontSize: 11.5, color: 'var(--warning-text)', marginTop: 8, lineHeight: 1.45 }}>
                Real runs share this app&apos;s AI provider quotas with every live feature — keep n small and run sparingly.
              </div>
            )}

            <button
              type="button"
              onClick={start}
              disabled={!question.trim()}
              style={{
                marginTop: 16,
                fontWeight: 600,
                fontSize: 13,
                color: 'var(--ink)',
                background: 'var(--amber-tint)',
                border: '1px solid var(--amber)',
                borderRadius: 9,
                padding: '9px 18px',
                cursor: question.trim() ? 'pointer' : 'not-allowed',
                opacity: question.trim() ? 1 : 0.6,
              }}
            >
              Run pipeline
            </button>
          </div>
        )}

        {phase !== 'form' && (
          <div style={{ marginTop: 24 }}>
            <div style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 11, padding: '14px 16px' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)', lineHeight: 1.5 }}>{run.originalQuery}</div>
              {dryRun && <div style={{ ...mono, color: 'var(--amber-text)', marginTop: 4 }}>DRY RUN — no real AI calls</div>}
              {!dryRun && panelsOff && (
                <div style={{ ...mono, color: 'var(--amber-text)', marginTop: 4 }}>PANELS OFF — auto-pass, no reviewer calls</div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <ReasoningStagesList run={run} currentStep={step} running={phase === 'running'} mode={mode} />
            </div>

            {phase === 'awaiting-input' && pendingGather && (
              <ContextGatherAnswerBox verdict={pendingGather.verdict} onSubmit={resolvePendingGather} onSkip={skipPendingGather} />
            )}

            {phase === 'awaiting-input' && pendingEvidenceGather && (
              <EvidenceGatherAnswerBox
                units={pendingEvidenceGather.units}
                onSubmit={resolvePendingEvidenceGather}
                onSkip={skipPendingEvidenceGather}
              />
            )}

            {retryInfo && (
              <div style={{ ...mono, color: 'var(--amber-text)', marginTop: 12, textTransform: 'none', letterSpacing: 'normal' }}>
                {retryInfo.reason === 'rate-limited' ? 'Upstream provider rate-limited' : 'Network hiccup'} — retrying
                automatically in {Math.round(retryInfo.waitMs / 1000)}s (attempt {retryInfo.attempt + 1}/{MAX_STEP_ATTEMPTS})…
              </div>
            )}

            {regenerationInfo && (
              <div style={{ ...mono, color: 'var(--amber-text)', marginTop: 12, textTransform: 'none', letterSpacing: 'normal' }}>
                {regenerationInfo.attempt >= MASTER_REVIEW_ATTEMPT ? (
                  // The one extra, master-guided attempt after
                  // MAX_REGENERATION_ATTEMPTS failed on its own feedback
                  // (2026-08-11 addendum) — distinct copy, not "4/3", since
                  // this attempt is qualitatively different (synthesized
                  // guidance, not the raw 9-note dump) and is the last one.
                  <>Still failing after {MAX_REGENERATION_ATTEMPTS} attempts — a senior reviewer synthesized guidance from all 9 standards for one final attempt…</>
                ) : (
                  <>
                    Failed review — regenerating with the panel&apos;s feedback (attempt {regenerationInfo.attempt}/
                    {MAX_REGENERATION_ATTEMPTS})…
                  </>
                )}
              </div>
            )}

            {errorCode && (
              <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 12, lineHeight: 1.45 }}>
                {errorCode === RATE_LIMITED_CODE
                  ? RATE_LIMITED_COPY
                  : errorCode === 'ai-network-error'
                    ? 'Network hiccup — check your connection and retry.'
                    : 'Could not reach a stage of the pipeline.'}
              </div>
            )}

            {subElementFailures && subElementFailures.length > 0 && (
              <div style={{ ...mono, color: 'var(--ink-subtle)', marginTop: 6, textTransform: 'none', letterSpacing: 'normal' }}>
                {subElementFailures.map((f, i) => (
                  <div key={i}>
                    {f.stanceLabel} — {f.subElement.replace('_', ' ')}: {f.errorMessage}
                  </div>
                ))}
              </div>
            )}

            {haltReason && (
              <div style={{ background: 'var(--white)', border: '1px solid var(--warning)', borderRadius: 11, padding: '14px 16px', marginTop: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Pipeline halted</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)', marginTop: 4, lineHeight: 1.5 }}>{haltReason}</div>
              </div>
            )}

            {phase === 'done' && run.finalAnswer && <FinalAnswerCard finalAnswer={run.finalAnswer} />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              {phase === 'running' && (
                <button type="button" onClick={pause} style={smallBtn}>
                  Pause
                </button>
              )}
              {phase === 'paused' && (
                <button type="button" onClick={resume} style={smallBtn}>
                  {errorCode ? 'Retry' : 'Resume'}
                </button>
              )}
              {phase === 'paused' && (
                <button type="button" onClick={() => void askClarifyingQuestion()} disabled={adHocBusy} style={smallBtn}>
                  {adHocBusy ? 'Asking…' : 'Ask a clarifying question'}
                </button>
              )}
              {(phase === 'halted' || phase === 'done' || phase === 'paused' || phase === 'awaiting-input') && (
                <button type="button" onClick={reset} style={{ ...smallBtn, borderColor: 'var(--rule)', color: 'var(--ink-subtle)' }}>
                  New question
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
