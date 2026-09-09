'use client'

// Full-screen pipeline progress view (plan doc 32, Phase 1 step 1):
// replaces the normal 7-layer canvas when the reasoning pipeline is
// running — architecturally identical to the sector deep-dive branch in
// Canvas.tsx (conditional render, back button, scroll reset). Reuses
// ReasoningStagesList from the admin surface (import, not copy) for the
// step checklist, adding an elapsed timer, status label, mode indicator,
// and back/exit button around it.
//
// The copilot rail stays visible alongside this view (same as the sector
// deep-dive) — ReasoningPipelineCard in the rail shows the same progress
// at its smaller scale, plus the pause/resume/reset controls.

import { useEffect, useRef, useState } from 'react'
import { ReasoningStagesList } from '@/components/admin/reasoning/ReasoningStagesList'
import { ContextGatherAnswerBox } from '@/components/admin/reasoning/ContextGatherAnswerBox'
import { EvidenceGatherAnswerBox } from '@/components/admin/reasoning/EvidenceGatherAnswerBox'
import { STEP_LABELS, EXPRESS_STEP_LABELS, type PipelineMode } from '@/lib/ai/reasoning/steps'
import { MAX_REGENERATION_ATTEMPTS, MASTER_REVIEW_ATTEMPT } from '@/lib/ai/reasoning/budget'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'
import type { ReasoningPipelineRunner } from './useReasoningPipelineRunner'

function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    if (!running) return
    startRef.current = Date.now() - elapsed * 1000
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(id)
    // elapsed in the dep array would restart the interval every second;
    // we only want to restart when running toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])
  return elapsed
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

export function PipelineView({
  runner,
  mode,
  onBack,
}: {
  runner: ReasoningPipelineRunner
  mode: PipelineMode
  onBack: () => void
}) {
  const isRunning = runner.phase === 'running'
  const elapsed = useElapsed(isRunning || runner.phase === 'awaiting-input')

  // Live status label from the current step.
  const labels = mode === 'express' ? EXPRESS_STEP_LABELS : STEP_LABELS
  const statusLabel = runner.step ? (labels as Record<string, string>)[runner.step] ?? null : null

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 36px 120px' }}>
      {/* Back button — same position/style as sector deep-dive's SectorShell. */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 28,
          padding: '5px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink-subtle)',
        }}
      >
        ← Back to house
      </button>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              fontSize: 26,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            {runner.phase === 'done'
              ? 'Reasoning complete'
              : runner.phase === 'halted'
                ? 'Pipeline halted'
                : 'Building your house…'}
          </h2>
        </div>

        {/* Mode pill + elapsed timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--amber-text)',
              background: 'var(--amber-tint)',
              border: '1px solid var(--amber)',
              borderRadius: 999,
              padding: '2px 9px',
            }}
          >
            {mode === 'express' ? 'Express' : 'Thorough'}
          </span>
          {(isRunning || runner.phase === 'awaiting-input') && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)', letterSpacing: '0.04em' }}>
              {formatTime(elapsed)}
            </span>
          )}
        </div>

        {/* Live status label */}
        {isRunning && statusLabel && (
          <div style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-mid)', lineHeight: 1.5 }}>
            {statusLabel}
          </div>
        )}
      </div>

      {/* Step checklist — the same ReasoningStagesList the admin uses. */}
      <ReasoningStagesList run={runner.run} currentStep={runner.step} running={isRunning} mode={mode} />

      {/* Gather prompts — same as ReasoningPipelineCard, larger layout. */}
      {runner.phase === 'awaiting-input' && runner.pendingGather && (
        <div style={{ marginTop: 20 }}>
          <ContextGatherAnswerBox
            verdict={runner.pendingGather.verdict}
            onSubmit={runner.resolvePendingGather}
            onSkip={runner.skipPendingGather}
          />
        </div>
      )}
      {runner.phase === 'awaiting-input' && runner.pendingEvidenceGather && (
        <div style={{ marginTop: 20 }}>
          <EvidenceGatherAnswerBox
            units={runner.pendingEvidenceGather.units}
            onSubmit={runner.resolvePendingEvidenceGather}
            onSkip={runner.skipPendingEvidenceGather}
          />
        </div>
      )}

      {/* Retry / regeneration info */}
      {runner.retryInfo && (
        <div style={{ fontSize: 13, color: 'var(--amber-text)', marginTop: 16, lineHeight: 1.45 }}>
          {runner.retryInfo.reason === 'rate-limited' ? 'Upstream provider rate-limited' : 'Network hiccup'} — retrying in{' '}
          {Math.round(runner.retryInfo.waitMs / 1000)}s…
        </div>
      )}
      {runner.regenerationInfo && (
        <div style={{ fontSize: 13, color: 'var(--amber-text)', marginTop: 16, lineHeight: 1.45 }}>
          {runner.regenerationInfo.attempt >= MASTER_REVIEW_ATTEMPT
            ? 'Still failing review after several attempts — one final, guided attempt…'
            : `Failed review — regenerating with the panel's feedback (attempt ${runner.regenerationInfo.attempt}/${MAX_REGENERATION_ATTEMPTS})…`}
        </div>
      )}

      {/* Error display */}
      {runner.errorCode && (
        <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 16, lineHeight: 1.5 }}>
          {runner.errorCode === RATE_LIMITED_CODE
            ? RATE_LIMITED_COPY
            : runner.errorCode === 'ai-network-error'
              ? 'Network hiccup — check your connection and retry.'
              : 'Could not reach the reasoning pipeline.'}
        </div>
      )}

      {runner.haltReason && (
        <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 16, lineHeight: 1.5 }}>
          {runner.haltReason}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        {runner.phase === 'running' && (
          <button type="button" onClick={runner.pause} style={controlBtn}>
            Pause
          </button>
        )}
        {runner.phase === 'paused' && (
          <button type="button" onClick={runner.resume} style={controlBtn}>
            {runner.errorCode ? 'Retry' : 'Resume'}
          </button>
        )}
        {(runner.phase === 'halted' || runner.phase === 'paused' || runner.phase === 'awaiting-input') && (
          <button type="button" onClick={runner.reset} style={{ ...controlBtn, borderColor: 'var(--rule)', color: 'var(--ink-subtle)' }}>
            Start over
          </button>
        )}
        {runner.phase === 'done' && (
          <button type="button" onClick={onBack} style={{ ...controlBtn, background: 'var(--amber-tint)', borderColor: 'var(--amber)' }}>
            View your house →
          </button>
        )}
      </div>
    </div>
  )
}

const controlBtn: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--ink)',
  borderRadius: 8,
  padding: '7px 16px',
  cursor: 'pointer',
}
