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
// Phase 1 only: no generation engine yet, so createDeepDive only ever
// inserts a 'pending' row with a null result — Phase 2 is what will advance
// status to 'done'/'error' and fill in result.

import type { SupabaseClient } from '@supabase/supabase-js'

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
// dependent jsonb (same convention as projects.context, 0049) — always null
// in Phase 1, since nothing writes it yet.
export interface DeepDiveRow {
  id: string
  project_id: string
  owner_id: string
  domain: DeepDiveDomain
  prompt: string
  status: DeepDiveStatus
  result: unknown | null
  saved_to_project: boolean
  created_at: string
  updated_at: string
}

export const DEEP_DIVE_COLUMNS =
  'id, project_id, owner_id, domain, prompt, status, result, saved_to_project, created_at, updated_at'

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

// Inserts a fresh 'pending' row. No generation call here — Phase 2 wires the
// engine that actually fills in `result` and advances `status`.
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
