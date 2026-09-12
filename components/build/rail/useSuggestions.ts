'use client'

// Co-pilot suggestions for one layer, as a hook (builder-workspace-redesign
// plan §3, phase 2). Extracted from CopilotPanel so the Overview tab can show
// the same suggestions without a second fetch path: both tabs read and write
// the one SuggestCache owned by BuildHousePage, and only one tab is mounted at
// a time, so a switch serves from cache rather than refetching.
//
// Nothing enters the house without a click (invariant 2): `add` dispatches
// APPLY_AI_ACTION for a finding's action; `skip` only hides the card. Both
// record the index in the cache entry's `consumed` so a revisit never re-offers
// a card that was already acted on (bl-M1).

import { useEffect, useRef, useState } from 'react'
import type { Action, State } from '@/lib/build/types'
import type { Finding } from '@/lib/ai/findings'
import { aiActionApplicable } from '@/lib/build/aiActions'
import { serializeContent } from '@/lib/build/persistence'

// Suggestion cache, keyed by step. `consumed` (the indexes the user Added or
// Skipped) lives in the entry so a step revisit doesn't re-offer them.
export type SuggestCache = Map<number, { findings: Finding[]; hash: string; consumed: number[] }>

// Cheap, stable content fingerprint (djb2) so we can tell "the house changed
// since this fetch" without diffing — protects tokens while the user types.
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

export type SuggestStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'success'; findings: Finding[]; hash: string }

export interface Suggestions {
  fetchState: SuggestStatus
  // Findings not yet Added or Skipped, with their original index (the cache key).
  visible: { finding: Finding; idx: number }[]
  // True once the house has changed since these findings were fetched.
  stale: boolean
  refresh: () => void
  add: (finding: Finding, idx: number) => void
  skip: (idx: number) => void
}

export function useSuggestions({
  state,
  dispatch,
  step,
  suggestCache,
}: {
  state: State
  dispatch: React.Dispatch<Action>
  step: number
  // Hoisted cache (BuildHousePage). Optional so a caller still works standalone;
  // without it the cache dies with the caller.
  suggestCache?: React.RefObject<SuggestCache>
}): Suggestions {
  const localCacheRef = useRef<SuggestCache>(new Map())
  const cacheRef = suggestCache ?? localCacheRef
  const abortRef = useRef<AbortController | null>(null)

  const [fetchState, setFetchState] = useState<SuggestStatus>({ status: 'idle' })
  const [consumed, setConsumed] = useState<Set<number>>(new Set())

  // Live fingerprint of the persistable house — recomputed each render so a
  // "house changed" hint can appear as the user types, without refetching.
  const liveHash = hashString(serializeContent(state))

  // Not memoized: the React Compiler rule rejects a manual useCallback that
  // reads cacheRef.current, and nothing depends on this function's identity —
  // the auto-fetch effect below is keyed on `step`, and refresh/retry call it
  // from event handlers.
  const runFetch = async (targetStep: number) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const content = serializeContent(state)
    const hash = hashString(content)
    setFetchState({ status: 'loading' })
    setConsumed(new Set())

    try {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          house: JSON.parse(content),
          step: targetStep,
          mode: state.mode,
          // Business mode (decision 021, Phase 3): folded into the same
          // per-house AI context the interviewer already establishes
          // (lib/ai/serialize.ts) — never persisted onto the house itself.
          projectContext: state.projectContext,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setFetchState({ status: 'error', code: body.error ?? 'ai-upstream-error' })
        return
      }
      const { findings } = (await res.json()) as { findings: Finding[] }
      cacheRef.current.set(targetStep, { findings, hash, consumed: [] })
      setFetchState({ status: 'success', findings, hash })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setFetchState({ status: 'error', code: 'ai-network-error' })
    }
  }

  // Auto-fetch on mount / step change: serve cache if present, else fetch once.
  useEffect(() => {
    const cached = cacheRef.current.get(step)
    if (cached) {
      setFetchState({ status: 'success', findings: cached.findings, hash: cached.hash })
      // Restore what was already Added/Skipped — a revisit must not re-offer it.
      setConsumed(new Set(cached.consumed))
      return
    }
    runFetch(step)
    return () => abortRef.current?.abort()
    // Only step drives (re)fetching; typing must not. runFetch reads live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Event-handler callbacks: no manual memoization (the React Compiler rule
  // rejects useCallback deps that name a ref whose .current is read inside,
  // and nothing depends on these functions' identity).
  const consume = (idx: number) => {
    setConsumed((prev) => new Set(prev).add(idx))
    const entry = cacheRef.current.get(step)
    if (entry && !entry.consumed.includes(idx)) entry.consumed.push(idx)
  }

  const add = (finding: Finding, idx: number) => {
    // A stale card (its target deleted/renamed since the fetch, or the item
    // already added) used to vanish silently while adding nothing (bl-M2).
    // Say so and KEEP the card unconsumed.
    if (finding.action && !aiActionApplicable(state, finding.action)) {
      dispatch({ type: 'SET_TOAST', value: 'That suggestion no longer applies here.' })
      return
    }
    if (finding.action) dispatch({ type: 'APPLY_AI_ACTION', action: finding.action })
    consume(idx)
  }

  const skip = (idx: number) => consume(idx)

  const visible =
    fetchState.status === 'success'
      ? fetchState.findings.map((finding, idx) => ({ finding, idx })).filter(({ idx }) => !consumed.has(idx))
      : []
  const stale = fetchState.status === 'success' && fetchState.hash !== liveHash

  return { fetchState, visible, stale, refresh: () => runFetch(step), add, skip }
}
