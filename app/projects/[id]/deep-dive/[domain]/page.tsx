'use client'

// Deep Dive page shell (Phase 1 of decision 022,
// plans/active/project-deep-dives/01-schema-and-entry-points.md): one
// parameterized route for all four domains (not four bespoke pages — plan
// README's invariant 1). A prompt box inserts a `pending` project_deep_dives
// row and the history list below shows every past run for this project +
// domain.
//
// Phase 2 (plans/active/project-deep-dives/02-generation-engine.md) adds the
// client side of the generate->review->regenerate->master-review loop:
// app/api/ai/deep-dive/route.ts does exactly one unit of work per call and
// returns, so THIS page is what turns repeated calls into what reads as one
// continuous, unattended run — runDeepDive below fires the next POST itself
// as soon as the previous one resolves, with no button the founder has to
// click again, mirroring how the house pipeline's own rail auto-advances
// (components/build/useReasoningPipelineRunner.ts) at a much smaller scale
// (one subject, not a client-resent RunState). Also resumes any row still
// sitting at 'pending' on mount, so navigating away mid-run and coming back
// doesn't strand it forever with nothing left polling it.

import { use, useCallback, useEffect, useRef, useState } from 'react'
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
  deepDiveStatusLabel,
  markDeepDiveError,
  markDeepDiveSaved,
  DEEP_DIVE_DOMAIN_META,
  type DeepDiveDomain,
  type DeepDiveRow,
  type DeepDiveStatus,
} from '@/lib/projects/deepDives'
import { SectionCard, FieldLabel, TextArea } from '@/components/profile/primitives'
// Phase 4 (plans/active/project-deep-dives/04-save-to-project.md): the
// per-domain result renderers + "Save to project" wiring, split into their
// own file once adding them here pushed this page past the ~600 LOC
// guideline — see that file's own header comment for the per-domain
// "one fact per item" choices.
import { DeepDiveResultView } from '@/components/projects/DeepDiveResults'

// Transient upstream hiccup (rate limit, timeout, malformed-output retries
// exhausted, or a plain network exception) — worth a few automatic retries
// before giving up, same spirit as useReasoningPipelineRunner.ts's own
// RATE_LIMIT_RETRY_DELAYS_MS/TRANSIENT_ERROR_CODES, kept small and local
// here rather than importing those (that hook's own constants aren't
// exported, and this loop is simple enough — one subject, not an
// n-perspective fan-out with sub-element tracking — not to need the same
// machinery).
const TRANSIENT_RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000]
const TRANSIENT_ERROR_CODES = new Set(['ai-rate-limited', 'ai-upstream-error', 'ai-timeout', 'search-rate-limited', 'search-failed'])

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

