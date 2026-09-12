'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { HouseCard, CreateHouseCard } from '@/components/dashboard/HouseCard'
import { DashboardFilters } from '@/components/dashboard/DashboardFilters'
import { BulkDeleteModal } from '@/components/dashboard/BulkDeleteModal'
import Footer from '@/components/sections/Footer'
import { rowToSummary, type HouseRow, type HouseSummary } from '@/lib/dashboard/houses'
import { listProjects, type ProjectRow } from '@/lib/projects/data'
import { useAuthedPage, CenterNotice } from '@/components/useAuthedPage'
import { StudentAssignments } from '@/components/classroom/StudentAssignments'

// Columns selected for the grid — keep in sync with HouseRow.
const HOUSE_COLUMNS = 'id, title, question, status, layers_complete, updated_at, assignment_id, turned_in, draft, share_token, project_id'
// Shared-with-you houses never expose share_token (Mechanism 2 is owner-only)
// or draft-gate state (turn-in doesn't apply to someone else's house).
const SHARED_HOUSE_COLUMNS = 'id, title, question, status, layers_complete, updated_at'

export default function DashboardPage() {
  const router = useRouter()
  // Shared authed scaffold: user + account type + capabilities + signOut.
  const { accountType, workspaceMode, caps, signOut } = useAuthedPage()
  const [houses, setHouses] = useState<HouseSummary[] | null>(null)
  // Business mode (decision 021): grouping only kicks in once the user has
  // created at least one project — null while loading, [] for "none yet".
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  // Mechanism 1 ("Invite"): houses owned by someone else where the signed-in
  // user is a house_collaborators row — labeled distinctly, never merged into
  // "Your Houses" (plan doc step 4).
  const [sharedHouses, setSharedHouses] = useState<HouseSummary[] | null>(null)
  // Mechanism 2 ("Share"): a transient, non-error confirmation (e.g. "Link
  // copied") — separate from `error` below, which is reserved for failures.
  const [notice, setNotice] = useState<string | null>(null)
  // Turned-in houses that already carry teacher feedback: undo-turn-in is
  // blocked for these (bl-H2 — un-submitting after grading silently detached
  // the grade from the work the teacher actually saw).
  const [gradedIds, setGradedIds] = useState<Set<string>>(new Set())
  // Standard accounts with a class membership still need the Classroom nav
  // entry (bl-L8 — /classes was reachable only by typed URL for them).
  const [hasMemberships, setHasMemberships] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Filtered/sorted view of owned houses (driven by DashboardFilters).
  const [filteredHouses, setFilteredHouses] = useState<HouseSummary[]>([])
  // Bulk-select state.
  const [selectable, setSelectable] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)

  // Route protection is handled by proxy.ts, so by the time this renders
  // the user is authenticated; here we only load their houses.
  const loadHouses = useCallback(async () => {
    const supabase = createClient()
    // Resolved here (not via useAuthedPage's `user`, which waits on a profile
    // fetch) so the grid query fires on mount; the proxy guarantees a user,
    // so a null session just leaves the loading state in place.
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase
      .from('houses')
      .select(HOUSE_COLUMNS)
      // Only houses the user OWNS (db-C1) — teacher RLS (0014) also admits
      // students' houses, which must never appear in the personal grid.
      .eq('owner_id', user.id)
      // Strawman houses are attack targets, not the student's own work — keep
      // them out of the "Your Houses" grid.
      .eq('is_strawman', false)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Failed to load houses:', error)
      setError('Could not load your houses. Please refresh.')
      setHouses([])
      return
    }
    setError(null)
    const rows = data as HouseRow[]
    setHouses(rows.map(rowToSummary))

    const turnedInIds = rows.filter((r) => r.turned_in).map((r) => r.id)
    if (turnedInIds.length > 0) {
      const { data: fb } = await supabase
        .from('submission_feedback')
        .select('house_id')
        .in('house_id', turnedInIds)
      setGradedIds(new Set(((fb as { house_id: string }[]) ?? []).map((f) => f.house_id)))
    } else {
      setGradedIds(new Set())
    }
  }, [])

  // Mechanism 1 step 4: houses shared with the signed-in user as a
  // house_collaborators row, surfaced separately from — never merged into —
  // the owner-only query above. houses_select RLS (0004/0006/0020) already
  // permits reading these rows; this is purely a client-side query change.
  const loadSharedHouses = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data: memberships, error: membershipError } = await supabase
      .from('house_collaborators')
      .select('house_id, role')
      .eq('user_id', user.id)
    if (membershipError || !memberships || memberships.length === 0) {
      setSharedHouses([])
      return
    }
    const roleByHouse = new Map(memberships.map((m) => [m.house_id as string, m.role as 'viewer' | 'editor']))
    const { data, error } = await supabase
      .from('houses')
      .select(SHARED_HOUSE_COLUMNS)
      .in('id', Array.from(roleByHouse.keys()))
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('Failed to load shared houses:', error)
      setSharedHouses([])
      return
    }
    const rows = data as HouseRow[]
    setSharedHouses(
      rows.map((r) => ({ ...rowToSummary(r), sharedRole: roleByHouse.get(r.id) }))
    )
  }, [])

  // Business mode (decision 021): loaded regardless of workspace_mode — the
  // dashboard groups by project whenever the user HAS projects, not only while
  // the toggle is on, so flipping it back off doesn't hide already-grouped work.
  const loadProjects = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    try {
      setProjects(await listProjects(supabase, user.id))
    } catch (err) {
      console.error('Failed to load projects:', err)
      setProjects([])
    }
  }, [])

  useEffect(() => {
    if (accountType !== 'standard') return
    ;(async () => {
      const { count } = await createClient()
        .from('class_members')
        .select('class_id', { count: 'exact', head: true })
      setHasMemberships((count ?? 0) > 0)
    })()
  }, [accountType])

  useEffect(() => {
    loadHouses()
    loadSharedHouses()
    loadProjects()
  }, [loadHouses, loadSharedHouses, loadProjects])

  // draft=true routes into Draft Mode (decision 016): same blank house, but the
  // workspace opens with the AI-draft flow (?draft=1).
  async function handleCreate(draft = false) {
    if (creating) return
    setCreating(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setCreating(false)
      router.replace('/login')
      return
    }
    const { data, error } = await supabase
      .from('houses')
      .insert({ owner_id: user.id })
      .select('id')
      .single()
    if (error || !data) {
      // Log the fields as a flat string — the dev overlay collapses raw error
      // objects to `{}`, hiding the message/code/hint that actually matter.
      const e = error as { message?: string; code?: string; details?: string; hint?: string; status?: number } | null
      console.error(
        `Failed to create house — status=${e?.status ?? ''} code=${e?.code ?? ''} message=${e?.message ?? ''} details=${e?.details ?? ''} hint=${e?.hint ?? ''}`
      )
      setError('Could not create a new house. Please try again.')
      setCreating(false)
      return
    }
    router.push(`/build/${data.id}${draft ? '?draft=1' : ''}`)
  }

  async function handleRename(id: string, title: string) {
    const next = title.trim()
    const supabase = createClient()
    const { error } = await supabase.from('houses').update({ title: next || null }).eq('id', id)
    if (!error) {
      // The id could be an owned house OR (an editor's rename of) a house
      // shared with this user — update whichever list actually holds it.
      setHouses((hs) => (hs ?? []).map((h) => (h.id === id ? { ...h, title: next || null } : h)))
      setSharedHouses((hs) => (hs ?? []).map((h) => (h.id === id ? { ...h, title: next || null } : h)))
    }
  }

  async function handleDelete(id: string) {
    const supabase = createClient()
    const { error } = await supabase.from('houses').delete().eq('id', id)
    if (!error) {
      setHouses((hs) => (hs ?? []).filter((h) => h.id !== id))
    } else {
      setError('Could not delete that house. Please try again.')
    }
  }

  async function handleTurnIn(id: string, turnedIn: boolean) {
    // Draft gate (016 §2): turn-in is the one REAL submission action, so it
    // honors the same claim gate the workspace applies to publish/export.
    const house = (houses ?? []).find((h) => h.id === id)
    if (turnedIn && house?.draftLocked) {
      setError('Review and claim the AI-drafted layers before turning this house in.')
      return
    }
    // Graded submissions stay submitted (bl-H2): un-submitting would let the
    // work change under a grade the teacher already recorded.
    if (!turnedIn && gradedIds.has(id)) {
      setError('This submission has been graded — ask your teacher if it needs to be reopened.')
      return
    }
    const supabase = createClient()
    const { error } = await supabase
      .from('houses')
      .update({ turned_in: turnedIn, turned_in_at: turnedIn ? new Date().toISOString() : null })
      .eq('id', id)
    if (!error) {
      setError(null)
      setHouses((hs) => (hs ?? []).map((h) => (h.id === id ? { ...h, turnedIn } : h)))
    } else {
      setError(
        turnedIn
          ? 'Could not turn the house in — please try again.'
          : 'Could not undo the turn-in — please try again.'
      )
    }
  }

  // Mechanism 2 ("Share"): calls app/api/share-link/route.ts rather than
  // updating houses.share_token directly. That route still performs the
  // UPDATE on THIS caller's own session (owner-gated houses_update RLS —
  // 0004/0006/0020 — unchanged), so it grants no new access; going through it
  // instead of a direct client `.update()` is what lets house_activity log a
  // share_link_created/revoked row (team-panel-v2 item 6) no matter whether
  // the action came from here or from TeamPanel's own share block, which
  // calls the exact same route.
  async function handleGetShareLink(id: string) {
    try {
      const res = await fetch('/api/share-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ houseId: id, action: 'create' }),
      })
      const body = (await res.json().catch(() => ({}))) as { shareToken?: string; error?: string }
      if (!res.ok || !body.shareToken) {
        setError('Could not create a share link — please try again.')
        return
      }
      setHouses((hs) => (hs ?? []).map((h) => (h.id === id ? { ...h, shareToken: body.shareToken! } : h)))
      const url = `${window.location.origin}/shared/${body.shareToken}`
      try {
        await navigator.clipboard.writeText(url)
        setError(null)
        setNotice('Share link copied to clipboard.')
      } catch {
        setNotice(`Share link: ${url}`)
      }
    } catch {
      setError('Could not create a share link — please try again.')
    }
  }

  async function handleRevokeShareLink(id: string) {
    try {
      const res = await fetch('/api/share-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ houseId: id, action: 'revoke' }),
      })
      if (!res.ok) {
        setError('Could not revoke the share link — please try again.')
        return
      }
      setHouses((hs) => (hs ?? []).map((h) => (h.id === id ? { ...h, shareToken: null } : h)))
      setNotice('Share link revoked — it no longer works.')
    } catch {
      setError('Could not revoke the share link — please try again.')
    }
  }

  // The "Continue where you left off" house — never selectable.
  const continueHouse = houses?.find((h) => h.status !== 'empty') ?? null
  const continueHouseId = continueHouse?.id ?? null

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectable(false)
    setSelectedIds(new Set())
    setShowBulkDelete(false)
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    const supabase = createClient()
    const { error } = await supabase.from('houses').delete().in('id', ids)
    if (!error) {
      setHouses((hs) => (hs ?? []).filter((h) => !selectedIds.has(h.id)))
      exitSelectMode()
    } else {
      setError('Could not delete the selected houses. Please try again.')
      setShowBulkDelete(false)
    }
  }

  if (houses === null) {
    return <CenterNotice>Loading your houses…</CenterNotice>
  }

  const isTeacher = caps.canCreateClasses
  const isStudent = accountType === 'student'
  // Draft Mode entry (decision 016): standard + teacher only — students never
  // see it (and the route re-checks server-side).
  const canDraft = caps.canAuthorDraft

  // Business mode (decision 021): group by project once the user has any,
  // regardless of whether the toggle is currently on (plans/active/business-mode/
  // 01-projects-and-toggle.md — don't force project-first navigation on users
  // with zero projects, and don't hide already-grouped work if they flip back).
  const hasProjects = (projects?.length ?? 0) > 0

  function renderHouseCard(h: HouseSummary) {
    const isContinueHouse = h.id === continueHouseId
    return (
      <HouseCard
        key={h.id}
        house={h}
        href={`/build/${h.id}`}
        graded={gradedIds.has(h.id)}
        selectable={selectable && !isContinueHouse}
        selected={selectedIds.has(h.id)}
        onToggle={toggleSelect}
        onRename={handleRename}
        onDelete={handleDelete}
        onTurnIn={handleTurnIn}
        onGetShareLink={handleGetShareLink}
        onRevokeShareLink={handleRevokeShareLink}
      />
    )
  }

  const createCards = (
    <>
      <CreateHouseCard onClick={() => handleCreate()} disabled={creating} />
      {canDraft && (
        <CreateHouseCard onClick={() => handleCreate(true)} disabled={creating} label="Start with an AI draft" />
      )}
    </>
  )

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
  }
  const sectionHeadingStyle: React.CSSProperties = {
    fontFamily: 'var(--font-display)',
    fontWeight: 500,
    fontSize: 'clamp(18px, 2.2vw, 22px)',
    letterSpacing: '-0.01em',
    color: 'var(--ink)',
  }

  return (
    <div className="acct-vh-min" style={{ display: 'flex', flexDirection: 'column', background: 'var(--parchment)' }}>
      <DashboardHeader
        onSignOut={() => void signOut()}
        showClassroom={isTeacher || isStudent || hasMemberships}
        classroomHref={isTeacher ? '/classroom' : '/classes'}
        // Business mode (decision 021): the nav entry follows the toggle, but
        // stays visible if the user already has projects so they never lose
        // the way back to manage/reactivate them after switching modes off.
        showProjects={workspaceMode === 'business' || hasProjects}
      />

      <main id="main" style={{ flex: '1 1 auto' }}>
        <div className="container" style={{ paddingBlock: 'clamp(32px, 5vw, 56px)' }}>
          {/* Heading */}
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(30px, 4vw, 40px)', letterSpacing: '-0.015em', color: 'var(--ink)' }}>
            Your Houses
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--ink-mid)', marginTop: 8 }}>
            Build and explore your Houses of Thought.
          </p>

          {error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)', marginTop: 16 }}>
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--green-text)', marginTop: 16 }}>
              {notice}
            </p>
          )}

          {/* Continue where you left off — most recently edited house with
              content (September 2026 UX audit, item 3). */}
          {(() => {
            const recent = houses.find((h) => h.status !== 'empty')
            if (!recent) return null
            return (
              <Link
                href={`/build/${recent.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  marginTop: 'clamp(24px, 3vw, 36px)',
                  padding: 'clamp(16px, 2.5vw, 22px)',
                  background: 'var(--amber-tint)',
                  border: '1px solid var(--amber)',
                  borderRadius: 'var(--radius-card)',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ink)'
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(20,33,58,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--amber)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--amber-text)', margin: 0 }}>
                    Continue where you left off
                  </p>
                  <p style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(17px, 2.2vw, 22px)', letterSpacing: '-0.01em', color: 'var(--ink)', margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {recent.title ?? 'Untitled House'}
                  </p>
                  {recent.question && (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {recent.question}
                    </p>
                  )}
                  <p className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)', margin: '8px 0 0' }}>
                    {recent.editedLabel}
                  </p>
                </div>
                <span
                  style={{
                    flex: '0 0 auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-body)',
                    fontWeight: 600,
                    fontSize: 14,
                    color: 'var(--ink)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Continue building
                  <span aria-hidden="true">→</span>
                </span>
              </Link>
            )
          })()}

          {/* Filters bar: search, status pills, sort, select toggle */}
          {houses.length > 0 && (
            <DashboardFilters
              houses={houses}
              continueHouseId={continueHouseId}
              selectable={selectable}
              onToggleSelectable={() => selectable ? exitSelectMode() : setSelectable(true)}
              onFiltered={setFilteredHouses}
            />
          )}

          {/* Assigned work (students only; self-hides when empty) */}
          <div style={{ marginTop: 'clamp(24px, 3vw, 36px)' }}>
            <StudentAssignments />
          </div>

          {/* Grid (single column on very narrow phones via acct-card-grid) — flat
              when the user has no projects (unchanged), grouped by project
              otherwise (business mode, decision 021). */}
          {!hasProjects ? (
            <div className="acct-card-grid" style={{ ...gridStyle, marginTop: 'clamp(24px, 3vw, 36px)' }}>
              {filteredHouses.length === 0 && houses.length > 0 && (
                <p className="mono" style={{ fontSize: 12, color: 'var(--ink-subtle)', gridColumn: '1 / -1', padding: '24px 0' }}>
                  No houses match your filters.
                </p>
              )}
              {filteredHouses.map(renderHouseCard)}
              {createCards}
            </div>
          ) : (
            <div style={{ marginTop: 'clamp(24px, 3vw, 36px)', display: 'flex', flexDirection: 'column', gap: 'clamp(28px, 3.5vw, 40px)' }}>
              {filteredHouses.length === 0 && houses.length > 0 && (
                <p className="mono" style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>
                  No houses match your filters.
                </p>
              )}
              {(projects ?? []).map((p) => {
                const group = filteredHouses.filter((h) => h.projectId === p.id)
                if (group.length === 0) return null
                return (
                  <div key={p.id}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                      <h2 style={{ ...sectionHeadingStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {p.name}
                        {p.status === 'archived' && (
                          <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)', border: '1px solid var(--rule)', borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Archived
                          </span>
                        )}
                      </h2>
                      <Link href={`/projects/${p.id}`} className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)', whiteSpace: 'nowrap' }}>
                        Manage project →
                      </Link>
                    </div>
                    <div className="acct-card-grid" style={gridStyle}>{group.map(renderHouseCard)}</div>
                  </div>
                )
              })}
              {(() => {
                const unassigned = filteredHouses.filter((h) => h.projectId === null)
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                      <h2 style={sectionHeadingStyle}>Not in a project</h2>
                      <Link href="/projects" className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)', whiteSpace: 'nowrap' }}>
                        Manage projects →
                      </Link>
                    </div>
                    <div className="acct-card-grid" style={gridStyle}>
                      {unassigned.map(renderHouseCard)}
                      {createCards}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Mechanism 1 ("Invite"): houses someone else owns where the
              signed-in user is a house_collaborators row. Deliberately its own
              section, never merged into the grid above — these aren't yours. */}
          {sharedHouses !== null && sharedHouses.length > 0 && (
            <div style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(20px, 2.6vw, 26px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                Shared with you
              </h2>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 6 }}>
                Houses other people invited you to. Rename requires editor access; only the owner can
                delete or share.
              </p>
              <div
                className="acct-card-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 20,
                  marginTop: 16,
                }}
              >
                {sharedHouses.map((h) => (
                  <HouseCard
                    key={h.id}
                    house={h}
                    href={`/build/${h.id}`}
                    onRename={h.sharedRole === 'editor' ? handleRename : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Bulk-select bottom bar */}
        {selectable && selectedIds.size > 0 && (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 40,
              background: 'var(--white)',
              borderTop: '1px solid var(--rule)',
              boxShadow: '0 -4px 16px rgba(20,33,58,0.06)',
              padding: '12px clamp(24px, 5vw, 48px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={() => setShowBulkDelete(true)}
              style={{
                height: 38,
                padding: '0 18px',
                borderRadius: 'var(--radius-btn)',
                fontWeight: 600,
                fontSize: 14,
                color: '#fff',
                background: 'var(--warning)',
                cursor: 'pointer',
              }}
            >
              Delete selected
            </button>
          </div>
        )}
      </main>

      {/* Bulk-delete confirmation modal */}
      {showBulkDelete && (
        <BulkDeleteModal
          count={selectedIds.size}
          onConfirm={handleBulkDelete}
          onClose={() => setShowBulkDelete(false)}
        />
      )}

      <Footer />
    </div>
  )
}
