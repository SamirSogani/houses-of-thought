// Persistence boundary between the Build reducer (integer ids, ephemeral view
// state) and the normalized Supabase schema (uuid ids, one child table per
// layer). The reducer and lib/build/types.ts are deliberately untouched — all
// row↔state mapping lives here. See plans/active/persistence/phase-3-builder.md
// and decisions/002-house-schema.md.
//
// Save protocol: every Supabase error is checked and thrown as a SaveError, the
// parent UPDATE is guarded by an optimistic-concurrency token (updated_at, the
// 0003 trigger bumps it), and loadHouse fails whole rather than treating a
// failed child select as an empty layer. The caller (BuildHousePage's save
// controller) owns retry/backoff, single-flighting, and the status UI. The
// replace itself is still not one transaction — the server half (a save_house
// RPC) is the DB plan's Phase-0 §3.

import type { Concept, Perspective, State } from './types'
import { doneCount } from './strength'

// A failed save, classified for the UI:
//   save-failed — transient (network/API) failure; safe to retry with backoff.
//   stale-write — the row changed since we loaded it (another tab/device); do
//                 NOT retry, the user must reload.
//   signed-out  — the session is gone; retrying can't succeed until re-auth.
export type SaveErrorCode = 'save-failed' | 'stale-write' | 'signed-out'

export class SaveError extends Error {
  constructor(
    public code: SaveErrorCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'SaveError'
  }
}

// Supabase doesn't type auth failures on data calls distinctly; recognize the
// common JWT-expiry shapes so the UI can say "sign in again" instead of retrying.
function classifyDbError(message: string | undefined): SaveErrorCode {
  if (message && /jwt|token.*expired|not.*authenticated|401/i.test(message)) return 'signed-out'
  return 'save-failed'
}

// Normalize stored concepts into { term, definition } objects. Tolerates the
// pre-definitions shape (a bare string[]) so older saved houses still load.
function toConcepts(raw: unknown): Concept[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c) =>
    typeof c === 'string'
      ? { term: c, definition: '' }
      : { term: (c?.term as string) ?? '', definition: (c?.definition as string) ?? '' }
  )
}

// Normalize stored perspectives, filling the detail fields (stance, sub-questions,
// supporting evidence, counters) so pre-detail saved houses still load.
function toPerspectives(raw: unknown): Perspective[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p, i) => ({
    id: typeof p?.id === 'number' ? p.id : i + 1,
    name: p?.name ?? '',
    summary: p?.summary ?? '',
    stance: p?.stance ?? '',
    subQuestions: Array.isArray(p?.subQuestions) ? p.subQuestions : [],
    supportingEvidence: Array.isArray(p?.supportingEvidence) ? p.supportingEvidence : [],
    counters: Array.isArray(p?.counters) ? p.counters : [],
    strength: typeof p?.strength === 'number' ? p.strength : 0,
    owner: p?.owner ?? 'you',
  }))
}
import type { HouseStatus } from '@/lib/dashboard/houses'

type Supabase = ReturnType<typeof import('@/lib/supabase/client').createClient>

// A real, empty house: the initialState shape with no content and default view
// state. Never write lib/build/state.ts's initialState to a real house — that is
// demo content. New houses load blank.
export function blankState(): State {
  return {
    step: 1,
    mode: 'decide',
    aiContext: null,
    draft: null,
    title: '',
    purpose: '',
    question: '',
    conclusion: '',
    reasoning: '',
    toast: '',
    concepts: [],
    perspectives: [],
    evidence: [],
    assumptions: [],
    pos: [],
    neg: [],
    unc: [],
    watchpoints: [],
    activePerspective: null,
    projectId: null,
    projectContext: null,
  }
}

// empty → no content at all; complete → all 7 layers done; else in-progress.
// Prose fields count as content: a house whose owner wrote only a conclusion is
// work in progress, not "Empty" (bl-M3 — the old list-only check showed teachers
// an "Empty" chip beside "1/7 layers").
export function deriveStatus(state: State): HouseStatus {
  if (doneCount(state) === 7) return 'complete'
  const hasContent =
    state.concepts.length > 0 ||
    state.perspectives.length > 0 ||
    state.evidence.length > 0 ||
    state.assumptions.length > 0 ||
    state.pos.length > 0 ||
    state.neg.length > 0 ||
    state.unc.length > 0 ||
    state.watchpoints.length > 0 ||
    [state.title, state.question, state.purpose, state.conclusion, state.reasoning].some(
      (t) => t.trim().length > 0
    )
  return hasContent ? 'in-progress' : 'empty'
}

// Local (no-login) persistence, backing the /house builder. Stores only the
// persistable subset (serializeContent's shape) in localStorage under one
// generic key, so any no-login builder shares the adapter. Deliberately no
// Supabase / auth / RLS — the counterpart to save/loadHouse below.
export const LOCAL_HOUSE_KEY = 'hot:house:draft'

