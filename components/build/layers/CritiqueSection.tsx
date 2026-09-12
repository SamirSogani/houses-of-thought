'use client'

// The Socratic critic on the Review layer. A deliberate, on-demand read of the
// whole house (POST /api/ai/critique) rendered beside the deterministic House
// Strength score — commentary only, never an input to the score (invariant 6).
// Not persisted: a critique is of a moment, not of the house.
// See plans/active/ai/07-critic.md.

import { useState } from 'react'
import type { Action, State } from '@/lib/build/types'
import { layers } from '@/lib/build/content'
import { serializeContent } from '@/lib/build/persistence'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'
import { SparkIcon } from '../buildIcons'

type Grade = 'strong' | 'mixed' | 'weak'

interface Critique {
  headline: string
  standards: { standard: string; grade: Grade; note: string; question: string }[]
  weakestLink: { layer: number; why: string; question: string }
}

type Phase =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'done'; critique: Critique; hash: string }

const GRADE_STYLE: Record<Grade, { color: string; bg: string }> = {
  strong: { color: 'var(--green-text)', bg: 'rgba(63,143,91,0.12)' },
  mixed: { color: 'var(--amber-text)', bg: 'var(--amber-tint)' },
  weak: { color: 'var(--warning-text)', bg: 'rgba(194,104,43,0.12)' },
}

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

const monoLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.11em',
  color: 'var(--ink-subtle)',
}

export function CritiqueSection({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const liveHash = hashString(serializeContent(state))
  const learn = state.mode === 'learn'

  async function inspect() {
    setPhase({ status: 'loading' })
    const content = serializeContent(state)
    try {
      const res = await fetch('/api/ai/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          house: JSON.parse(content),
          // Business mode (decision 021, Phase 3): see useSuggestions.ts's own
          // comment on this same field.
          projectContext: state.projectContext,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setPhase({ status: 'error', code: body.error ?? 'generic' })
        return
      }
      const critique = (await res.json()) as Critique
      setPhase({ status: 'done', critique, hash: hashString(content) })
    } catch {
      setPhase({ status: 'error', code: 'generic' })
    }
  }

  const stale = phase.status === 'done' && phase.hash !== liveHash

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ ...monoLabel, marginBottom: 12 }}>The co-pilot&apos;s read</div>

      <div style={{ background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 14, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: '46ch' }}>
            <span style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', borderRadius: 9, flex: '0 0 auto' }}>
              <SparkIcon size={16} fill="var(--amber)" />
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Inspect the house</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)', marginTop: 3, lineHeight: 1.5 }}>
                The score is computed. This is the co-pilot&apos;s critique — a firm, fair read of your reasoning.
              </div>
            </div>
          </div>
          {phase.status !== 'loading' && (
            <button
              type="button"
              onClick={inspect}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', background: 'var(--amber)', color: 'var(--ink)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >
              <SparkIcon size={14} fill="var(--ink)" />
              {phase.status === 'done' ? 'Re-inspect' : 'Inspect the house'}
            </button>
          )}
        </div>

        {phase.status === 'loading' && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-subtle)', marginBottom: 12 }}>Walking the house…</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ height: 12, background: 'var(--rule)', borderRadius: 4, width: `${90 - i * 12}%`, opacity: 0.6 }} />
              ))}
            </div>
          </div>
        )}

        {phase.status === 'error' && (
          phase.code === RATE_LIMITED_CODE ? (
            <div style={{ marginTop: 16, fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{RATE_LIMITED_COPY}</div>
          ) : (
            <div style={{ marginTop: 16, fontSize: 13, color: 'var(--ink)' }}>
              Couldn&apos;t reach the co-pilot.{' '}
              <button type="button" onClick={inspect} style={{ color: 'var(--blueprint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>
                Retry
              </button>
            </div>
          )
        )}

        {phase.status === 'done' && (
          <div style={{ marginTop: 18 }}>
            {stale && (
              <div style={{ fontSize: 12, color: 'var(--ink-subtle)', marginBottom: 12 }}>
                House changed since this critique —{' '}
                <button type="button" onClick={inspect} style={{ color: 'var(--blueprint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>
                  re-inspect
                </button>
              </div>
            )}

            <div style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.55, fontWeight: 500 }}>{phase.critique.headline}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
              {phase.critique.standards.map((s) => {
                const gs = GRADE_STYLE[s.grade] ?? GRADE_STYLE.mixed
                return (
                  <div key={s.standard} style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink)', minWidth: 66 }}>{s.standard}</span>
                      <span className="mono" style={{ fontSize: 9, textTransform: 'uppercase', color: gs.color, background: gs.bg, borderRadius: 5, padding: '2px 8px' }}>{s.grade}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-mid)', lineHeight: 1.5, marginTop: 6 }}>
                      {learn ? s.question : s.note}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Weakest link — the single point where the house most likely fails. */}
            <div style={{ marginTop: 18, border: '1.5px solid var(--ink)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--warning-text)' }}>
                  Weakest link · {layers[phase.critique.weakestLink.layer - 1]?.key ?? `Layer ${phase.critique.weakestLink.layer}`}
                </span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'GO_STEP', n: phase.critique.weakestLink.layer })}
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--blueprint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  Go to layer
                </button>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55, marginTop: 8 }}>
                {learn ? phase.critique.weakestLink.question : phase.critique.weakestLink.why}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
