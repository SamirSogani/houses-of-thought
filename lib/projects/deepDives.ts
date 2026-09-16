// Types + CRUD for Project Deep Dives (decision 022,
// plans/active/project-deep-dives/01-schema-and-entry-points.md). Row shape
// and helper pattern mirror lib/projects/data.ts; project_deep_dives is
// owner-scoped exactly like projects, RLS mirrors it too (see
// supabase/migrations/0052_project_deep_dives.sql).
//
// One engine, four configs (decision 022 §1, plan README's invariant 1): the
// four boxes on the project page and the single parameterized
// /projects/[id]/deep-dive/[domain] route both read DEEP_DIVE_DOMAIN_META
// from here rather than each hardcoding its own copy of the label/
// description/valid-domain list.
//
// Phase 2 (decision 022, plans/active/project-deep-dives/
// 02-generation-engine.md) adds the generation engine itself
// (app/api/ai/deep-dive/route.ts) plus the four progress columns below and
// nextDeepDiveAction/deepDiveStatusLabel — the one shared state machine both
// that route (to decide what unit of work to do next) and the Deep Dive page
// (to show a plain status label while it polls) read, so the two can never
// silently disagree about what a given row's state means.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_REGENERATION_ATTEMPTS, MASTER_REVIEW_ATTEMPT } from '@/lib/ai/reasoning/budget'
import type { ReviewPanelVerdict, MasterReviewGuidance } from '@/lib/ai/reasoning/contracts'

export type DeepDiveDomain = 'perspectives' | 'assumptions' | 'research' | 'implications'
export type DeepDiveStatus = 'pending' | 'done' | 'error'

export const DEEP_DIVE_DOMAINS: DeepDiveDomain[] = ['perspectives', 'assumptions', 'research', 'implications']

export function isDeepDiveDomain(value: string): value is DeepDiveDomain {
  return (DEEP_DIVE_DOMAINS as string[]).includes(value)
}

// Label + one-line description shown on the project page's box and the deep
// dive page's breadcrumb/heading. Copy only — no schema/prompt wiring yet
// (that's Phase 2, decision 022 §2).
export const DEEP_DIVE_DOMAIN_META: Record<DeepDiveDomain, { label: string; description: string }> = {
  perspectives: {
    label: 'Perspectives',
    description: 'One panel-reviewed take on how a stance would frame this project.',
  },
  assumptions: {
    label: 'Assumptions',
    description: 'Surface and stress-test what this project is quietly assuming.',
  },
  research: {
    label: 'Research',
    description: "Pull evidence and sources scoped to this project's own context.",
  },
  implications: {
    label: 'Implications',
    description: 'Think through the downstream consequences of where this is headed.',
  },
}

// Shape of a public.project_deep_dives row. `result` is app-level, domain-
// dependent jsonb (same convention as projects.context, 0049) — null until
// the engine (app/api/ai/deep-dive/route.ts) writes a 'done' verdict.
// attempt/draft/verdict/master_guidance (Phase 2, migration 0052's own
// added-in-Phase-2 columns) are the engine's own persisted progress state —
// see nextDeepDiveAction below for what each means and how they compose.
export interface DeepDiveRow {
  id: string
  project_id: string
  owner_id: string
  domain: DeepDiveDomain
  prompt: string
  status: DeepDiveStatus
  result: unknown | null
  saved_to_project: boolean
  attempt: number
  draft: unknown | null
  verdict: ReviewPanelVerdict | null
  master_guidance: MasterReviewGuidance | null
  created_at: string
  updated_at: string
}

export const DEEP_DIVE_COLUMNS =
  'id, project_id, owner_id, domain, prompt, status, result, saved_to_project, attempt, draft, verdict, master_guidance, created_at, updated_at'

function rowFromSelect(data: unknown): DeepDiveRow {
  return data as DeepDiveRow
}

// Every Deep Dive run for this project + domain, most recent first. RLS
// (owner_id = auth.uid()) already scopes this to the caller; same
// defense-in-depth style as lib/projects/data.ts's listProjects.
export async function listDeepDives(
  supabase: SupabaseClient,
  projectId: string,
  domain: DeepDiveDomain
): Promise<DeepDiveRow[]> {
  const { data, error } = await supabase
    .from('project_deep_dives')
    .select(DEEP_DIVE_COLUMNS)
    .eq('project_id', projectId)
    .eq('domain', domain)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowFromSelect)
}

