'use client'

// Context-intake interviewer, mounted at the top of the co-pilot tab. Asks a few
// questions, then distills the answers into aiContext (summary + facts) that every
// other AI call reads. The transcript is never persisted — only the distilled
// context is dispatched (SET_AI_CONTEXT). Its in-memory home is BuildHousePage
// (useInterviewSession) so closing the mobile drawer or switching rail tabs —
// which unmount this card — no longer destroys a half-finished interview.
// See plans/active/ai/05-interviewer.md.

import { useEffect, useRef, useState } from 'react'
import type { Action, State } from '@/lib/build/types'
import { serializeContent } from '@/lib/build/persistence'
import { RATE_LIMITED_CODE, RATE_LIMITED_COPY } from '@/lib/ai/findings'

export type InterviewTurn = { role: 'user' | 'assistant'; content: string }
type Turn = InterviewTurn

// The hoistable session state: create it in BuildHousePage and pass it down so
// the transcript survives this card unmounting.
export interface InterviewSession {
  active: boolean
  setActive: React.Dispatch<React.SetStateAction<boolean>>
  transcript: InterviewTurn[]
  setTranscript: React.Dispatch<React.SetStateAction<InterviewTurn[]>>
}

export function useInterviewSession(): InterviewSession {
  const [active, setActive] = useState(false)
  const [transcript, setTranscript] = useState<InterviewTurn[]>([])
  return { active, setActive, transcript, setTranscript }
}

// After this many user answers the client stops asking and forces a summary.
const HARD_STOP_TURNS = 6

