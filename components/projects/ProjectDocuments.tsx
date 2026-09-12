'use client'

// Per-project document upload (Phase 4, decision 021, plans/active/
// business-mode/04-document-upload.md). v1 supports plain text only
// (lib/projects/documents.ts's module header explains why) — upload,
// parse-on-upload, list with status, delete.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  listProjectDocuments,
  uploadProjectDocument,
  deleteProjectDocument,
  isAcceptedDocument,
  MAX_FILE_BYTES,
  ACCEPTED_EXTENSIONS,
  type ProjectDocumentRow,
} from '@/lib/projects/documents'
import { SectionCard, FieldLabel } from '@/components/profile/primitives'

const statusMeta: Record<ProjectDocumentRow['status'], { label: string; color: string; bg: string }> = {
  pending: { label: 'Processing…', color: 'var(--amber-hover)', bg: 'var(--amber-tint)' },
  parsed: { label: 'Parsed', color: 'var(--green-text)', bg: 'rgba(63,143,91,0.12)' },
  failed: { label: 'Failed', color: 'var(--warning-text)', bg: 'rgba(180,60,60,0.08)' },
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectDocuments({ projectId, ownerId }: { projectId: string; ownerId: string }) {
  const [documents, setDocuments] = useState<ProjectDocumentRow[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    const supabase = createClient()
    try {
      setDocuments(await listProjectDocuments(supabase, projectId))
    } catch {
      setDocuments([])
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked after an error
    if (!file) return

    setError(null)

    // Client-side checks first — a clear rejection before any upload starts
    // (manual verification: "oversized/wrong-type upload is rejected with a
    // clear error, not a silent failure"). The route + bucket's own limits
    // (lib/projects/documents.ts's MAX_FILE_BYTES / migration 0050's
    // file_size_limit) are the real enforcement; this is just fast feedback.
    if (file.size > MAX_FILE_BYTES) {
      setError(`"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}.`)
      return
    }
    if (!isAcceptedDocument(file.name, file.type)) {
      setError(`"${file.name}" isn't a supported file type yet — only ${ACCEPTED_EXTENSIONS.join(' and ')} for now.`)
      return
    }

    setUploading(true)
    const supabase = createClient()
    try {
      const doc = await uploadProjectDocument(supabase, ownerId, projectId, file)
      setDocuments((docs) => [doc, ...(docs ?? [])])
      // Parse immediately (synchronous at this scale) — the row already
      // shows as "Processing…" from the optimistic insert above.
      const res = await fetch(`/api/projects/${projectId}/documents/${doc.id}/parse`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { document?: ProjectDocumentRow; message?: string }
      if (res.ok && body.document) {
        setDocuments((docs) => (docs ?? []).map((d) => (d.id === doc.id ? body.document! : d)))
      } else {
        // The route already wrote status:'failed' — just reflect it locally
        // instead of a full refetch.
        setDocuments((docs) =>
          (docs ?? []).map((d) => (d.id === doc.id ? { ...d, status: 'failed', error: body.message ?? 'Could not parse this file.' } : d))
        )
      }
    } catch {
      setError(`Could not upload "${file.name}". Please try again.`)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(doc: ProjectDocumentRow) {
    const supabase = createClient()
    const prior = documents
    setDocuments((docs) => (docs ?? []).filter((d) => d.id !== doc.id))
    try {
      await deleteProjectDocument(supabase, doc)
    } catch {
      setDocuments(prior)
      setError('Could not delete that document. Please try again.')
    }
  }

  return (
    <SectionCard>
      <FieldLabel
        label="Documents"
        helper={`Upload notes, pitch decks (as text), or financials for this project. Supported today: ${ACCEPTED_EXTENSIONS.join(', ')} — up to ${formatBytes(MAX_FILE_BYTES)} each.`}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        style={{
          height: 38,
          padding: '0 16px',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 13,
          border: '1px solid var(--ink)',
          color: 'var(--ink)',
          background: 'var(--white)',
          opacity: uploading ? 0.6 : 1,
          cursor: uploading ? 'default' : 'pointer',
        }}
      >
        {uploading ? 'Uploading…' : '+ Upload document'}
      </button>

      {error && (
        <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)', marginTop: 10 }}>{error}</p>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {documents === null ? (
          <p style={{ fontSize: 13, color: 'var(--ink-subtle)' }}>Loading…</p>
        ) : documents.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-subtle)' }}>No documents yet.</p>
        ) : (
          documents.map((d) => {
            const meta = statusMeta[d.status]
            return (
              <div
                key={d.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', border: '1px solid var(--rule)', borderRadius: 8 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.filename}
                  </div>
                  {d.status === 'failed' && d.error && (
                    <div style={{ fontSize: 11.5, color: 'var(--warning-text)', marginTop: 2 }}>{d.error}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                  <span
                    className="mono"
                    style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: meta.color, background: meta.bg, borderRadius: 4, padding: '3px 7px' }}
                  >
                    {meta.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(d)}
                    aria-label={`Delete ${d.filename}`}
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--ink-subtle)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 8px' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </SectionCard>
  )
}
