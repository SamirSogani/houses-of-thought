'use client'

// Project detail (business mode, decision 021): editable name/description +
// archive toggle, the accumulating-context editor (Phase 3, plans/active/
// business-mode/03-accumulating-context.md — direct edit of stage/customer/
// businessModel here; keyFacts accumulate passively from a house's Review
// layer or the reasoning pipeline, SaveFactsToProjectButton), and the houses
// grouped under this project.

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { HouseCard } from '@/components/dashboard/HouseCard'
import Footer from '@/components/sections/Footer'
import { useAuthedPage, CenterNotice } from '@/components/useAuthedPage'
import {
  getProject,
  setProjectStatus,
  updateProject,
  updateProjectContext,
  removeProjectContextFact,
  type ProjectRow,
} from '@/lib/projects/data'
import { rowToSummary, type HouseRow, type HouseSummary } from '@/lib/dashboard/houses'
import { SectionCard, FieldLabel, TextInput, TextArea } from '@/components/profile/primitives'
import { ProjectDocuments } from '@/components/projects/ProjectDocuments'
import { DEEP_DIVE_DOMAINS, DEEP_DIVE_DOMAIN_META } from '@/lib/projects/deepDives'

const HOUSE_COLUMNS = 'id, title, question, status, layers_complete, updated_at, assignment_id, turned_in, draft, share_token, project_id'

