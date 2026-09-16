'use client'

// Deep Dive page shell (Phase 1 of decision 022,
// plans/active/project-deep-dives/01-schema-and-entry-points.md): one
// parameterized route for all four domains (not four bespoke pages — plan
// README's invariant 1). A prompt box inserts a `pending` project_deep_dives
// row and the history list below shows every past run for this project +
// domain. No generation yet — that's Phase 2, so `result` is always null and
// every entry just sits at 'pending' for now.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import Footer from '@/components/sections/Footer'
import { useAuthedPage, CenterNotice } from '@/components/useAuthedPage'
import { getProject, type ProjectRow } from '@/lib/projects/data'
import {
  createDeepDive,
  listDeepDives,
  isDeepDiveDomain,
  DEEP_DIVE_DOMAIN_META,
  type DeepDiveDomain,
  type DeepDiveRow,
  type DeepDiveStatus,
} from '@/lib/projects/deepDives'
import { SectionCard, FieldLabel, TextArea } from '@/components/profile/primitives'

const statusLabel: Record<DeepDiveStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  error: 'Error',
}

function StatusChip({ status }: { status: DeepDiveStatus }) {
  const color = status === 'error' ? 'var(--warning-text)' : status === 'done' ? 'var(--green-text)' : 'var(--ink-subtle)'
  return (
    <span
      className="mono"
      style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 6px' }}
    >
      {statusLabel[status]}
    </span>
  )
}

