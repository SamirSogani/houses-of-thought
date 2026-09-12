// POST /api/projects/[id]/documents/[documentId]/parse — Phase 4's parsing
// step (decision 021, plans/active/business-mode/04-document-upload.md):
// downloads the already-uploaded file from Storage, extracts text, and flips
// status to 'parsed' or 'failed'. Synchronous — "not needed at v1 scale" per
// the plan doc; a background job is a real future step once upload volume
// justifies it, not built speculatively here.
//
// No rate limit on this route yet — a real, known gap (same class as the
// house-scoped reasoning route's own flagged gap, app/api/houses/[id]/
// reasoning/route.ts), not silently accepted. Worth a coarse per-account cap
// before this is exposed beyond a handful of real users.
//
// Caller's OWN session throughout (never service role) — RLS on both
// project_documents and storage.objects (migration 0050) already scopes
// everything to the caller; the owner_id re-check below is defense-in-depth,
// matching this app's existing "explicit re-check" style elsewhere.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/log'
import { getCallerWorkspaceMode } from '@/lib/auth/account'
import { ingestDocumentEmbeddings } from '@/lib/ai/rag'
import {
  DOCUMENT_COLUMNS,
  STORAGE_BUCKET,
  MAX_EXTRACTED_CHARS,
  isAcceptedDocument,
  setProjectDocumentParsed,
  setProjectDocumentFailed,
  type ProjectDocumentRow,
} from '@/lib/projects/documents'

export const maxDuration = 30

const ParamsSchema = z.object({ id: z.string().uuid(), documentId: z.string().uuid() })

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
): Promise<Response> {
  const parsedParams = ParamsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'invalid-request' }, { status: 400 })
  }
  const { id: projectId, documentId } = parsedParams.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data: docRow, error: docError } = await supabase
    .from('project_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', documentId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (docError) {
    log.error('projects/documents/parse', 'document lookup failed', { error: docError.message })
    return NextResponse.json({ error: 'server-error' }, { status: 500 })
  }
  if (!docRow) return NextResponse.json({ error: 'not-found' }, { status: 404 })
  const doc = docRow as ProjectDocumentRow
  // RLS (owner_id = auth.uid()) already means a stranger's select above
  // returns nothing — this is belt-and-suspenders, not the actual gate.
  if (doc.owner_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Scope decision, flagged not silent (see lib/projects/documents.ts's
  // module header): v1 extracts plain text only. A type that slipped past
  // the client's own check (or a direct API call) fails cleanly here rather
  // than attempting something this route can't actually do.
  if (!isAcceptedDocument(doc.filename, doc.mime_type)) {
    const message = 'Unsupported file type — only .txt and .md are supported today.'
    await setProjectDocumentFailed(supabase, documentId, message)
    return NextResponse.json({ error: 'unsupported-type', message }, { status: 400 })
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(doc.storage_path)
  if (downloadError || !fileBlob) {
    const message = 'Could not read the uploaded file.'
    log.error('projects/documents/parse', 'storage download failed', { error: downloadError?.message })
    await setProjectDocumentFailed(supabase, documentId, message)
    return NextResponse.json({ error: 'download-failed', message }, { status: 502 })
  }

  try {
    const text = await fileBlob.text()
    await setProjectDocumentParsed(supabase, documentId, text)

    // RAG ingestion (Phase 5, decision 021): read once from the caller's own
    // profile — never client-supplied. A general-mode caller incurs ZERO
    // embedding-generation cost, full stop, regardless of whether they have
    // projects (the plan doc's own explicit manual-verification bullet).
    // Best-effort: an ingestion failure still leaves the document 'parsed'
    // (the text extraction itself succeeded) — it just isn't retrievable via
    // RAG yet, surfaced as a log line, not a failed upload for the person.
    const workspaceMode = await getCallerWorkspaceMode()
    if (workspaceMode === 'business') {
      try {
        await ingestDocumentEmbeddings(supabase, {
          id: documentId,
          project_id: projectId,
          owner_id: user.id,
          extracted_text: text,
        })
      } catch (err) {
        log.error('projects/documents/parse', 'embedding ingestion failed', { error: (err as Error)?.message })
      }
    }

    // Reflect exactly what was persisted (setProjectDocumentParsed clips to
    // MAX_EXTRACTED_CHARS) — not the full, possibly-larger raw text.
    return NextResponse.json({
      document: { ...doc, status: 'parsed', extracted_text: text.slice(0, MAX_EXTRACTED_CHARS), error: null },
    })
  } catch (err) {
    const message = 'Could not extract text from this file.'
    log.error('projects/documents/parse', 'text extraction failed', { error: (err as Error)?.message })
    await setProjectDocumentFailed(supabase, documentId, message)
    return NextResponse.json({ error: 'parse-failed', message }, { status: 500 })
  }
}
