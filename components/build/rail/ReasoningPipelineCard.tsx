'use client'

// House-scoped reasoning pipeline's embedded rail card (plan doc
// plans/active/reasoning-pipeline/27-house-scoped-pipeline-integration.md
// §2), mounted in CopilotPanel's consolidated blank-house entry point in
// place of the old "Enter reasoning pipeline" → interview+draft handoff.
// Reuses the SAME display components the admin surface uses
// (ReasoningStagesList/ContextGatherAnswerBox/EvidenceGatherAnswerBox) —
// this file only adds the offer/control chrome around them, mirroring
// components/admin/reasoning/ReasoningPipelinePage.tsx's layout at a smaller
// scale for the rail's ~300px width.
//
// Two exports:
//  - ReasoningPipelineCard: the run itself (offer → progress → done).
//  - ReasoningConclusionSuggestion: the pipeline's Conclusions/FinalAnswer
//    packets, offered as a one-click "Use as my conclusion" suggestion —
//    NEVER auto-written. See lib/ai/reasoning/houseMapping.ts's header
//    comment for why (invariant 1, plans/active/ai/README.md) and
//    decisions/018 for the one precedent this deliberately does NOT reuse
//    (that exception is admin-only and fenced; this route is not admin-only).
//    Rendered separately from ReasoningPipelineCard (not nested inside it)
//    because it must keep showing even after the house stops being "blank"
//    (the moment APPLY_REASONING_RESULT lands, houseIsBlank flips false and
//    CopilotPanel falls through to its normal branch) — see CopilotPanel.tsx
//    for where each is mounted.

import { useState } from 'react'
import type { Action, State } from '@/lib/build/types'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'
import { MAX_REGENERATION_ATTEMPTS, MASTER_REVIEW_ATTEMPT } from '@/lib/ai/reasoning/budget'
import { ReasoningStagesList } from '@/components/admin/reasoning/ReasoningStagesList'
import { ContextGatherAnswerBox } from '@/components/admin/reasoning/ContextGatherAnswerBox'
import { EvidenceGatherAnswerBox } from '@/components/admin/reasoning/EvidenceGatherAnswerBox'
import type { ReasoningPipelineRunner } from '../useReasoningPipelineRunner'
import { SaveFactsToProjectButton } from '../SaveToProjectButton'

const cardStyle: React.CSSProperties = {
  background: 'var(--parchment)',
  border: '1px solid var(--rule)',
  borderRadius: 11,
  padding: 13,
  marginBottom: 16,
}

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

const primaryBtn: React.CSSProperties = {
  marginTop: 10,
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--ink)',
  background: 'var(--amber-tint)',
  border: '1px solid var(--amber)',
  borderRadius: 7,
  padding: '7px 14px',
  cursor: 'pointer',
}

// Business mode (decision 021, Phase 5) — the pipeline's own analogue of
// InterviewCard's ragSources note. Before this, retrieved project material
// reached the model (route.ts's ragText, folded into the prompt) but never
// reached the person running the pipeline — a real gap against decision
// 021 §5's "labeled, not laundered" requirement, which is about what the
// USER sees, not only what the model is told. Shared by the rail card below
// and the full-page pipeline view (components/build/PipelineFullView.tsx)
// so the two never drift on this wording.
export function RagProvenanceNote({ sources }: { sources: { sourceType: string; label: string }[] | null | undefined }) {
  if (!sources || sources.length === 0) return null
  const labels = [...new Set(sources.map((s) => s.label))]
  return (
    <div className="mono" style={{ fontSize: 10, color: 'var(--amber-text)', marginTop: 10, lineHeight: 1.5 }}>
      Used your own project material — not verified evidence: {labels.join(', ')}
    </div>
  )
}