// Phase 4 (plans/active/project-deep-dives/04-save-to-project.md): sits next
// to StatusChip on a history entry that has saved_to_project set — a founder
// scanning history can see which runs already contributed to the project's
// key facts without opening each one.
function SavedChip() {
  return (
    <span
      className="mono"
      style={{
        fontSize: 9,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--green-text)',
        border: '1px solid var(--green-text)',
        borderRadius: 4,
        padding: '2px 6px',
      }}
    >
      Saved to project
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
  // The live, in-flight state of every row currently being polled, keyed by
  // id — a map, not a single value, because nothing here stops a founder
  // from starting a second Deep Dive prompt while an earlier one for the
  // same domain is still generating (handleSubmit only guards the INSERT,
  // not the run that follows it). Each entry in the history list below reads
  // from this map when present, falling back to its own persisted row
  // otherwise.
  const [liveDeepDives, setLiveDeepDives] = useState<Record<string, DeepDiveRow>>({})
  // Guards against starting two overlapping poll loops for the SAME row
  // (e.g. React 18 dev-mode's double effect invocation, or a resume-on-mount
  // racing a just-submitted run) — not a server-side lock, just cheap
  // client-side de-duplication.
  const activePollsRef = useRef<Set<string>>(new Set())

  const loadEntries = useCallback(async (projectId: string, d: DeepDiveDomain): Promise<DeepDiveRow[]> => {
    const supabase = createClient()
    try {
      const rows = await listDeepDives(supabase, projectId, d)
      setEntries(rows)
      return rows
    } catch (err) {
      console.error('Failed to load deep dive history:', err)
      setEntries([])
      return []
    }
  }, [])

  const clearLive = useCallback((deepDiveId: string) => {
    setLiveDeepDives((prev) => {
      if (!(deepDiveId in prev)) return prev
      const next = { ...prev }
      delete next[deepDiveId]
      return next
    })
  }, [])

  // Phase 4: fires once per SaveFactsToProjectButton click anywhere in a
  // 'done' entry's result list. Updates the local list immediately so
  // SavedChip appears without a refetch, and persists saved_to_project in
  // the background — same fire-and-forget-with-a-log-on-failure pattern
  // runDeepDive's own markDeepDiveError call already uses below, since a
  // failed write here just means the chip doesn't show on next load, not
  // that the fact itself failed to save (appendProjectContextFacts already
  // resolved by the time onSaved runs).
  const handleDeepDiveSaved = useCallback((deepDiveId: string) => {
    setEntries((prev) => prev?.map((e) => (e.id === deepDiveId ? { ...e, saved_to_project: true } : e)) ?? prev)
    markDeepDiveSaved(createClient(), deepDiveId).catch((err) => {
      console.error('Failed to mark deep dive as saved:', err)
    })
  }, [])

  // Drives one Deep Dive row's generate->review->regenerate->master-review
  // loop to completion by calling app/api/ai/deep-dive/route.ts repeatedly —
  // that route does exactly one unit of work per call and reports the row's
  // fresh state back, which is enough to know whether to call again
  // immediately (still 'pending'), stop (status flips to 'done'/'error'), or
  // back off and retry (a transient upstream hiccup, not a real verdict).
  const runDeepDive = useCallback(
    async (deepDiveId: string, projectId: string, d: DeepDiveDomain) => {
      if (activePollsRef.current.has(deepDiveId)) return
      activePollsRef.current.add(deepDiveId)
      let retries = 0
      let gaveUp = false
      try {
        for (;;) {
          let res: Response
          try {
            res = await fetch('/api/ai/deep-dive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deepDiveId }),
            })
          } catch {
            if (retries >= TRANSIENT_RETRY_DELAYS_MS.length) {
              gaveUp = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS_MS[retries]))
            retries += 1
            continue
          }
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            const code = body.error ?? 'ai-upstream-error'
            if (TRANSIENT_ERROR_CODES.has(code) && retries < TRANSIENT_RETRY_DELAYS_MS.length) {
              await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS_MS[retries]))
              retries += 1
              continue
            }
            gaveUp = true
            break
          }
          retries = 0
          const data = (await res.json()) as { deepDive: DeepDiveRow }
          setLiveDeepDives((prev) => ({ ...prev, [deepDiveId]: data.deepDive }))
          if (data.deepDive.status !== 'pending') {
            await loadEntries(projectId, d)
            clearLive(deepDiveId)
            return
          }
          // Still pending — fire the next unit of work immediately, no
          // artificial delay, same as the house rail's own successful-step
          // behavior.
        }
      } finally {
        activePollsRef.current.delete(deepDiveId)
      }
      if (gaveUp) {
        try {
          await markDeepDiveError(createClient(), deepDiveId)
        } catch (err) {
          console.error('Failed to mark deep dive as failed:', err)
        }
        await loadEntries(projectId, d)
        clearLive(deepDiveId)
      }
    },
    [loadEntries, clearLive]
  )

  useEffect(() => {
    if (!domain) return
    const supabase = createClient()
    let active = true
    ;(async () => {
      const row = await getProject(supabase, id)
      if (!active) return
      setProject(row ?? undefined)
      if (row) {
        const rows = await loadEntries(row.id, domain)
        if (!active) return
        // Resume anything still 'pending' from an earlier visit — nothing
        // else will ever call the route again for it otherwise.
        for (const entry of rows) {
          if (entry.status === 'pending') void runDeepDive(entry.id, row.id, domain)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [id, domain, loadEntries, runDeepDive])

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
      const created = await createDeepDive(supabase, {
        projectId: project.id,
        ownerId: authedUser.id,
        domain,
        prompt: text,
      })
      setPrompt('')
      await loadEntries(project.id, domain)
      void runDeepDive(created.id, project.id, domain)
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

          {/* History — each entry's live progress (while app/api/ai/deep-dive
              is actively polling it, Phase 2) comes from liveDeepDives;
              otherwise it just shows its own last-persisted row. */}
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
                {entries.map((entry) => {
                  const live = liveDeepDives[entry.id]
                  const displayRow = live ?? entry
                  return (
                    <SectionCard key={entry.id}>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>{entry.prompt}</p>
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <StatusChip status={displayRow.status} />
                        {entry.saved_to_project && <SavedChip />}
                        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-subtle)' }}>
                          {new Date(entry.created_at).toLocaleString()}
                        </span>
                        {displayRow.status === 'pending' && (
                          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-subtle)' }}>
                            {deepDiveStatusLabel(displayRow)}
                          </span>
                        )}
                      </div>
                      {entry.status === 'done' && entry.result != null && (
                        <DeepDiveResultView
                          domain={domain}
                          result={entry.result}
                          projectId={project.id}
                          onSaved={() => handleDeepDiveSaved(entry.id)}
                        />
                      )}
                    </SectionCard>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
