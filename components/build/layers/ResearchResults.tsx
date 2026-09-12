'use client'

// Research Mode panel, mounted inline under the Evidence toolbar. Runs a Brave-
// backed search server-side and shows candidate evidence whose URLs are
// guaranteed to be real Brave results (validated in the route). Each Add lands
// evidence via APPLY_AI_ACTION (owner 'ai', byAI true, linked source chip).
// See plans/active/ai/06-research-mode.md.

import { useState } from 'react'
import type { Action, State } from '@/lib/build/types'
import { serializeContent } from '@/lib/build/persistence'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'
import { safeHttpUrl } from '@/lib/safeUrl'
import { SearchIcon } from '../buildIcons'

interface Candidate {
  claim: string
  quoteOrParaphrase: string
  sourceTitle: string
  url: string
}

type Phase =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'done'; candidates: Candidate[]; query: string }

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function ResearchResults({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const [focus, setFocus] = useState('')
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [consumed, setConsumed] = useState<Set<number>>(new Set())

  async function search() {
    setPhase({ status: 'loading' })
    setConsumed(new Set())
    try {
      const res = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          house: JSON.parse(serializeContent(state)),
          query: focus.trim() || undefined,
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
      const data = (await res.json()) as { candidates: Candidate[]; query: string }
      setPhase({ status: 'done', candidates: data.candidates, query: data.query })
    } catch {
      setPhase({ status: 'error', code: 'generic' })
    }
  }

  return (
    <div
      className="fade-in"
      style={{ border: '1px solid var(--rule)', borderRadius: 11, padding: 14, marginBottom: 14, background: 'var(--parchment)' }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="bhp-input16" aria-label="Research focus"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="What should I look for? — defaults to your question"
          disabled={phase.status === 'loading'}
          style={{ flex: 1, minWidth: 0, fontSize: 12.5, padding: '7px 9px', border: '1px solid var(--rule)', borderRadius: 7, background: 'var(--white)', color: 'var(--ink)', outline: 'none' }}
        />
        <button
          type="button"
          onClick={search}
          disabled={phase.status === 'loading'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: 12, color: 'var(--ink)', background: 'var(--amber-tint)', border: '1px solid var(--amber)', borderRadius: 7, padding: '0 12px', cursor: phase.status === 'loading' ? 'not-allowed' : 'pointer', opacity: phase.status === 'loading' ? 0.6 : 1 }}
        >
          <SearchIcon size={13} />
          Search
        </button>
      </div>

      {phase.status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ border: '1px solid var(--rule)', borderRadius: 9, padding: 12, opacity: 0.6, background: 'var(--white)' }}>
              <div style={{ height: 10, background: 'var(--rule)', borderRadius: 4, width: '90%' }} />
              <div style={{ height: 10, background: 'var(--rule)', borderRadius: 4, width: '55%', marginTop: 7 }} />
            </div>
          ))}
        </div>
      )}

      {phase.status === 'error' && (
        phase.code === RATE_LIMITED_CODE ? (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{RATE_LIMITED_COPY}</div>
        ) : phase.code === 'search-rate-limited' ? (
          // Brave's per-second limit, unlike the daily co-pilot cap — retrying
          // genuinely helps, so say so instead of the generic failure copy.
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink)' }}>
            Search is busy right now — it clears within a minute.{' '}
            <button type="button" onClick={search} style={{ color: 'var(--blueprint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>
              Retry
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink)' }}>
            Couldn&apos;t run the search.{' '}
            <button type="button" onClick={search} style={{ color: 'var(--blueprint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>
              Retry
            </button>
          </div>
        )
      )}

      {phase.status === 'done' && (
        <div style={{ marginTop: 12 }}>
          {phase.query && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--ink-subtle)', marginBottom: 10 }}>
              Searched: {phase.query}
            </div>
          )}
          {phase.candidates.filter((_, i) => !consumed.has(i)).length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-subtle)', lineHeight: 1.5 }}>
              Nothing solid found — try a narrower focus.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {phase.candidates.map((c, i) => {
                // The route already validates URLs against Brave's results; this is
                // defense-in-depth — a candidate without a safe http(s) URL is unusable
                // as a citation, so drop it rather than render a bad href / Add it.
                const href = safeHttpUrl(c.url)
                if (consumed.has(i) || !href) return null
                return (
                  <div key={i} className="pop" style={{ border: '1px solid var(--rule)', borderRadius: 9, padding: 12, background: 'var(--white)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{c.claim}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-subtle)', lineHeight: 1.45, marginTop: 5 }}>{c.quoteOrParaphrase}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8 }}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                        style={{ fontSize: 9, color: 'var(--blueprint)', background: 'rgba(62,92,138,0.09)', borderRadius: 4, padding: '3px 7px', textDecoration: 'none' }}
                      >
                        {domainOf(c.url)}
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          dispatch({
                            type: 'APPLY_AI_ACTION',
                            action: { kind: 'add_evidence', text: c.claim, source: domainOf(c.url), url: c.url },
                          })
                          setConsumed((prev) => new Set(prev).add(i))
                        }}
                        style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink)', background: 'var(--amber-tint)', border: '1px solid var(--amber)', borderRadius: 6, padding: '5px 11px', cursor: 'pointer' }}
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
