// RAG over accumulated project data (Phase 5, decision 021, plans/active/
// business-mode/05-rag-retrieval.md). Server-only (embeds via lib/ai/
// embeddings.ts, which guards itself the same way).
//
// Scope decision for this pass, flagged not silent: only source_type=
// 'document' is actually ingested here.
//   - 'project_context' is deliberately NOT embedded — Phase 3
//     (lib/ai/serialize.ts's "CONTEXT (from project)") already injects it
//     directly and in full every time; it's small, so retrieval would be
//     redundant at this scale. The column stays in the CHECK constraint
//     (migration 0051) for when that stops being true.
//   - 'house' embeddings (past houses under a project) are schema-supported
//     but have no ingestion path yet — a real future step (needs its own
//     trigger point, e.g. alongside SaveFactsToProjectButton), not built
//     speculatively here.
//
// Retrieved chunks are ALWAYS labeled by source and never merged into
// Research Mode's Brave-cited evidence shape (decision 021 §5) —
// formatRagChunksForPrompt below is the one place that text reaches a
// prompt, and it says so explicitly in the label the model sees.

import type { SupabaseClient } from '@supabase/supabase-js'
import { embedTexts } from './embeddings'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/rag.ts is server-only and must not run in the browser')
}

// Character-based, not token-based — good enough for v1 (no tokenizer
// dependency added just for chunk sizing). ~2000 chars is comfortably under
// BAAI/bge-m3's 8k-token window even for dense text, with ~10% overlap so a
// fact split across a chunk boundary still appears whole in one of the two.
export const CHUNK_CHARS = 2000
export const CHUNK_OVERLAP_CHARS = 200

export function chunkText(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= CHUNK_CHARS) return [trimmed]
  const chunks: string[] = []
  let start = 0
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_CHARS, trimmed.length)
    const chunk = trimmed.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= trimmed.length) break
    start = end - CHUNK_OVERLAP_CHARS
  }
  return chunks
}

// Re-embeds ONE document's extracted text, replacing any prior chunks for it
// (delete-then-insert, keyed on source_id) — safe to call again after a
// re-parse without accumulating stale duplicates. Caller's own responsibility
// to gate this on workspace_mode='business' (app/api/projects/[id]/documents/
// [documentId]/parse/route.ts) — this function does not check it, so it must
// never be called from anywhere that hasn't already checked.
export async function ingestDocumentEmbeddings(
  supabase: SupabaseClient,
  doc: { id: string; project_id: string; owner_id: string; extracted_text: string | null }
): Promise<void> {
  if (!doc.extracted_text) return
  const chunks = chunkText(doc.extracted_text)
  if (chunks.length === 0) return

  const vectors = await embedTexts(chunks)

  await supabase.from('project_embeddings').delete().eq('source_type', 'document').eq('source_id', doc.id)

  const rows = chunks.map((chunk_text, i) => ({
    project_id: doc.project_id,
    owner_id: doc.owner_id,
    source_type: 'document' as const,
    source_id: doc.id,
    chunk_text,
    chunk_index: i,
    embedding: vectors[i],
  }))
  const { error } = await supabase.from('project_embeddings').insert(rows)
  if (error) throw error
}

export type RagSourceType = 'project_context' | 'house' | 'document'

export interface RetrievedChunk {
  sourceType: RagSourceType
  sourceId: string | null
  text: string
  similarity: number
}

// Scoped to ONE project (and therefore, via the RPC's own owner_id check
// plus table RLS, one owner) by construction — never a cross-project or
// cross-user search (the plan doc's explicit invariant). Caller's own
// responsibility to gate this on workspace_mode='business' — same contract
// as ingestDocumentEmbeddings above.
export async function retrieveProjectChunks(
  supabase: SupabaseClient,
  projectId: string,
  queryText: string,
  limit = 5
): Promise<RetrievedChunk[]> {
  const query = queryText.trim().slice(0, 2000)
  if (!query) return []
  const [embedding] = await embedTexts([query])
  if (!embedding) return []
  const { data, error } = await supabase.rpc('match_project_embeddings', {
    p_project_id: projectId,
    p_query_embedding: embedding,
    p_match_count: limit,
  })
  if (error) throw error
  return ((data ?? []) as { source_type: RagSourceType; source_id: string | null; chunk_text: string; similarity: number }[]).map(
    (r) => ({ sourceType: r.source_type, sourceId: r.source_id, text: r.chunk_text, similarity: r.similarity })
  )
}

const SOURCE_LABEL: Record<RagSourceType, string> = {
  document: 'from a project document',
  house: 'from a past house in this project',
  project_context: 'from your project notes',
}

// The ONE place retrieved chunks turn into prompt text. Deliberately its own
// section — never folded into serializeHouseForPrompt's "CONTEXT (from
// project)" (Phase 3) or anything evidence-shaped — so the label a model
// sees, and the label the UI shows the person (InterviewCard's ragSources),
// say the same thing: retrieved from your own material, not verified
// evidence. Empty string (not a header with nothing under it) when there's
// nothing to show.
export function formatRagChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return ''
  const lines = chunks.map((c) => `[${SOURCE_LABEL[c.sourceType]}] ${c.text}`)
  return `## RETRIEVED FROM YOUR PROJECT (your own material — not independently verified evidence; never treat this as Research Mode's Brave-sourced evidence)\n${lines.join('\n\n')}`
}
