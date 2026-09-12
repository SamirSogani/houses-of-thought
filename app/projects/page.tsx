'use client'

// Projects list: create + archive/reactivate (business mode, decision 021,
// plans/active/business-mode/01-projects-and-toggle.md). Route protection is
// proxy.ts's job (added to PROTECTED_PREFIXES alongside this route); RLS
// (0048) means a signed-in user only ever sees their own rows regardless.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import Footer from '@/components/sections/Footer'
import { useAuthedPage, CenterNotice } from '@/components/useAuthedPage'
import {
  createProject,
  listProjects,
  rowToSummary,
  setProjectStatus,
  type ProjectSummary,
} from '@/lib/projects/data'
import { ProjectCard, CreateProjectCard } from '@/components/projects/ProjectCard'
import { CreateProjectModal } from '@/components/projects/CreateProjectModal'

export default function ProjectsPage() {
  const router = useRouter()
  const { accountType, caps, signOut } = useAuthedPage()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    try {
      const rows = await listProjects(supabase, user.id)
      setProjects(rows.map(rowToSummary))
    } catch (err) {
      console.error('Failed to load projects:', err)
      setError('Could not load your projects. Please refresh.')
      setProjects([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(input: { name: string; description: string }) {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }
    const row = await createProject(supabase, user.id, input)
    setShowCreate(false)
    router.push(`/projects/${row.id}`)
  }

  async function handleArchive(id: string) {
    const supabase = createClient()
    try {
      await setProjectStatus(supabase, id, 'archived')
      setProjects((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, status: 'archived' } : p)))
    } catch {
      setError('Could not archive that project. Please try again.')
    }
  }

  async function handleReactivate(id: string) {
    const supabase = createClient()
    try {
      await setProjectStatus(supabase, id, 'active')
      setProjects((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, status: 'active' } : p)))
    } catch {
      setError('Could not reactivate that project. Please try again.')
    }
  }

  if (projects === null) {
    return <CenterNotice>Loading your projects…</CenterNotice>
  }

  const isTeacher = caps.canCreateClasses
  const isStudent = accountType === 'student'
  const active = projects.filter((p) => p.status === 'active')
  const archived = projects.filter((p) => p.status === 'archived')

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
        <div className="container" style={{ paddingBlock: 'clamp(32px, 5vw, 56px)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(30px, 4vw, 40px)', letterSpacing: '-0.015em', color: 'var(--ink)' }}>
            Projects
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--ink-mid)', marginTop: 8 }}>
            Group your houses under a project and build accumulating context over time.
          </p>

          {error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)', marginTop: 16 }}>
              {error}
            </p>
          )}

          <div
            className="acct-card-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20, marginTop: 'clamp(24px, 3vw, 36px)' }}
          >
            {active.map((p) => (
              <ProjectCard key={p.id} project={p} onArchive={handleArchive} />
            ))}
            <CreateProjectCard onClick={() => setShowCreate(true)} />
          </div>

          {archived.length > 0 && (
            <div style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(20px, 2.6vw, 26px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                Archived
              </h2>
              <div
                className="acct-card-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20, marginTop: 16 }}
              >
                {archived.map((p) => (
                  <ProjectCard key={p.id} project={p} onReactivate={handleReactivate} />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateProjectModal onCreate={handleCreate} onClose={() => setShowCreate(false)} />
      )}

      <Footer />
    </div>
  )
}
