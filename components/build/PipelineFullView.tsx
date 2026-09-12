'use client'

// Full-page reasoning-pipeline takeover for a brand-new house (Founder Mode
// entry-point redesign, 2026-09-12, Samir's spec) — the dashboard's "Start
// with the reasoning pipeline" card (business mode only) lands a fresh house
// here via ?pipeline=1 (app/build/page.tsx → app/build/[id]/page.tsx →
// BuildHousePage's pipelineEntry prop) instead of the normal seven-layer
// canvas. Samir's own framing: "the entire house is just the reasoning
// pipeline (doesn't show the actual house yet), a go to house button, and in
// that house a switch back to reasoning pipeline button."
//
// Deliberately NOT a separate route/page (unlike /build/[id]/console, which
// is a real navigation — see that route's own header comment). The reasoning
// pipeline's client-side step loop (useReasoningPipelineRunner.ts) is
// in-memory only: it advances by one fetch per step from a React effect, so
// navigating to a different route mid-run would unmount it and silently stop
// the run. This component instead renders in BuildHousePage's OWN tree, fed
// the SAME hoisted runner instance CopilotPanel/Canvas already use — toggling
// out to the house and back (BuildHousePage's viewingHouse state) never
// remounts the runner, so a run in progress keeps advancing underneath
// either view.
//
// Layout mirrors components/admin/reasoning/ReasoningPipelinePage.tsx (the
// admin-only full page this was modeled on) at this app's own chrome, minus
// the admin form's dev-testing controls (dry run, n, panels off) — this is
// the real thing for a real house, same scope cut useReasoningPipelineRunner
// itself already made.

import { useState } from 'react'
import type { Action, State } from '@/lib/build/types'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'
import { MAX_REGENERATION_ATTEMPTS, MASTER_REVIEW_ATTEMPT } from '@/lib/ai/reasoning/budget'
import { ReasoningStagesList } from '@/components/admin/reasoning/ReasoningStagesList'
import { ContextGatherAnswerBox } from '@/components/admin/reasoning/ContextGatherAnswerBox'
import { EvidenceGatherAnswerBox } from '@/components/admin/reasoning/EvidenceGatherAnswerBox'
import { RagProvenanceNote } from './rail/ReasoningPipelineCard'
import type { ReasoningPipelineRunner } from './useReasoningPipelineRunner'

const smallBtn: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--ink)',
  borderRadius: 8,
  padding: '7px 16px',
  cursor: 'pointer',
}

const primaryBtn: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--amber-tint)',
  border: '1px solid var(--amber)',
  borderRadius: 9,
  padding: '11px 22px',
  cursor: 'pointer',
}

