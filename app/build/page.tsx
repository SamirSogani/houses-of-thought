'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listProjects, type ProjectRow } from '@/lib/projects/data'

// The id-less /build route no longer renders a house. It creates a fresh blank
// house for the signed-in user and redirects into /build/[id], where load +
// autosave live. This keeps entry points that link to bare /build working.
// ?draft=1 (Draft Mode, decision 016) is carried through to the workspace.
// ?q=… (from the /try conversion CTA → login → build redirect) pre-fills the
// house's Frame-layer question so the user picks up where they left off.
//
// Business mode (decision 021, plans/active/business-mode/01-projects-and-toggle.md):
// when workspace_mode = 'business' AND the user has at least one active
// project, this pauses on a picker before creating the house so it can set
// houses.project_id. workspace_mode = 'general' (or zero active projects) is
// byte-for-byte the original behavior — auto-create, no picker.
export default function BuildPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; q?: string }>
}) {
  const router = useRouter()
  const { draft, q } = use(searchParams)
  const draftRequested = draft === '1'
  const prefillQuestion = q?.trim() || null

  const [projectChoices, setProjectChoices] = useState<ProjectRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createHouse = useCallback(
    async (supabase: SupabaseClient, ownerId: string, projectId: string | null) => {
      setCreating(true)
      const insert: Record<string, unknown> = { owner_id: ownerId }
      if (prefillQuestion) insert.question = prefillQuestion
      if (projectId) insert.project_id = projectId

      const { data, error } = await supabase
        .from('houses')
        .insert(insert)
        .select('id')
        .single()
      if (error || !data) {
        console.error('Failed to create house:', error)
        router.replace('/dashboard')
        return
      }
      router.replace(`/build/${data.id}${draftRequested ? '?draft=1' : ''}`)
    },
    [prefillQuestion, draftRequested, router]
  )

  useEffect(() => {
    const supabase = createClient()
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active || !user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_mode')
        .eq('id', user.id)
        .single()
      if (!active) return

      if (profile?.workspace_mode !== 'business') {
        await createHouse(supabase, user.id, null)
        return
      }

      // Business mode: only pause for a picker if there's actually something
      // to pick — zero active projects falls straight back to today's flow.
      let choices: ProjectRow[] = []
      try {
        choices = (await listProjects(supabase, user.id)).filter((p) => p.status === 'active')
      } catch (err) {
        console.error('Failed to load projects for the picker:', err)
      }
      if (!active) return
      if (choices.length === 0) {
        await createHouse(supabase, user.id, null)
        return
      }
      setProjectChoices(choices)
    })()
    return () => {
      active = false
    }
  }, [createHouse])

  async function handlePick(projectId: string | null) {
    if (creating) return
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }
    await createHouse(supabase, user.id, projectId)
  }

  if (projectChoices && !creating) {
    return (
      <main
        id="main"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--parchment)',
          padding: 24,
        }}
      >
        <div style={{ width: 460, maxWidth: '100%', background: 'var(--white)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-card)', padding: 24 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
            Add this house to a project?
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 8, lineHeight: 1.5 }}>
            Optional — you can always change this later from the project page.
          </p>
          {error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)', marginTop: 10 }}>{error}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
            {projectChoices.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePick(p.id).catch(() => setError('Could not create the house. Please try again.'))}
                style={{
                  textAlign: 'left',
                  padding: '11px 14px',
                  border: '1px solid var(--rule)',
                  borderRadius: 8,
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600,
                  fontSize: 14,
                  color: 'var(--ink)',
                  background: 'var(--white)',
                }}
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handlePick(null).catch(() => setError('Could not create the house. Please try again.'))}
              className="mono"
              style={{
                textAlign: 'left',
                padding: '11px 14px',
                border: '1px dashed var(--rule)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--ink-subtle)',
                background: 'transparent',
              }}
            >
              No project
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main
      id="main"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--parchment)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.11em',
        textTransform: 'uppercase',
        color: 'var(--ink-subtle)',
      }}
    >
      {creating ? 'Creating your house…' : 'Loading…'}
    </main>
  )
}