export function InterviewCard({
  state,
  dispatch,
  session,
  autoStart = false,
}: {
  state: State
  dispatch: React.Dispatch<Action>
  session?: InterviewSession
  // When true, this card starts itself instead of waiting for its own
  // "Start" button click. Unused by any caller as of plan doc 27
  // (2026-08-16) — the blank-house entry point that used to drive this
  // (CopilotPanel's "Enter reasoning pipeline" button) now starts the real
  // reasoning pipeline instead of an interview; kept as a general capability
  // of this card rather than removed, since a future standalone auto-start
  // use is still plausible.
  autoStart?: boolean
}) {
  // Hooks always run; the hoisted session (when provided) is the source of truth.
  const local = useInterviewSession()
  const { active, setActive, transcript, setTranscript } = session ?? local
  const [input, setInput] = useState('')
  const [inFlight, setInFlight] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  // Business mode (decision 021, Phase 5): what the last turn actually
  // retrieved from the project's own material, so the UI can say so
  // explicitly — never presented as Research Mode's Brave-sourced evidence
  // (the plan doc's own UI-distinction requirement). [] most of the time
  // (general mode, no project, or nothing relevant found).
  const [ragSources, setRagSources] = useState<{ sourceType: string; label: string }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  // "Finish early"/HARD_STOP_TURNS collapse the tall chat transcript down to
  // a short "Context set ✓" chip (the branch below) — on a rail/drawer that
  // was scrolled down mid-conversation, the chip then renders above the
  // viewport with nothing visibly changed, so the finish looked like it did
  // nothing. justFinishedRef marks a completion THIS render cycle (never an
  // ordinary mount with pre-existing aiContext) so the chip effect below
  // scrolls it into view exactly once, right after it appears.
  const chipRef = useRef<HTMLDivElement>(null)
  const justFinishedRef = useRef(false)
  useEffect(() => {
    if (active || !state.aiContext || !justFinishedRef.current) return
    justFinishedRef.current = false
    chipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [active, state.aiContext])

  const userTurns = transcript.filter((t) => t.role === 'user').length

  async function runInterview(sendTranscript: Turn[], forceSummary: boolean) {
    setInFlight(true)
    setErrorCode(null)
    try {
      const res = await fetch('/api/ai/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          house: JSON.parse(serializeContent(state)),
          transcript: sendTranscript,
          forceSummary,
          // Business mode (decision 021, Phase 3): see useSuggestions.ts's own
          // comment on this same field.
          projectContext: state.projectContext,
          // Business mode (decision 021, Phase 5): lets the route retrieve
          // this project's own document chunks — RLS-safe even though it's
          // client-supplied (see the route's own comment on this field).
          projectId: state.projectId,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorCode(body.error ?? 'generic')
        return
      }
      const data = (await res.json()) as {
        reply: string
        done: boolean
        context: { summary: string; facts: string[] } | null
        ragSources?: { sourceType: string; label: string }[]
      }
      setRagSources(data.ragSources ?? [])
      if (data.done && data.context) {
        dispatch({ type: 'SET_AI_CONTEXT', context: data.context })
        justFinishedRef.current = true
        setActive(false)
        setTranscript([])
      } else if (forceSummary) {
        // We told the server to wrap up and it still didn't produce a usable
        // context. Stop here instead of appending another question — otherwise a
        // wrap-up-refusing model loops paid turns forever. Retry re-forces.
        setErrorCode('summary-failed')
      } else {
        setTranscript([...sendTranscript, { role: 'assistant', content: data.reply }])
        // Scroll the newest bubble into view next paint.
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
      }
    } catch {
      setErrorCode('generic')
    } finally {
      setInFlight(false)
    }
  }

  function start() {
    setActive(true)
    setTranscript([])
    setErrorCode(null)
    setRagSources([])
    runInterview([], false)
  }

  function send() {
    const text = input.trim()
    if (!text || inFlight) return
    const next: Turn[] = [...transcript, { role: 'user', content: text }]
    setTranscript(next)
    setInput('')
    // Once the person has given HARD_STOP_TURNS answers, force the wrap-up.
    runInterview(next, userTurns + 1 >= HARD_STOP_TURNS)
  }

  function retry() {
    runInterview(transcript, userTurns >= HARD_STOP_TURNS)
  }

  // autoStart fires start() exactly once, only when nothing has happened yet
  // (no active conversation, no transcript, no context already set) — a
  // remount mid-conversation (drawer close/reopen, tab switch) sees active
  // already true from the hoisted session and this is a no-op, so the
  // consolidated entry point never restarts an interview in progress.
  useEffect(() => {
    if (autoStart && !active && transcript.length === 0 && !state.aiContext) start()
    // Fires only off the autoStart trigger; start()/active/transcript/state
    // are read fresh via closures, same pattern as the rest of this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  const cardStyle: React.CSSProperties = {
    background: 'var(--parchment)',
    border: '1px solid var(--rule)',
    borderRadius: 11,
    padding: 13,
    marginBottom: 16,
  }

  // Active interview view (takes precedence over the chip, so Redo works).
  if (active) {
    return (
      <div style={cardStyle} className="fade-in">
        <div ref={scrollRef} style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {transcript.map((t, i) => (
            <div
              key={i}
              style={{
                alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                fontSize: 12.5,
                lineHeight: 1.45,
                color: 'var(--ink)',
                background: t.role === 'user' ? 'var(--amber-tint)' : 'var(--white)',
                border: '1px solid var(--rule)',
                borderRadius: 10,
                padding: '8px 10px',
              }}
            >
              {t.content}
            </div>
          ))}
          {inFlight && (
            <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--ink-subtle)', padding: '4px 2px' }}>…</div>
          )}
        </div>

        {/* Business mode (decision 021, Phase 5): explicit, visible distinction
            from Research Mode's Brave-sourced evidence — this is retrieval
            over the person's OWN uploaded/accumulated project material. */}
        {ragSources.length > 0 && (
          <div
            className="mono"
            style={{ fontSize: 10, color: 'var(--amber-text)', marginTop: 8, lineHeight: 1.5 }}
          >
            Used your own project material — not verified evidence: {ragSources.map((s) => s.label).join(', ')}
          </div>
        )}

        {errorCode === RATE_LIMITED_CODE ? (
          <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 8, lineHeight: 1.45 }}>{RATE_LIMITED_COPY}</div>
        ) : errorCode === 'summary-failed' ? (
          <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 8 }}>
            Couldn&apos;t wrap up the interview.{' '}
            <button type="button" onClick={() => runInterview(transcript, true)} style={linkBtn}>Try finishing again</button>
          </div>
        ) : errorCode ? (
          <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 8 }}>
            Couldn&apos;t reach the co-pilot.{' '}
            <button type="button" onClick={retry} style={linkBtn}>Retry</button>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input
            className="bhp-input16" aria-label="Your answer"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            placeholder="Type your answer…"
            disabled={inFlight}
            style={{ flex: 1, minWidth: 0, fontSize: 12.5, padding: '7px 9px', border: '1px solid var(--rule)', borderRadius: 7, background: 'var(--white)', color: 'var(--ink)', outline: 'none' }}
          />
          <button
            type="button"
            onClick={send}
            disabled={inFlight || !input.trim()}
            style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink)', background: 'var(--amber-tint)', border: '1px solid var(--amber)', borderRadius: 7, padding: '0 12px', cursor: inFlight || !input.trim() ? 'not-allowed' : 'pointer', opacity: inFlight || !input.trim() ? 0.6 : 1 }}
          >
            Send
          </button>
        </div>

        {transcript.length > 0 && !inFlight && (
          <button type="button" onClick={() => runInterview(transcript, true)} className="mono" style={{ ...linkBtn, fontSize: 10, marginTop: 8 }}>
            Finish early
          </button>
        )}
      </div>
    )
  }

  // Collapsed chip once context exists.
  if (state.aiContext) {
    return (
      <div ref={chipRef} style={cardStyle} className="fade-in">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>Context set ✓</span>
          <button type="button" onClick={start} className="mono" style={{ ...linkBtn, fontSize: 10 }}>Redo</button>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-subtle)',
            lineHeight: 1.45,
            marginTop: 5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {state.aiContext.summary}
        </div>
      </div>
    )
  }

  // Intro: no context yet.
  return (
    <div style={cardStyle} className="fade-in">
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Give the co-pilot context</div>
      <div style={{ fontSize: 12, color: 'var(--ink-subtle)', marginTop: 3, lineHeight: 1.45 }}>
        It asks a few questions so suggestions fit your house.
      </div>
      <button
        type="button"
        onClick={start}
        style={{ marginTop: 10, fontWeight: 600, fontSize: 12, color: 'var(--ink)', background: 'var(--white)', border: '1px solid var(--ink)', borderRadius: 7, padding: '6px 13px', cursor: 'pointer' }}
      >
        Start
      </button>
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  color: 'var(--blueprint)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
  textDecoration: 'underline',
}