// The "switch back to reasoning pipeline" affordance for BuildHousePage's
// normal status row — split out from BuildHousePage.tsx itself (repo's
// ~600-LOC guideline) and co-located here with the view it opens. Shown
// once a pipeline is actually relevant to this house (arrived via
// ?pipeline=1, or a run has been started this session), never for a house
// that never touched the pipeline at all.
export function PipelineToggleButton({
  runner,
  pipelineEntry,
  onOpen,
}: {
  runner: ReasoningPipelineRunner | undefined
  pipelineEntry: boolean
  onOpen: () => void
}) {
  if (!runner || !(pipelineEntry || runner.phase !== 'idle')) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mono"
      style={{ fontSize: 10, letterSpacing: '0.04em', color: 'var(--blueprint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
    >
      ← Reasoning pipeline
    </button>
  )
}

export function PipelineFullView({
  state,
  dispatch,
  runner,
  onGoToHouse,
}: {
  state: State
  dispatch: React.Dispatch<Action>
  runner: ReasoningPipelineRunner
  // Flips BuildHousePage's viewingHouse to true — always available (Samir's
  // spec: a "go to house" button, not gated on the run finishing), since
  // toggling views never touches the runner itself (see module comment).
  onGoToHouse: () => void
}) {
  const [question, setQuestion] = useState('')
  const hasQuestion = state.question.trim().length > 0
  const ready = hasQuestion || question.trim().length > 0

  return (
    <div style={{ flex: '1 1 auto', overflowY: 'auto', background: 'var(--parchment)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-subtle)' }}>
              Reasoning pipeline
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 26, letterSpacing: '-0.01em', color: 'var(--ink)', marginTop: 4 }}>
              {runner.phase === 'idle' ? 'What question should it reason about?' : hasQuestion ? state.question : runner.run.originalQuery}
            </h1>
          </div>
          <button type="button" onClick={onGoToHouse} style={smallBtn}>
            Go to house →
          </button>
        </div>

        {runner.phase === 'idle' && (
          <div style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 11, padding: '18px 20px', marginTop: 20 }}>
            <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.5 }}>
              The real multi-agent pipeline — the same engine and nine-standard review panel as the admin
              surface — reasons through every layer live. You review and claim what it drafts; your
              conclusion stays yours.
            </div>
            {!hasQuestion && (
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Should our school ban homework?"
                rows={3}
                style={{
                  width: '100%',
                  marginTop: 14,
                  fontSize: 14,
                  padding: '10px 12px',
                  border: '1px solid var(--rule)',
                  borderRadius: 9,
                  background: 'var(--parchment)',
                  color: 'var(--ink)',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            )}
            <button
              type="button"
              onClick={() => {
                const q = hasQuestion ? state.question : question.trim()
                if (!hasQuestion && q) dispatch({ type: 'SET_QUESTION', value: q })
                runner.start(q)
              }}
              disabled={!ready}
              style={{ ...primaryBtn, marginTop: 16, opacity: ready ? 1 : 0.55, cursor: ready ? 'pointer' : 'not-allowed' }}
            >
              Run the reasoning pipeline
            </button>
          </div>
        )}

        {runner.phase !== 'idle' && (
          <div style={{ marginTop: 20 }}>
            <div style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 11, padding: '14px 16px' }}>
              <div
                className="mono"
                style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--ink-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {runner.phase === 'running' && <span className="mini-spinner" style={{ width: 13, height: 13 }} />}
                {runner.phase === 'running'
                  ? 'Reasoning…'
                  : runner.phase === 'done'
                    ? 'Done'
                    : runner.phase === 'halted'
                      ? 'Pipeline halted'
                      : runner.phase === 'awaiting-input'
                        ? 'Clarification needed'
                        : 'Reasoning paused'}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <ReasoningStagesList run={runner.run} currentStep={runner.step} running={runner.phase === 'running'} />
            </div>

            <RagProvenanceNote sources={runner.run.ragSources} />

            {runner.phase === 'awaiting-input' && runner.pendingGather && (
              <ContextGatherAnswerBox
                verdict={runner.pendingGather.verdict}
                onSubmit={runner.resolvePendingGather}
                onSkip={runner.skipPendingGather}
              />
            )}
            {runner.phase === 'awaiting-input' && runner.pendingEvidenceGather && (
              <EvidenceGatherAnswerBox
                units={runner.pendingEvidenceGather.units}
                onSubmit={runner.resolvePendingEvidenceGather}
                onSkip={runner.skipPendingEvidenceGather}
              />
            )}

            {runner.retryInfo && (
              <div style={{ fontSize: 12.5, color: 'var(--amber-text)', marginTop: 12, lineHeight: 1.4 }}>
                {runner.retryInfo.reason === 'rate-limited' ? 'Upstream provider rate-limited' : 'Network hiccup'} — retrying
                in {Math.round(runner.retryInfo.waitMs / 1000)}s…
              </div>
            )}

            {runner.regenerationInfo && (
              <div style={{ fontSize: 12.5, color: 'var(--amber-text)', marginTop: 12, lineHeight: 1.4 }}>
                {runner.regenerationInfo.attempt >= MASTER_REVIEW_ATTEMPT
                  ? 'Still failing review after several attempts — one final, guided attempt…'
                  : `Failed review — regenerating with the panel's feedback (attempt ${runner.regenerationInfo.attempt}/${MAX_REGENERATION_ATTEMPTS})…`}
              </div>
            )}

            {runner.errorCode && (
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 12, lineHeight: 1.5 }}>
                {runner.errorCode === RATE_LIMITED_CODE
                  ? RATE_LIMITED_COPY
                  : runner.errorCode === 'ai-network-error'
                    ? 'Network hiccup — check your connection and retry.'
                    : 'Hit a snag — try again, or start a new run if it keeps happening.'}
              </div>
            )}

            {runner.subElementFailures && runner.subElementFailures.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)', marginTop: 8, lineHeight: 1.4 }}>
                {runner.subElementFailures.map((f, i) => (
                  <div key={i}>
                    {f.stanceLabel} — {f.subElement.replace('_', ' ')}: {f.errorMessage}
                  </div>
                ))}
              </div>
            )}

            {runner.haltReason && (
              <div style={{ background: 'var(--white)', border: '1px solid var(--warning)', borderRadius: 11, padding: '14px 16px', marginTop: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Pipeline halted</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)', marginTop: 4, lineHeight: 1.5 }}>{runner.haltReason}</div>
              </div>
            )}

            {runner.phase === 'done' && (
              <div style={{ background: 'var(--white)', border: '1px solid var(--amber)', borderRadius: 11, padding: '18px 20px', marginTop: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Your house is ready</div>
                <div style={{ fontSize: 13, color: 'var(--ink-subtle)', marginTop: 4, lineHeight: 1.5 }}>
                  Every layer is drafted and waiting for your review — nothing is claimed until you say so.
                </div>
                <button type="button" onClick={onGoToHouse} style={{ ...primaryBtn, marginTop: 12 }}>
                  Go to house →
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
              {runner.phase === 'running' && (
                <button type="button" onClick={runner.pause} style={smallBtn}>
                  Pause
                </button>
              )}
              {runner.phase === 'paused' && (
                <button type="button" onClick={runner.resume} style={smallBtn}>
                  {runner.errorCode ? 'Retry' : 'Resume'}
                </button>
              )}
              {(runner.phase === 'halted' || runner.phase === 'paused' || runner.phase === 'awaiting-input') && (
                <button type="button" onClick={runner.reset} style={{ ...smallBtn, borderColor: 'var(--rule)', color: 'var(--ink-subtle)' }}>
                  Start over
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