// Same "doesn't exist or isn't yours" pattern app/projects/[id]/page.tsx uses
// for a missing project — reused here for both a bad `domain` param and a
// missing/not-owned project (RLS makes the latter look identical to
// nonexistent, same convention as app/build/[id]/page.tsx).
function NotFoundNotice({ onSignOut }: { onSignOut: () => void }) {
  const router = useRouter()
  return (
    <div className="acct-vh-min" style={{ display: 'flex', flexDirection: 'column', background: 'var(--parchment)' }}>
      <DashboardHeader onSignOut={onSignOut} active="projects" showProjects />
      <main id="main" style={{ flex: '1 1 auto' }}>
        <div className="container" style={{ paddingBlock: 'clamp(32px, 5vw, 56px)' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--ink-mid)' }}>
            That project doesn&apos;t exist, or isn&apos;t yours.
          </p>
          <button
            type="button"
            onClick={() => router.push('/projects')}
            className="mono"
            style={{ marginTop: 16, fontSize: 12, color: 'var(--ink)', textDecoration: 'underline' }}
          >
            Back to Projects
          </button>
        </div>
      </main>
      <Footer />
    </div>
  )
}

export default function DeepDivePage({ params }: { params: Promise<{ id: string; domain: string }> }) {
  const { id, domain: domainParam } = use(params)
  const { accountType, caps, signOut } = useAuthedPage()

  const domain: DeepDiveDomain | null = isDeepDiveDomain(domainParam) ? domainParam : null

  // null while loading; undefined once we know it's gone/not-yours (RLS makes
  // both look identical — same convention as app/projects/[id]/page.tsx).
  const [project, setProject] = useState<ProjectRow | null | undefined>(null)
  const [entries, setEntries] = useState<DeepDiveRow[] | null>(null)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadEntries = useCallback(async (projectId: string, d: DeepDiveDomain) => {
    const supabase = createClient()
    try {
      const rows = await listDeepDives(supabase, projectId, d)
      setEntries(rows)
    } catch (err) {
      console.error('Failed to load deep dive history:', err)
      setEntries([])
    }
  }, [])

  useEffect(() => {
    if (!domain) return
    const supabase = createClient()
    let active = true
    ;(async () => {
      const row = await getProject(supabase, id)
      if (!active) return
      setProject(row ?? undefined)
      if (row) loadEntries(row.id, domain)
    })()
    return () => {
      active = false
    }
  }, [id, domain, loadEntries])

  async function handleSubmit() {
    if (!project || !domain) return
    const text = prompt.trim()
    if (!text || submitting) return
    const supabase = createClient()
    const {
      data: { user: authedUser },
    } = await supabase.auth.getUser()
    if (!authedUser) return

    setSubmitting(true)
    setError(null)
    try {
      await createDeepDive(supabase, {
        projectId: project.id,
        ownerId: authedUser.id,
        domain,
        prompt: text,
      })
      setPrompt('')
      await loadEntries(project.id, domain)
    } catch (err) {
      console.error('Failed to create deep dive:', err)
      setError('Could not start that Deep Dive. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!domain) {
    return <NotFoundNotice onSignOut={() => void signOut()} />
  }

  if (project === null) {
    return <CenterNotice>Loading…</CenterNotice>
  }

  if (project === undefined) {
    return <NotFoundNotice onSignOut={() => void signOut()} />
  }

  const meta = DEEP_DIVE_DOMAIN_META[domain]
  const isTeacher = caps.canCreateClasses
  const isStudent = accountType === 'student'

  return (
    <div className="acct-vh-min" style={{ display: 'flex', flexDirection: 'column', background: 'var(--parchment)' }}>
      <DashboardHeader
        onSignOut={() => void signOut()}
        active="projects"
        showProjects
        showClassroom={isTeacher || isStudent}
        classroomHref={isTeacher ? '/classroom' : '/classes'}
      />

      <main id="main" style={{ flex: '1 1 auto' }}>
        <div className="container" style={{ paddingBlock: 'clamp(28px, 4vw, 48px)', maxWidth: 900 }}>
          {/* Breadcrumb */}
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Link href="/dashboard" style={{ color: 'var(--ink-subtle)' }}>Dashboard</Link>
            <span aria-hidden="true">/</span>
            <Link href="/projects" style={{ color: 'var(--ink-subtle)' }}>Projects</Link>
            <span aria-hidden="true">/</span>
            <Link href={`/projects/${id}`} style={{ color: 'var(--ink-subtle)' }}>{project.name}</Link>
            <span aria-hidden="true">/</span>
            <span style={{ color: 'var(--ink)' }}>{meta.label}</span>
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 38px)', letterSpacing: '-0.015em', color: 'var(--ink)', marginTop: 12 }}>
            {meta.label}
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 6, maxWidth: '60ch' }}>
            {meta.description}
          </p>

          {error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)', marginTop: 12 }}>{error}</p>
          )}

          <div style={{ marginTop: 'clamp(20px, 3vw, 32px)' }}>
            <SectionCard>
              <FieldLabel label="Prompt" helper={`What do you want to dig into for ${meta.label.toLowerCase()}?`} />
              <TextArea value={prompt} onChange={setPrompt} placeholder="Ask something specific…" ariaLabel="Deep dive prompt" rows={4} />
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !prompt.trim()}
                  style={{
                    height: 40,
                    padding: '0 18px',
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 14,
                    border: '1px solid var(--ink)',
                    color: 'var(--white)',
                    background: submitting || !prompt.trim() ? 'var(--ink-subtle)' : 'var(--ink)',
                    cursor: submitting || !prompt.trim() ? 'default' : 'pointer',
                  }}
                >
                  {submitting ? 'Starting…' : 'Start Deep Dive'}
                </button>
              </div>
            </SectionCard>
          </div>

          {/* History — Phase 1 only persists the prompt; every entry sits at
              'pending' until Phase 2's generation engine exists to advance it
              (no spinner/polling here — nothing to poll for yet). */}
          <div style={{ marginTop: 'clamp(28px, 4vw, 40px)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(18px, 2.2vw, 22px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
              History
            </h2>
            {entries === null ? (
              <p className="mono" style={{ fontSize: 12, color: 'var(--ink-subtle)', marginTop: 16 }}>Loading history…</p>
            ) : entries.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 12 }}>
                No {meta.label.toLowerCase()} runs yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                {entries.map((entry) => (
                  <SectionCard key={entry.id}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>{entry.prompt}</p>
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <StatusChip status={entry.status} />
                      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-subtle)' }}>
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                  </SectionCard>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