export function saveLocalHouse(state: State): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCAL_HOUSE_KEY, serializeContent(state))
  } catch {
    // Quota exceeded or storage disabled (private mode): drop the write rather
    // than crash the editor. The in-memory reducer keeps working.
  }
}

export function loadLocalHouse(): State | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try {
    raw = window.localStorage.getItem(LOCAL_HOUSE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    // serializeContent stores full reducer objects, so fields map straight back
    // onto a blank house — no row↔state remapping needed (unlike loadHouse).
    const c = JSON.parse(raw) as Partial<State>
    const state = blankState()
    // Normalize the AI fields so pre-0010 drafts still load. Draft Mode is
    // account-only (016 §3), so local houses normally carry null here.
    state.mode = c.mode === 'learn' ? 'learn' : 'decide'
    state.aiContext = c.aiContext ?? null
    state.draft = c.draft ?? null
    state.title = c.title ?? ''
    state.purpose = c.purpose ?? ''
    state.question = c.question ?? ''
    state.conclusion = c.conclusion ?? ''
    state.reasoning = c.reasoning ?? ''
    state.concepts = toConcepts(c.concepts)
    state.perspectives = toPerspectives(c.perspectives)
    state.evidence = c.evidence ?? []
    state.assumptions = c.assumptions ?? []
    state.pos = c.pos ?? []
    state.neg = c.neg ?? []
    state.unc = c.unc ?? []
    state.watchpoints = c.watchpoints ?? []
    return state
  } catch {
    return null
  }
}

// THE single list of persisted State fields. serializeContent derives from it,
// so adding a content field to State means adding it here (and wiring the DB
// column in load/saveHouse) — the round-trip test fails until all agree.
export const PERSISTED_KEYS = [
  'mode',
  'aiContext',
  'draft',
  'title',
  'purpose',
  'question',
  'conclusion',
  'reasoning',
  'concepts',
  'perspectives',
  'evidence',
  'assumptions',
  'pos',
  'neg',
  'unc',
  'watchpoints',
] as const

export type PersistedContent = Pick<State, (typeof PERSISTED_KEYS)[number]>

// JSON of just the persistable subset — used as the autosave effect's dependency
// so ephemeral changes (step, tabs, toast, invite) never trigger a save.
export function serializeContent(state: State): string {
  return JSON.stringify(
    Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as PersistedContent
  )
}

// A loaded house plus its concurrency token (the parent row's updated_at at
// load time). Every save must present the token; see saveHouse.
export interface LoadedHouse {
  state: State
  rev: string
}

