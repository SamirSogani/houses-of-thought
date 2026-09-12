// Types + CRUD for Projects (business/solo-founder mode, decision 021,
// plans/active/business-mode/01-projects-and-toggle.md). Row shape and helper
// pattern mirror lib/dashboard/houses.ts; `projects` is single-owner, same RLS
// shape as `houses` (see supabase/migrations/0048_workspace_mode_and_projects.sql).
//
// Unlike lib/profile/data.ts / lib/dashboard/houses.ts (pure row<->view mapping,
// with the actual supabase calls left inline in the pages), this module owns the
// query itself — /projects, /projects/[id], and the /build project picker all
// need the same reads/writes, so it's one shared source instead of three copies.

import type { SupabaseClient } from '@supabase/supabase-js'
import { editedLabel } from '@/lib/dashboard/houses'

export type ProjectStatus = 'active' | 'archived'

// Accumulating context (Phase 3, decision 021, plans/active/business-mode/
// 03-accumulating-context.md). App-level shape only — not enforced by a DB
// constraint (0049), same convention as profiles.perspectives and the house
// builder's State (context/architecture/data-model/app-level-shapes.md).
// keyFacts is append-only from the UI's perspective (see mergeKeyFacts below
// for how it's kept from growing unbounded) — most recent last.
export interface ProjectContext {
  stage?: string
  customer?: string
  businessModel?: string
  keyFacts: string[]
  updatedAt: string
}

// Cap decided here, this phase (03-accumulating-context.md explicitly defers
// this decision to "Phase 3"): keyFacts always gets folded into every prompt
// that reads it (lib/ai/serialize.ts), so it must stay small regardless of how
// long a project has existed.
export const MAX_KEY_FACTS = 20

export function emptyProjectContext(): ProjectContext {
  return { keyFacts: [], updatedAt: new Date(0).toISOString() }
}

// Coerces whatever the jsonb column actually holds (the `{}` DB default, a
// legacy/partial shape, or a well-formed ProjectContext) into a valid one —
// same defensive-normalization spirit as lib/profile/data.ts's rowToProfile.
export function normalizeProjectContext(raw: unknown): ProjectContext {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProjectContext>
  return {
    stage: typeof r.stage === 'string' && r.stage ? r.stage : undefined,
    customer: typeof r.customer === 'string' && r.customer ? r.customer : undefined,
    businessModel: typeof r.businessModel === 'string' && r.businessModel ? r.businessModel : undefined,
    keyFacts: Array.isArray(r.keyFacts) ? r.keyFacts.filter((f): f is string => typeof f === 'string') : [],
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  }
}

// Exact-string dedupe + cap to the last MAX_KEY_FACTS, preserving "most recent
// last": a fact that's re-added moves to the end rather than duplicating.
// Pure — no I/O — so it's independently testable from the read-modify-write
// calls below.
export function mergeKeyFacts(existing: string[], incoming: string[]): string[] {
  const merged = [...existing]
  for (const raw of incoming) {
    const fact = raw.trim()
    if (!fact) continue
    const i = merged.indexOf(raw.trim())
    if (i !== -1) merged.splice(i, 1)
    merged.push(fact)
  }
  return merged.slice(-MAX_KEY_FACTS)
}

// Formats accumulated context as plain prompt lines — the one place this
// shape turns into text, shared by every surface that folds a project's
// context into a prompt: lib/ai/serialize.ts's "CONTEXT (from project)"
// section (Collab) and the house-scoped reasoning route's extraContext
// (plans/active/business-mode/03-accumulating-context.md's "extension of an
// existing mechanism, not a new injection point"). Empty array when there's
// nothing worth showing. maxFacts mirrors the interview's own facts cap
// (lib/ai/serialize.ts's MAX_FACTS) so a long-lived project's context can't
// dominate the prompt.
export function formatProjectContextLines(
  context: ProjectContext | null | undefined,
  // Same default as the interview's own facts cap (lib/ai/serialize.ts's
  // MAX_FACTS) — callers pass their own only when they need to differ.
  maxFacts = 8
): string[] {
  if (!context) return []
  const lines: string[] = []
  if (context.stage) lines.push(`Stage: ${context.stage}`)
  if (context.customer) lines.push(`Customer: ${context.customer}`)
  if (context.businessModel) lines.push(`Business model: ${context.businessModel}`)
  for (const f of context.keyFacts.slice(-maxFacts)) lines.push(`- ${f}`)
  return lines
}