export async function getDeepDive(supabase: SupabaseClient, id: string): Promise<DeepDiveRow | null> {
  const { data, error } = await supabase
    .from('project_deep_dives')
    .select(DEEP_DIVE_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? rowFromSelect(data) : null
}

// Inserts a fresh 'pending' row (attempt/draft/verdict/master_guidance all
// start at their column defaults — null/1). No generation call here — the
// caller (the Deep Dive page) is responsible for kicking off
// app/api/ai/deep-dive/route.ts's poll loop right after this resolves.
export async function createDeepDive(
  supabase: SupabaseClient,
  input: { projectId: string; ownerId: string; domain: DeepDiveDomain; prompt: string }
): Promise<DeepDiveRow> {
  const { data, error } = await supabase
    .from('project_deep_dives')
    .insert({
      project_id: input.projectId,
      owner_id: input.ownerId,
      domain: input.domain,
      prompt: input.prompt,
      status: 'pending',
    })
    .select(DEEP_DIVE_COLUMNS)
    .single()
  if (error || !data) throw error ?? new Error('Failed to create deep dive')
  return rowFromSelect(data)
}

// ── Generation engine state machine (Phase 2) ───────────────────────────────
// One route call (app/api/ai/deep-dive/route.ts) does exactly ONE of these
// per invocation — never chains more than one across an HTTP round trip, the
// same "one unit of work per request" discipline the house pipeline's own
// step dispatcher uses, at a much smaller scale (one subject, not an
// n-perspective fan-out). Pure function of the row's own persisted state, so
// the route (deciding what to DO next) and the page (deciding what LABEL to
// show while that's in flight) can never disagree:
//
//  draft null                                      -> 'generate'
//  draft set, verdict null                         -> 'review'
//  verdict set (failing), attempt < MAX_REGEN       -> 'regenerate'
//  verdict set (failing), attempt === MAX_REGEN,
//    master_guidance null                          -> 'master-review'
//  verdict set (failing), attempt === MAX_REGEN,
//    master_guidance set                           -> 'master-regenerate'
//  status no longer 'pending' (done/error)          -> 'idle'
//
// A passing verdict is never left sitting on a 'pending' row — the 'review'
// action itself writes status:'done' in the same call that sees pass:true,
// and likewise writes status:'error' if the FINAL attempt (MASTER_REVIEW_
// ATTEMPT) still fails — so by construction, any row this function still
// finds 'pending' with a verdict already on it is always a failing,
// non-final verdict awaiting its next regeneration step. The final `return
// 'error'` below is a defensive fallback for that invariant only, not a real
// path the route should ever take.
export type DeepDiveAction = 'generate' | 'review' | 'regenerate' | 'master-review' | 'master-regenerate' | 'idle' | 'error'

export function nextDeepDiveAction(
  row: Pick<DeepDiveRow, 'status' | 'attempt' | 'draft' | 'verdict' | 'master_guidance'>
): DeepDiveAction {
  if (row.status !== 'pending') return 'idle'
  if (row.draft == null) return 'generate'
  if (row.verdict == null) return 'review'
  if (row.attempt < MAX_REGENERATION_ATTEMPTS) return 'regenerate'
  if (row.master_guidance == null) return 'master-review'
  if (row.attempt < MASTER_REVIEW_ATTEMPT) return 'master-regenerate'
  return 'error'
}

// Plain-language status label for the Deep Dive page's poll loop — present-
// progressive tone and the "Review panel checking…" phrasing borrowed
// directly from lib/ai/reasoning/steps.ts's STEP_LABELS (the house rail's own
// convention for this exact kind of state), not invented fresh.
export function deepDiveStatusLabel(
  row: Pick<DeepDiveRow, 'status' | 'attempt' | 'draft' | 'verdict' | 'master_guidance'>
): string {
  if (row.status === 'done') return 'Done'
  if (row.status === 'error') return 'Error'
  switch (nextDeepDiveAction(row)) {
    case 'generate':
      return 'Generating…'
    case 'review':
      return row.attempt < MASTER_REVIEW_ATTEMPT
        ? `Review panel checking (attempt ${row.attempt} of ${MAX_REGENERATION_ATTEMPTS})…`
        : 'Review panel checking (final attempt)…'
    case 'regenerate':
      return `Revising (attempt ${row.attempt + 1} of ${MAX_REGENERATION_ATTEMPTS})…`
    case 'master-review':
      return 'A senior reviewer is synthesizing feedback…'
    case 'master-regenerate':
      return 'Revising with senior guidance (final attempt)…'
    default:
      return 'Pending…'
  }
}

// Client-side last resort when the Deep Dive page's own poll loop
// (app/projects/[id]/deep-dive/[domain]/page.tsx) exhausts its transient-
// error retries without ever reaching a terminal response from
// app/api/ai/deep-dive/route.ts (repeated network failures, not a real
// review-panel verdict) — marks the row failed so it doesn't sit at
// 'pending' forever with nothing left polling it. RLS (owner_id =
// auth.uid()) lets the owner write their own row directly, same as every
// other Deep Dive write in this file.
export async function markDeepDiveError(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('project_deep_dives').update({ status: 'error' }).eq('id', id)
  if (error) throw error
}