// Load a specific house into a reducer State, or null when the row does not
// exist, is not the caller's (RLS makes both look empty), or ANY select failed —
// a failed child select must not masquerade as an empty layer, because the next
// autosave would persist that emptiness over real rows. Integer ids are
// re-assigned sequentially per list by DB position, so nextId() keeps working.
export async function loadHouse(supabase: Supabase, id: string): Promise<LoadedHouse | null> {
  const { data: house, error } = await supabase
    .from('houses')
    .select('title, question, purpose, conclusion, reasoning, concepts, concept_definitions, watchpoints, mode, ai_context, draft, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !house) return null

  const [persp, evid, assum, implic] = await Promise.all([
    supabase.from('house_perspectives').select('*').eq('house_id', id).order('position'),
    supabase.from('house_evidence').select('*').eq('house_id', id).order('position'),
    supabase.from('house_assumptions').select('*').eq('house_id', id).order('position'),
    supabase.from('house_implications').select('*').eq('house_id', id).order('position'),
  ])
  if (persp.error || evid.error || assum.error || implic.error) return null

  const state = blankState()
  state.mode = house.mode === 'learn' ? 'learn' : 'decide'
  state.aiContext = (house.ai_context as State['aiContext'] | null) ?? null
  state.draft = (house.draft as State['draft'] | null) ?? null
  state.title = house.title ?? ''
  state.question = house.question ?? ''
  state.purpose = house.purpose ?? ''
  state.conclusion = house.conclusion ?? ''
  state.reasoning = house.reasoning ?? ''
  const conceptTerms = (house.concepts as string[] | null) ?? []
  const conceptDefs = (house.concept_definitions as string[] | null) ?? []
  state.concepts = conceptTerms.map((term, i) => ({ term, definition: conceptDefs[i] ?? '' }))
  state.watchpoints = house.watchpoints ?? []

  state.perspectives = (persp.data ?? []).map((r, i) => ({
    id: i + 1,
    name: r.name,
    summary: r.summary ?? '',
    stance: (r.stance as string | null) ?? '',
    subQuestions: (r.sub_questions as Perspective['subQuestions'] | null) ?? [],
    supportingEvidence: (r.supporting_evidence as Perspective['supportingEvidence'] | null) ?? [],
    counters: (r.counters as string[] | null) ?? [],
    strength: r.strength,
    owner: r.owner_key,
  }))

  state.evidence = (evid.data ?? []).map((r, i) => ({
    id: i + 1,
    text: r.text,
    source: r.source ?? '',
    owner: r.owner_key,
    byAI: r.by_ai,
    url: (r.url as string | null) ?? undefined,
  }))

  state.assumptions = (assum.data ?? []).map((r, i) => ({
    id: i + 1,
    text: r.text,
    owner: r.owner_key,
  }))

  const rows = implic.data ?? []
  const byKind = (kind: string) =>
    rows
      .filter((r) => r.kind === kind)
      .map((r, i) => ({ id: i + 1, text: r.text, horizon: r.horizon, who: r.who ?? '' }))
  state.pos = byKind('pos')
  state.neg = byKind('neg')
  state.unc = byKind('unc')

  return { state, rev: house.updated_at as string }
}

// The save_house(jsonb) payload. Deliberately its own shape rather than State:
// it is the wire contract with the RPC (migration 0027), which reads these exact
// keys. Exported so the round-trip test can assert on it without a DB.
export interface SaveHousePayload {
  title: string
  question: string
  purpose: string
  conclusion: string
  reasoning: string
  concepts: string[]
  conceptDefinitions: string[]
  watchpoints: string[]
  mode: State['mode']
  aiContext: State['aiContext']
  draft: State['draft']
  layersComplete: number
  status: HouseStatus
  perspectives: {
    name: string
    summary: string
    stance: string
    subQuestions: Perspective['subQuestions']
    supportingEvidence: Perspective['supportingEvidence']
    counters: string[]
    strength: number
    owner: string
  }[]
  evidence: { text: string; source: string; url: string | null; owner: string; byAI: boolean }[]
  assumptions: { text: string; owner: string }[]
  pos: { text: string; horizon: string; who: string }[]
  neg: { text: string; horizon: string; who: string }[]
  unc: { text: string; horizon: string; who: string }[]
}

// Flatten a reducer State into the RPC payload. Pure — no DB, no ids: the RPC
// assigns `position` from array order, exactly as the old per-table inserts did.
export function toSavePayload(state: State): SaveHousePayload {
  const implications = (list: State['pos']) =>
    list.map((x) => ({ text: x.text, horizon: x.horizon, who: x.who }))
  return {
    title: state.title,
    question: state.question,
    purpose: state.purpose,
    conclusion: state.conclusion,
    reasoning: state.reasoning,
    concepts: state.concepts.map((c) => c.term),
    conceptDefinitions: state.concepts.map((c) => c.definition),
    watchpoints: state.watchpoints,
    mode: state.mode,
    aiContext: state.aiContext,
    draft: state.draft,
    layersComplete: doneCount(state),
    status: deriveStatus(state),
    perspectives: state.perspectives.map((p) => ({
      name: p.name,
      summary: p.summary,
      stance: p.stance,
      subQuestions: p.subQuestions,
      supportingEvidence: p.supportingEvidence,
      counters: p.counters,
      strength: p.strength,
      owner: p.owner,
    })),
    evidence: state.evidence.map((e) => ({
      text: e.text,
      source: e.source,
      url: e.url ?? null,
      owner: e.owner,
      byAI: e.byAI,
    })),
    assumptions: state.assumptions.map((a) => ({ text: a.text, owner: a.owner })),
    pos: implications(state.pos),
    neg: implications(state.neg),
    unc: implications(state.unc),
  }
}

// Whole-house replace in ONE transactional round trip via the save_house RPC
// (migration 0027). Returns the NEW rev (the trigger-bumped updated_at) the
// caller must present on its next save.
//
// The RPC replaces what used to be up to nine sequential statements from the
// client. They were individually error-checked, but not atomic: a failure after
// a child DELETE and before its INSERT permanently emptied that layer, and two
// concurrent writers could interleave their delete/insert pairs (perf audit H3).
// Now the whole replace commits or rolls back as a unit.
//
// When expectedRev is given the parent UPDATE is conditioned on it, so a stale
// writer aborts before anything is deleted; the RPC raises 'stale-write', which
// maps to the SaveError code the save controller already knows how to handle.
export async function saveHouse(
  supabase: Supabase,
  id: string,
  state: State,
  expectedRev?: string
): Promise<string> {
  const { data, error } = await supabase.rpc('save_house', {
    p_id: id,
    p_expected_rev: expectedRev ?? null,
    p_content: toSavePayload(state),
  })

  if (error) {
    // The RPC raises the SaveErrorCode itself, so a recognized code passes
    // through verbatim; anything else is classified from the message.
    const message = error.message ?? ''
    const code: SaveErrorCode = message.includes('stale-write')
      ? 'stale-write'
      : message.includes('save-failed')
        ? 'save-failed'
        : classifyDbError(message)
    throw new SaveError(code, message)
  }
  if (typeof data !== 'string' || !data) {
    throw new SaveError('save-failed', 'save_house returned no rev')
  }
  return data
}