type SaveState = 'saved' | 'saving' | 'error'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user, accountType, caps, signOut } = useAuthedPage()

  // null while loading; undefined once we know it's gone/not-yours (RLS makes
  // both look identical — same convention as app/build/[id]/page.tsx).
  const [project, setProject] = useState<ProjectRow | null | undefined>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // Accumulating context's structured fields (Phase 3) — direct-edit form.
  const [stage, setStage] = useState('')
  const [customer, setCustomer] = useState('')
  const [businessModel, setBusinessModel] = useState('')
  // keyFacts accumulates passively (SaveFactsToProjectButton, from a house);
  // this page only displays it and lets the user remove a stale/wrong one.
  const [keyFacts, setKeyFacts] = useState<string[]>([])
  const [save, setSave] = useState<SaveState>('saved')
  const [houses, setHouses] = useState<HouseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True while the form fields are being set FROM the loaded row rather than
  // a user edit — without this, hydrating the form on load re-triggers the
  // autosave effect below and bumps updated_at on a page that was only ever
  // viewed, never edited.
  const hydrating = useRef(true)
  const latest = useRef({ name: '', description: '', stage: '', customer: '', businessModel: '' })
  latest.current = { name, description, stage, customer, businessModel }

  const loadHouses = useCallback(async (projectId: string) => {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase
      .from('houses')
      .select(HOUSE_COLUMNS)
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .eq('is_strawman', false)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('Failed to load project houses:', error)
      setHouses([])
      return
    }
    setHouses((data as HouseRow[]).map(rowToSummary))
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let active = true
    ;(async () => {
      const row = await getProject(supabase, id)
      if (!active) return
      setProject(row ?? undefined)
      if (row) {
        hydrating.current = true
        setName(row.name)
        setDescription(row.description)
        setStage(row.context.stage ?? '')
        setCustomer(row.context.customer ?? '')
        setBusinessModel(row.context.businessModel ?? '')
        setKeyFacts(row.context.keyFacts)
        loadHouses(row.id)
      }
    })()
    return () => {
      active = false
    }
  }, [id, loadHouses])

  // Persists both the plain columns and the context's structured fields for
  // whatever latest.current holds — shared by the debounce and flush-on-
  // unmount effects below so the two can never drift.
  async function persistEdits() {
    const supabase = createClient()
    await Promise.all([
      updateProject(supabase, id, { name: latest.current.name, description: latest.current.description }),
      updateProjectContext(supabase, id, {
        stage: latest.current.stage || undefined,
        customer: latest.current.customer || undefined,
        businessModel: latest.current.businessModel || undefined,
      }),
    ])
  }

  // Debounced autosave — same pattern as ProfileForm, scaled down (no
  // username-style conflict case applies here).
  useEffect(() => {
    if (!project) return
    if (hydrating.current) {
      hydrating.current = false
      return
    }
    setSave('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await persistEdits()
        setSave('saved')
      } catch {
        setSave('error')
      }
    }, 650)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, stage, customer, businessModel, id])

  // Flush a still-pending edit if the user navigates away inside the 650ms
  // debounce window — same data-loss guard ProfileForm applies to profiles.
  // Declared after the debounce effect so its cleanup runs first on unmount:
  // saveTimer.current is still live here iff an edit hadn't saved yet.
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return
      clearTimeout(saveTimer.current)
      saveTimer.current = null
      persistEdits().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleStatusToggle() {
    if (!project) return
    const nextStatus = project.status === 'active' ? 'archived' : 'active'
    const supabase = createClient()
    try {
      await setProjectStatus(supabase, id, nextStatus)
      setProject((p) => (p ? { ...p, status: nextStatus } : p))
    } catch {
      setError('Could not update the project status. Please try again.')
    }
  }

  // Manual curation of a passively-accumulated fact (Phase 3's other half of
  // "do not let it grow unbounded": a cap alone can't fix a WRONG fact).
  async function handleRemoveFact(fact: string) {
    const supabase = createClient()
    const prior = keyFacts
    setKeyFacts((facts) => facts.filter((f) => f !== fact))
    try {
      await removeProjectContextFact(supabase, id, fact)
    } catch {
      setKeyFacts(prior)
      setError('Could not remove that fact. Please try again.')
    }
  }

  if (project === null) {
    return <CenterNotice>Loading project…</CenterNotice>
  }

  if (project === undefined) {
    return (
      <div className="acct-vh-min" style={{ display: 'flex', flexDirection: 'column', background: 'var(--parchment)' }}>
        <DashboardHeader onSignOut={() => void signOut()} active="projects" showProjects />
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
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link href="/dashboard" style={{ color: 'var(--ink-subtle)' }}>Dashboard</Link>
            <span aria-hidden="true">/</span>
            <Link href="/projects" style={{ color: 'var(--ink-subtle)' }}>Projects</Link>
            <span aria-hidden="true">/</span>
            <span style={{ color: 'var(--ink)' }}>{project.name}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 38px)', letterSpacing: '-0.015em', color: 'var(--ink)' }}>
              {project.name}
            </h1>
            <span
              role="status"
              className="mono"
              style={{ fontSize: 10, color: save === 'error' ? 'var(--warning-text)' : 'var(--ink-subtle)' }}
            >
              {save === 'error' ? "Couldn't save — try again" : save === 'saving' ? 'Saving…' : 'All changes saved'}
            </span>
          </div>

          {error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)', marginTop: 12 }}>{error}</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 'clamp(20px, 3vw, 32px)' }}>
            <SectionCard>
              <FieldLabel label="Name" />
              <TextInput value={name} onChange={setName} ariaLabel="Project name" />
            </SectionCard>
            <SectionCard>
              <FieldLabel label="Description" />
              <TextArea value={description} onChange={setDescription} placeholder="What is this project about?" ariaLabel="Project description" />
            </SectionCard>
            <SectionCard>
              <FieldLabel label="Status" helper={project.status === 'active' ? 'Archiving hides this project from new-house pickers but keeps its houses and data.' : 'Reactivate to use this project again when creating houses.'} />
              <button
                type="button"
                onClick={handleStatusToggle}
                style={{
                  height: 40,
                  padding: '0 16px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  border: `1px solid ${project.status === 'active' ? 'var(--rule)' : 'var(--ink)'}`,
                  color: project.status === 'active' ? 'var(--ink-mid)' : 'var(--ink)',
                  background: 'var(--white)',
                }}
              >
                {project.status === 'active' ? 'Archive project' : 'Reactivate project'}
              </button>
            </SectionCard>
          </div>

          {/* Deep Dive tools (decision 022, plans/active/project-deep-dives):
              four fixed, project-scoped entry points into one parameterized
              engine — reachable here, independent of any single house.
              Placed right after the project's own basic info (name/
              description/status), ahead of Accumulating context/Documents/
              Houses, after real feedback that burying it at the very bottom
              of the page — below all three of those sections — made it
              effectively undiscoverable. */}
          <div style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(20px, 2.6vw, 26px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
              Deep Dive
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 6 }}>
              One specific aspect of deep thinking about this project, without running a full house.
            </p>

            <div className="acct-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 16 }}>
              {DEEP_DIVE_DOMAINS.map((domain) => {
                const meta = DEEP_DIVE_DOMAIN_META[domain]
                return (
                  <Link key={domain} href={`/projects/${id}/deep-dive/${domain}`} style={{ display: 'block' }}>
                    <SectionCard>
                      <FieldLabel label={meta.label} helper={meta.description} />
                    </SectionCard>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Accumulating context (Phase 3, decision 021): structured fields
              direct-edit here; keyFacts accumulate passively from a house's
              Review layer or the reasoning pipeline reaching a conclusion
              (SaveFactsToProjectButton) — this page displays and curates them. */}
          <div style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(20px, 2.6vw, 26px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
              Accumulating context
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 6 }}>
              What every house built under this project reads as background — folded into the co-pilot,
              research, and critique the same way your own interview answers are.
            </p>

            <div className="acct-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 16 }}>
              <SectionCard>
                <FieldLabel label="Stage" helper="e.g. idea, pre-seed, revenue" />
                <TextInput value={stage} onChange={setStage} placeholder="What stage is this at?" ariaLabel="Project stage" />
              </SectionCard>
              <SectionCard>
                <FieldLabel label="Customer" />
                <TextInput value={customer} onChange={setCustomer} placeholder="Who is this for?" ariaLabel="Project customer" />
              </SectionCard>
              <SectionCard>
                <FieldLabel label="Business model" />
                <TextInput value={businessModel} onChange={setBusinessModel} placeholder="How does this make money?" ariaLabel="Project business model" />
              </SectionCard>
            </div>

            <div style={{ marginTop: 16 }}>
              <SectionCard>
                <FieldLabel
                  label="Key facts"
                  helper="Saved one click at a time from a house's Review layer or a finished reasoning run — never scraped automatically."
                />
                {keyFacts.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--ink-subtle)' }}>None yet.</p>
                ) : (
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {keyFacts.map((fact) => (
                      <li
                        key={fact}
                        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}
                      >
                        <span>{fact}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFact(fact)}
                          aria-label={`Remove fact: ${fact}`}
                          className="mono"
                          style={{ flex: '0 0 auto', fontSize: 10, color: 'var(--ink-subtle)', border: '1px solid var(--rule)', borderRadius: 6, padding: '2px 7px' }}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>

            {/* Document upload (Phase 4, decision 021): not wired into house-
                building yet — that's Phase 5's retrieval. */}
            {user && (
              <div style={{ marginTop: 16 }}>
                <ProjectDocuments projectId={id} ownerId={user.id} />
              </div>
            )}
          </div>

          {/* Houses under this project */}
          <div style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(20px, 2.6vw, 26px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
              Houses
            </h2>
            {houses === null ? (
              <p className="mono" style={{ fontSize: 12, color: 'var(--ink-subtle)', marginTop: 16 }}>Loading houses…</p>
            ) : houses.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 12 }}>
                No houses in this project yet. Pick it when creating a new house from{' '}
                <Link href="/build" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>New house</Link>.
              </p>
            ) : (
              <div
                className="acct-card-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, marginTop: 16 }}
              >
                {houses.map((h) => (
                  <HouseCard key={h.id} house={h} href={`/build/${h.id}`} />
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