// Shape of a public.projects row.
export interface ProjectRow {
  id: string
  name: string
  description: string
  status: ProjectStatus
  context: ProjectContext
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  status: ProjectStatus
  editedLabel: string
}

export const PROJECT_COLUMNS = 'id, name, description, status, context, created_at, updated_at'

// Every raw select above returns context as whatever the jsonb column holds;
// normalize it once here so every caller of listProjects/getProject/
// createProject sees a well-formed ProjectContext, never a bare `{}`.
function rowFromSelect(data: unknown): ProjectRow {
  const row = data as Omit<ProjectRow, 'context'> & { context: unknown }
  return { ...row, context: normalizeProjectContext(row.context) }
}

export function rowToSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    editedLabel: editedLabel(row.updated_at),
  }
}

// Every owned project, most recently updated first. RLS (owner_id = auth.uid())
// already scopes this to the caller; ownerId is still passed and filtered on
// explicitly (same defense-in-depth style as app/dashboard/page.tsx's
// `.eq('owner_id', user.id)` on the houses query).
export async function listProjects(
  supabase: SupabaseClient,
  ownerId: string
): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowFromSelect)
}

export async function getProject(
  supabase: SupabaseClient,
  id: string
): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? rowFromSelect(data) : null
}

export async function createProject(
  supabase: SupabaseClient,
  ownerId: string,
  input: { name: string; description?: string }
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ owner_id: ownerId, name: input.name, description: input.description ?? '' })
    .select(PROJECT_COLUMNS)
    .single()
  if (error || !data) throw error ?? new Error('Failed to create project')
  return rowFromSelect(data)
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status'>>
): Promise<void> {
  const { error } = await supabase.from('projects').update(patch).eq('id', id)
  if (error) throw error
}

export function setProjectStatus(
  supabase: SupabaseClient,
  id: string,
  status: ProjectStatus
): Promise<void> {
  return updateProject(supabase, id, { status })
}

// ── Accumulating context (Phase 3) ──────────────────────────────────────────
// Read-modify-write, same as every other project write here — no optimistic
// concurrency (unlike the house builder's saveHouse revision token): a single
// owner editing their own project's context doesn't need it.

// Direct edit of the structured fields — the /projects/[id] form.
export async function updateProjectContext(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Pick<ProjectContext, 'stage' | 'customer' | 'businessModel'>>
): Promise<ProjectContext> {
  const current = await getProject(supabase, id)
  const next: ProjectContext = {
    ...(current?.context ?? emptyProjectContext()),
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  const { error } = await supabase.from('projects').update({ context: next }).eq('id', id)
  if (error) throw error
  return next
}

// Passive accumulation's one-click "save to project context" (a house's
// Review layer, or the reasoning pipeline reaching a conclusion) — explicit
// user action, never automatic scraping. Dedupes and caps via mergeKeyFacts.
export async function appendProjectContextFacts(
  supabase: SupabaseClient,
  id: string,
  facts: string[]
): Promise<ProjectContext> {
  const current = await getProject(supabase, id)
  const base = current?.context ?? emptyProjectContext()
  const next: ProjectContext = {
    ...base,
    keyFacts: mergeKeyFacts(base.keyFacts, facts),
    updatedAt: new Date().toISOString(),
  }
  const { error } = await supabase.from('projects').update({ context: next }).eq('id', id)
  if (error) throw error
  return next
}

// Manual curation on /projects/[id] — lets the user remove a stale or wrong
// fact rather than it sitting there forever (the other half of "do not let it
// grow unbounded": a cap alone can't fix a wrong fact, only a human can).
export async function removeProjectContextFact(
  supabase: SupabaseClient,
  id: string,
  fact: string
): Promise<ProjectContext> {
  const current = await getProject(supabase, id)
  const base = current?.context ?? emptyProjectContext()
  const next: ProjectContext = {
    ...base,
    keyFacts: base.keyFacts.filter((f) => f !== fact),
    updatedAt: new Date().toISOString(),
  }
  const { error } = await supabase.from('projects').update({ context: next }).eq('id', id)
  if (error) throw error
  return next
}
