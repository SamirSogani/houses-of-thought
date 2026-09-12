// Types + helpers for the "Your Houses" dashboard. House rows come from Supabase
// (see app/dashboard/page.tsx); this module maps a DB row to the HouseSummary the
// grid renders. Progress is measured against the 7 layers of the Build a House flow
// (see lib/build), so the dashboard and the workspace stay coherent.

import { draftGateLocked, type DraftState } from '@/lib/ai/draft'

export type HouseStatus = 'empty' | 'in-progress' | 'complete'

export interface HouseSummary {
  id: string
  title: string | null // null = untitled
  question: string | null // null = no question set yet
  layersComplete: number // 0..7
  status: HouseStatus
  editedLabel: string
  assignmentId: string | null // set = this house answers an assignment
  turnedIn: boolean // student marked the submission as turned in
  turnedInAt: string | null // when (0024) — drives the teacher's "late" marker
  // Draft gate (016 §2): AI-drafted layers await their claim — turn-in is
  // blocked from the dashboard too, not just publish/export in the workspace.
  draftLocked: boolean
  // Mechanism 2 ("Share", 0033): the current /shared/<token> link, or null if
  // this house has never been shared / the link was revoked. Owner-only —
  // fetched only on the "Your Houses" query, never the "Shared with you" one.
  shareToken: string | null
  // Mechanism 1 ("Invite"): set only on a "Shared with you" row — the caller's
  // own house_collaborators role for this house. Undefined on an owned house.
  sharedRole?: 'viewer' | 'editor'
  // Business mode (decision 021): the project this house is grouped under, or
  // null. Drives the dashboard's per-project grouping (lib/projects/data.ts).
  projectId: string | null
}

export const TOTAL_LAYERS = 7

export function housePercent(h: HouseSummary): number {
  return Math.round((h.layersComplete / TOTAL_LAYERS) * 100)
}

export const statusMeta: Record<HouseStatus, { label: string; color: string; bg: string }> = {
  empty: { label: 'Empty', color: 'var(--ink-subtle)', bg: 'var(--parchment)' },
  'in-progress': { label: 'In progress', color: 'var(--amber-hover)', bg: 'var(--amber-tint)' },
  complete: { label: 'Complete', color: 'var(--green-strong)', bg: 'rgba(63,143,91,0.12)' },
}

// Shape of a public.houses row as selected for the dashboard grid (see 0003).
// assignment_id/turned_in are optional so rows from selects that omit them (e.g.
// the roster view) still map cleanly.
export interface HouseRow {
  id: string
  title: string | null
  question: string | null
  status: HouseStatus
  layers_complete: number
  updated_at: string
  assignment_id?: string | null
  turned_in?: boolean
  turned_in_at?: string | null // when it was turned in (0024)
  draft?: unknown // houses.draft jsonb (0022); omitted by selects that don't need it
  share_token?: string | null // houses.share_token (0033); omitted by selects that don't need it
  project_id?: string | null // houses.project_id (0048); omitted by selects that don't need it
}

export function rowToSummary(row: HouseRow): HouseSummary {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    layersComplete: row.layers_complete,
    status: row.status,
    editedLabel: editedLabel(row.updated_at),
    assignmentId: row.assignment_id ?? null,
    turnedIn: row.turned_in ?? false,
    turnedInAt: row.turned_in_at ?? null,
    draftLocked: draftGateLocked((row.draft as DraftState | null | undefined) ?? null),
    shareToken: row.share_token ?? null,
    projectId: row.project_id ?? null,
  }
}

// Relative "Edited …" label matching the reference wording (e.g. "Edited 2d ago",
// falling back to "Edited Jun 6" past a week).
export function editedLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = 60_000
  const hr = 60 * min
  const day = 24 * hr

  if (diffMs < min) return 'Edited just now'
  if (diffMs < hr) return `Edited ${Math.floor(diffMs / min)}m ago`
  if (diffMs < day) return `Edited ${Math.floor(diffMs / hr)}h ago`
  if (diffMs < 7 * day) return `Edited ${Math.floor(diffMs / day)}d ago`

  const d = new Date(iso)
  return `Edited ${d.toLocaleString('en-US', { month: 'short', day: 'numeric' })}`
}
