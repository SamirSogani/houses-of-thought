// Server-only Brave Web Search client. Research Mode's ONLY source of evidence —
// candidates that don't trace to a URL returned here are dropped upstream
// (invariant 3: evidence cites only Brave results from the same request). Never
// model memory. See plans/active/ai/06-research-mode.md.

import { AiError } from './router'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/brave.ts is server-only and must not run in the browser')
}

export interface BraveResult {
  title: string
  url: string
  description: string
}

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

// Per-instance query counter for the admin monitor (same per-instance caveat as
// the router's health maps). Brave's free tier is 2,000 queries/month at 1 rps —
// this is the cheap "is something burning that quota right now?" signal.
let braveQueries = 0
const braveCountedSince = Date.now()
export function getBraveCounter(): { queries: number; since: number } {
  return { queries: braveQueries, since: braveCountedSince }
}

// Global pacing gate (2026-09-09, Samir, real-verified on production traffic
// from a phone: real "evidence provider rate limited" failures that never
// showed up as usage on Brave's own monthly-quota dashboard — because they
// weren't a quota breach, they were Brave's separate, per-second limiter
// firing on a same-second burst). The old defense against this lived ONLY in
// search.ts's runSearches() — a sequential for-loop with a 1100ms sleep — but
// that only serializes queries WITHIN one runSearches() call. The reasoning
// pipeline fans multiple perspectives' evidence-gathering out in parallel
// (Promise.all/allSettled, orchestrator-perspectives.ts's fanOutTracked), and
// each branch runs its own independent runSearches() loop with no knowledge
// of the others — two or three perspectives can each fire their first query
// in the same instant, bursting well past Brave's real 1 rps ceiling in
// aggregate even though account-wide usage stays nowhere near the monthly
// cap. Chaining every call to braveSearch through ONE promise queue — the
// only shared resource across every concurrent caller in this process —
// serializes them regardless of which branch they came from. JS's
// single-threaded execution makes this safe without a real lock: the
// `braveQueue =` reassignment below always runs to completion before any
// other call's `.then` can observe it.
let braveQueue: Promise<void> = Promise.resolve()
let lastBraveCallAt = 0
const BRAVE_MIN_INTERVAL_MS = 1100
function waitForBraveSlot(): Promise<void> {
  const turn = braveQueue.then(async () => {
    const wait = Math.max(0, lastBraveCallAt + BRAVE_MIN_INTERVAL_MS - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastBraveCallAt = Date.now()
  })
  // Never let one caller's rejection break the queue for callers behind it —
  // waitForBraveSlot() itself can't reject, but chaining defensively here
  // costs nothing and rules it out regardless of what changes upstream.
  braveQueue = turn.catch(() => {})
  return turn
}

export async function braveSearch(query: string, count = 6): Promise<BraveResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) throw new AiError(500, 'search-not-configured')
  await waitForBraveSlot()
  braveQueries += 1

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  let res: Response
  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
      },
      signal: controller.signal,
    })
  } catch {
    // Timeout / network error.
    throw new AiError(502, 'search-failed')
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 429) throw new AiError(429, 'search-rate-limited')
  if (!res.ok) throw new AiError(502, 'search-failed')

  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new AiError(502, 'search-failed')
  }

  // web.results[] → { title, url, description } (verified against Brave docs).
  const results = (data as { web?: { results?: unknown[] } })?.web?.results ?? []
  return results
    .map((r) => {
      const o = r as { title?: string; url?: string; description?: string }
      return {
        title: (o.title ?? '').trim(),
        url: (o.url ?? '').trim(),
        description: (o.description ?? '').trim(),
      }
    })
    .filter((r) => r.url.length > 0)
}
