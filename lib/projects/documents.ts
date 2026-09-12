// Types + CRUD for per-project document upload (Phase 4, decision 021,
// plans/active/business-mode/04-document-upload.md). Split out of
// lib/projects/data.ts (repo's ~600-LOC guideline) rather than folded in —
// documents are a distinct entity with their own Storage side-effects.
//
// Scope decision (flagged, not silent — the plan doc left this as an open
// question to resolve during implementation): v1 supports plain-text
// documents only (text/plain, text/markdown) — no PDF/DOCX parsing
// dependency added. "Text-first for v1" per decisions/021 §6's deferred
// item; extractable-text PDFs are a real candidate for a later phase once a
// parsing library is evaluated against this app's serverless footprint, not
// added speculatively here.

import type { SupabaseClient } from '@supabase/supabase-js'

export const STORAGE_BUCKET = 'project-documents'

// Matches the bucket's own file_size_limit (migration 0050) — enforced here
// too so the client can reject an oversized file before ever starting an
// upload, not just after Storage's own 400.
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB

// v1's only supported types (see module header). Extension is checked
// alongside MIME type because browsers are inconsistent about what MIME type
// they report for .md (often empty or text/plain).
export const ACCEPTED_MIME_TYPES = ['text/plain', 'text/markdown'] as const
export const ACCEPTED_EXTENSIONS = ['.txt', '.md'] as const

export function isAcceptedDocument(filename: string, mimeType: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return (
    (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ||
    (ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType)
  )
}

// Bounds what eventually reaches a prompt (Phase 5) — a 10MB text file is an
// edge case, not the norm, but storing it unbounded would make one document
// dominate every future retrieval call. Same order of magnitude as this
// app's other hard content caps (lib/ai/serialize.ts's HARD_CAP family).
export const MAX_EXTRACTED_CHARS = 200_000

export type DocumentStatus = 'pending' | 'parsed' | 'failed'

// Shape of a public.project_documents row.
export interface ProjectDocumentRow {
  id: string
  project_id: string
  owner_id: string
  filename: string
  mime_type: string
  storage_path: string
  status: DocumentStatus
  extracted_text: string | null
  error: string | null
  created_at: string
}

export const DOCUMENT_COLUMNS =
  'id, project_id, owner_id, filename, mime_type, storage_path, status, extracted_text, error, created_at'

// Every document on a project, newest first. RLS (owner_id = auth.uid())
// already scopes this to the caller — same defense-in-depth style as
// lib/projects/data.ts's listProjects.
export async function listProjectDocuments(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectDocumentRow[]> {
  const { data, error } = await supabase
    .from('project_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProjectDocumentRow[]
}

// The storage path convention every policy and reader relies on:
// "<owner_id>/<project_id>/<uuid>-<filename>" — the first two folder
// segments are exactly what storage.objects' RLS policy checks (migration
// 0050's (storage.foldername(name))[1]), so upload and read agree by
// construction, not by convention alone.
export function buildStoragePath(ownerId: string, projectId: string, filename: string): string {
  const safeName = filename.replace(/[^\w.\- ]/g, '_')
  return `${ownerId}/${projectId}/${crypto.randomUUID()}-${safeName}`
}

// Uploads the file's bytes to Storage, then inserts the 'pending' row.
// Two round trips, not one transaction — same tradeoff this app already
// accepts elsewhere (Storage and Postgres are separate systems); a failed
// second step leaves an orphaned Storage object, cleaned up by
// deleteProjectDocument's own best-effort Storage removal if the user
// retries or removes it, not by any automatic reconciliation.
export async function uploadProjectDocument(
  supabase: SupabaseClient,
  ownerId: string,
  projectId: string,
  file: File
): Promise<ProjectDocumentRow> {
  const storagePath = buildStoragePath(ownerId, projectId, file.name)
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
    contentType: file.type || 'text/plain',
  })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('project_documents')
    .insert({
      project_id: projectId,
      owner_id: ownerId,
      filename: file.name,
      mime_type: file.type || 'text/plain',
      storage_path: storagePath,
      status: 'pending',
    })
    .select(DOCUMENT_COLUMNS)
    .single()
  if (error || !data) {
    // Best-effort cleanup — don't leave an unreferenced file if the row
    // insert failed (e.g. RLS/grant hiccup).
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {})
    throw error ?? new Error('Failed to create document row')
  }
  return data as ProjectDocumentRow
}

export async function setProjectDocumentParsed(
  supabase: SupabaseClient,
  id: string,
  extractedText: string
): Promise<void> {
  const { error } = await supabase
    .from('project_documents')
    .update({ status: 'parsed', extracted_text: extractedText.slice(0, MAX_EXTRACTED_CHARS), error: null })
    .eq('id', id)
  if (error) throw error
}

export async function setProjectDocumentFailed(supabase: SupabaseClient, id: string, message: string): Promise<void> {
  const { error } = await supabase.from('project_documents').update({ status: 'failed', error: message }).eq('id', id)
  if (error) throw error
}

// Removes both the DB row and its Storage object. The Storage removal is
// best-effort (logged by the caller, not thrown) — a failed remove leaves an
// orphaned file under a path the deleted row no longer names, not a
// dangling reference anyone can reach.
export async function deleteProjectDocument(supabase: SupabaseClient, doc: Pick<ProjectDocumentRow, 'id' | 'storage_path'>): Promise<void> {
  const { error } = await supabase.from('project_documents').delete().eq('id', doc.id)
  if (error) throw error
  await supabase.storage.from(STORAGE_BUCKET).remove([doc.storage_path]).catch(() => {})
}
