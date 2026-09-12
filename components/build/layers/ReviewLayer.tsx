// Layer 7 — Review (House Strength detail + strengthen list). See 05 §11 / 07 §6.4.
// The old Publish/Export buttons were success-toast theater over no-ops and were
// removed until those features exist — audit 2026-07-19, ai-slop §3.

import type { Action, State } from '@/lib/build/types'
import type { Strength } from '@/lib/build/strength'
import { strengthColor, axisLabel, overallLabel, overallSummary } from '@/lib/build/strength'
import { axisMeasures } from '@/lib/build/content'
import { draftGateLocked, unclaimedDraftStages } from '@/lib/ai/draft'
import { ChevronRight } from '../buildIcons'
import { CritiqueSection } from './CritiqueSection'
import { SaveFactsToProjectButton } from '../SaveToProjectButton'

const monoLabel = (extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.11em',
  color: 'var(--ink-subtle)',
  ...extra,
})

export function ReviewLayer({
  state,
  strength,
  dispatch,
}: {
  state: State
  strength: Strength
  dispatch: React.Dispatch<Action>
}) {
  const overallCol = strengthColor(strength.overall)
  const implTotal = state.pos.length + state.neg.length + state.unc.length
  // Draft gate (016 §2): score stays deterministic (invariant 6); while
  // AI-drafted layers await their claim it is labeled provisional and
  // publish/export stay locked (the reducer also blocks them).
  const draftLocked = draftGateLocked(state.draft)
  const unclaimedCount = unclaimedDraftStages(state.draft).length

  const axes = [
    { name: 'Evidence', score: strength.evidence, measures: axisMeasures.Evidence, driver: `${state.evidence.length} sourced facts` },
    { name: 'Logic', score: strength.logic, measures: axisMeasures.Logic, driver: `${state.assumptions.length} assumptions, ${state.conclusion?.trim() ? 'conclusion set' : 'no conclusion'}, ${implTotal} implications` },
    { name: 'Coverage', score: strength.coverage, measures: axisMeasures.Coverage, driver: `${state.perspectives.length} perspectives` },
  ]

  const strengthenList: { text: string; delta: string; go: number }[] = []
  if (state.evidence.length < 5) strengthenList.push({ text: 'Add sourced evidence to raise Evidence.', delta: '+ Evidence', go: 3 })
  if (state.perspectives.length < 7) strengthenList.push({ text: 'Add a missing perspective to widen Coverage.', delta: '+ Coverage', go: 2 })
  strengthenList.push({ text: 'Name counterarguments on your weaker perspectives to firm up Logic.', delta: '+ Logic', go: 2 })

  return (
    <div className="fade-in" style={{ marginTop: 24 }}>
      {/* Overall card */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 14, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, color: overallCol, lineHeight: 1 }}>{strength.overall}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)' }}>/ 100</span>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 10, color: overallCol, border: `1px solid ${overallCol}`, borderRadius: 5, padding: '3px 9px' }}>
              {overallLabel(strength.overall)}
            </span>
            {draftLocked && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--amber-text)', border: '1px dashed var(--amber)', borderRadius: 5, padding: '3px 9px' }}>
                Provisional · AI draft unclaimed
              </span>
            )}
          </span>
          <div style={{ fontSize: 15, color: 'var(--ink-mid)', marginTop: 11, lineHeight: 1.55 }}>
            {draftLocked
              ? `This score counts AI-drafted material you have not claimed yet. Review and claim ${unclaimedCount === 1 ? 'the remaining layer' : `the ${unclaimedCount} remaining layers`} to make it yours.`
              : overallSummary(strength.overall)}
          </div>
        </div>
      </div>

      {/* The three scores */}
      <div style={monoLabel({ margin: '24px 0 12px' })}>The three scores</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {axes.map((a) => {
          const col = strengthColor(a.score)
          return (
            <div key={a.name} style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18, color: 'var(--ink)' }}>{a.name}</span>
                  <span className="mono" style={{ fontSize: 9, color: col, border: `1px solid ${col}`, borderRadius: 5, padding: '2px 9px' }}>{axisLabel(a.score)}</span>
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, color: col }}>{a.score}</span>
              </div>
              <div style={{ height: 7, background: 'var(--rule)', borderRadius: 4, overflow: 'hidden', marginTop: 12 }}>
                <div className="build-bar-fill" style={{ height: '100%', width: `${a.score}%`, background: col, transition: 'width 0.4s cubic-bezier(0.2,0.7,0.2,1)' }} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-mid)', marginTop: 12, lineHeight: 1.5 }}>{a.measures}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)' }}>Driving this score</span>
                <span style={{ fontSize: 12, color: 'var(--ink)' }}>{a.driver}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Weighting note */}
      <div style={{ marginTop: 14, background: 'var(--parchment)', border: '1px solid var(--rule)', borderRadius: 10, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)' }}>How the overall is weighted</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>
          Evidence <strong>40%</strong> · Logic <strong>35%</strong> · Coverage <strong>25%</strong>
        </span>
      </div>

      {/* To strengthen this house */}
      <div style={monoLabel({ margin: '24px 0 12px', color: 'var(--amber-text)' })}>To strengthen this house</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {strengthenList.map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => dispatch({ type: 'GO_STEP', n: item.go })}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 11, padding: '13px 15px' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--ink)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--rule)')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--amber-tint)', borderRadius: 7, color: 'var(--ink)', fontWeight: 600, flex: '0 0 auto' }}>+</span>
              <span style={{ fontSize: 14, color: 'var(--ink)', textAlign: 'left' }}>{item.text}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--green-text)' }}>{item.delta}</span>
              <ChevronRight size={14} stroke="var(--ink-subtle)" />
            </span>
          </button>
        ))}
      </div>

      {/* Co-pilot critique — commentary beside the score, never an input to it. */}
      <CritiqueSection state={state} dispatch={dispatch} />

      {/* Business mode (decision 021, Phase 3): a one-click way to carry this
          house's interview facts up into the owning project's accumulating
          context — self-hides when there's no project, or no facts yet. */}
      {state.projectId && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <SaveFactsToProjectButton projectId={state.projectId} facts={state.aiContext?.facts ?? []} />
        </div>
      )}

      {/* Closing panel — honest about what exists today. Sharing and PDF
          export ship later; a success toast for a no-op is worse than nothing. */}
      <div style={{ marginTop: 24, background: 'var(--ink)', color: 'var(--parchment)', borderRadius: 14, padding: '22px 24px' }}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
          {draftLocked ? 'Claim the draft to finish' : 'Your house is saved'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--rule)', marginTop: 8, maxWidth: '52ch', lineHeight: 1.5 }}>
          {draftLocked
            ? 'Review and claim every AI-drafted layer above — the strength score stays provisional until the reasoning is yours.'
            : 'Every change autosaves to your dashboard. Sharing and PDF export are on the roadmap; for classwork, turn the house in from your dashboard.'}
        </div>
      </div>
    </div>
  )
}