export function ReasoningPipelineCard({
  state,
  dispatch,
  runner,
}: {
  state: State
  dispatch: React.Dispatch<Action>
  runner: ReasoningPipelineRunner
}) {
  const [question, setQuestion] = useState('')
  const hasQuestion = state.question.trim().length > 0

  // ── Offer: nothing started yet.
  if (runner.phase === 'idle') {
    const ready = hasQuestion || question.trim().length > 0
    return (
      <div style={cardStyle} className="fade-in">
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Enter reasoning pipeline</div>
        <div style={{ fontSize: 12, color: 'var(--ink-subtle)', marginTop: 3, lineHeight: 1.45 }}>
          The real multi-agent pipeline — the same engine and nine-standard review panel as the
          admin surface — reasons through every layer live, right here. You review and claim what
          it drafts; your conclusion stays yours.
        </div>
        {!hasQuestion && (
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What question should it reason about?"
            rows={2}
            style={{
              width: '100%',
              marginTop: 10,
              fontSize: 12.5,
              padding: '8px 10px',
              border: '1px solid var(--rule)',
              borderRadius: 7,
              background: 'var(--white)',
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
            // hasQuestion: the house already carries a human-typed question —
            // the pipeline reasons FROM it, never overwrites it. Otherwise,
            // what's typed here becomes houses.question via the ordinary
            // SET_QUESTION action — a human's own text, dispatched before the
            // run starts, not the AI's (invariant 1; see houseMapping.ts).
            const q = hasQuestion ? state.question : question.trim()
            if (!hasQuestion && q) dispatch({ type: 'SET_QUESTION', value: q })
            runner.start(q)
          }}
          disabled={!ready}
          style={{ ...primaryBtn, opacity: ready ? 1 : 0.55, cursor: ready ? 'pointer' : 'not-allowed' }}
        >
          Run the reasoning pipeline
        </button>
      </div>
    )
  }

  // ── Done: APPLY_REASONING_RESULT already dispatched by the hook the moment
  // final-composition landed — the house is no longer blank, and DraftCard's
  // existing review-and-claim UI takes over from here. Nothing left to show.
  if (runner.phase === 'done') return null

  // ── Running / paused / awaiting-input / halted.
  return (
    <div style={cardStyle} className="fade-in">
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
        {runner.phase === 'running'
          ? 'Reasoning…'
          : runner.phase === 'halted'
            ? 'Pipeline halted'
            : runner.phase === 'awaiting-input'
              ? 'Clarification needed'
              : 'Reasoning paused'}
      </div>

      <div style={{ marginTop: 10 }}>
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
        <div style={{ fontSize: 11.5, color: 'var(--amber-text)', marginTop: 10, lineHeight: 1.4 }}>
          {runner.retryInfo.reason === 'rate-limited' ? 'Upstream provider rate-limited' : 'Network hiccup'} — retrying in{' '}
          {Math.round(runner.retryInfo.waitMs / 1000)}s…
        </div>
      )}

      {runner.regenerationInfo && (
        <div style={{ fontSize: 11.5, color: 'var(--amber-text)', marginTop: 10, lineHeight: 1.4 }}>
          {runner.regenerationInfo.attempt >= MASTER_REVIEW_ATTEMPT
            ? 'Still failing review after several attempts — one final, guided attempt…'
            : `Failed review — regenerating with the panel's feedback (attempt ${runner.regenerationInfo.attempt}/${MAX_REGENERATION_ATTEMPTS})…`}
        </div>
      )}

      {runner.errorCode && (
        <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 10, lineHeight: 1.45 }}>
          {runner.errorCode === RATE_LIMITED_CODE
            ? RATE_LIMITED_COPY
            : runner.errorCode === 'ai-network-error'
              ? 'Network hiccup — check your connection and retry.'
              : // 2026-09-09, Samir's spec: softened from the old raw "Could
                // not reach the reasoning pipeline." — now that
                // TRANSIENT_ERROR_CODES (useReasoningPipelineRunner.ts) +
                // Fix 2 Part A's degrade-and-continue mean this only fires
                // on a genuine, rare, unrecoverable exception.
                'Hit a snag — try again, or start a new run if it keeps happening.'}
        </div>
      )}

      {runner.subElementFailures && runner.subElementFailures.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink-subtle)', marginTop: 6, lineHeight: 1.4 }}>
          {runner.subElementFailures.map((f, i) => (
            <div key={i}>
              {f.stanceLabel} — {f.subElement.replace('_', ' ')}: {f.errorMessage}
            </div>
          ))}
        </div>
      )}

      {runner.haltReason && (
        <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 10, lineHeight: 1.45 }}>{runner.haltReason}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
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
  )
}

// See module header comment: never automatic, always one explicit click,
// dispatching the pre-existing SET_CONCLUSION/SET_REASONING actions (not
// AiActionSchema — that type deliberately has no variant for either field).
export function ReasoningConclusionSuggestion({
  state,
  dispatch,
  runner,
}: {
  state: State
  dispatch: React.Dispatch<Action>
  runner: ReasoningPipelineRunner
}) {
  const conclusions = runner.run.conclusions
  const finalAnswer = runner.run.finalAnswer
  if (runner.phase !== 'done' || !conclusions || !finalAnswer) return null
  // Already written (by the person, or already adopted) — the suggestion's
  // job is done; it must not keep dangling a stale "Use as my conclusion"
  // button that would silently clobber what's there now.
  if (state.conclusion.trim().length > 0) return null

  return (
    <div style={{ ...cardStyle, border: '1px solid var(--amber)' }} className="fade-in">
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>The pipeline reasoned to a conclusion</div>
      <div style={{ fontSize: 12, color: 'var(--ink-subtle)', marginTop: 3, lineHeight: 1.45 }}>
        The AI never writes your conclusion for you — this is only a suggestion. Read it, then
        decide whether to use it as your starting point.
      </div>
      <ul style={{ marginTop: 8, paddingLeft: 18 }}>
        {conclusions.conclusions.map((c, i) => (
          <li key={i} style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, marginTop: i === 0 ? 0 : 4 }}>
            {c}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'SET_CONCLUSION', value: conclusions.conclusions.join('\n\n') })
            dispatch({ type: 'SET_REASONING', value: finalAnswer.answer })
            dispatch({ type: 'SET_TOAST', value: 'Conclusion adopted — edit it freely, it is yours now' })
          }}
          style={primaryBtn}
        >
          Use as my conclusion
        </button>
        {/* Business mode (decision 021, Phase 3): the pipeline's own conclusion
            is exactly the kind of durable fact worth carrying up into the
            project — self-hides when there's no project. */}
        {state.projectId && (
          <SaveFactsToProjectButton projectId={state.projectId} facts={conclusions.conclusions} />
        )}
      </div>
    </div>
  )
}
