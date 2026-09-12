'use client'

// Root of the Build a House workspace: three-zone shell + right-rail tabs + overlays
// + toast. Owns the reducer, the save controller (status machine + single-flight
// queue + flush), the undo history, and the cross-tab writer lock. See handoff
// 02 §3 / 05 §1 and analysis/frontend-architecture-plan.md Phase 0.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { reducer } from '@/lib/build/state'
import { computeStrength } from '@/lib/build/strength'
import { DRAFT_STAGES, unclaimedDraftStages } from '@/lib/ai/draft'
import { serializeContent, type PersistedContent } from '@/lib/build/persistence'
import type { Action, State } from '@/lib/build/types'
import type { PipelineMode } from '@/lib/ai/reasoning/steps'
import { AppBar } from './AppBar'
import { SAVE_STATUS_TEXT, type SaveStatus } from './ContextBar'
import { LayerNav } from './LayerNav'
import { Canvas } from './Canvas'
import { RightRail, MobileRailDrawer, type TeamContext } from './RightRail'
import { useTeamRoster } from './useTeamRoster'
import { SubmissionFeedback } from './SubmissionFeedback'
import { Toast } from './Toast'
import { SparkIcon } from './buildIcons'
import { useIsMobile } from './useIsMobile'
import { useDraftRunner } from './useDraftRunner'
import { useReasoningPipelineRunner } from './useReasoningPipelineRunner'
import { PipelineFullView, PipelineToggleButton } from './PipelineFullView'
import { useHouseTabLock } from './useHouseTabLock'
import { DraftCard } from './rail/DraftCard'
import type { SuggestCache } from './rail/CopilotPanel'
import { useInterviewSession } from './rail/InterviewCard'
import { useSectors } from './sectors/useSectors'
import { OnboardingTour } from './OnboardingTour'
import { createClient } from '@/lib/supabase/client'

const UNDO_CAP = 30
const UNDO_CHIP_MS = 6_000

export function BuildHousePage({
  initialState,
  userEmail,
  houseId,
  modeLocked = false,
  readOnly = false,
  strawman = false,
  turnedIn = false,
  feedback = null,
  draftEligible = false,
  draftEntry = false,
  pipelineEntry = false,
  viewerCollaborator = false,
  team = null,
  hasSeenTour = true,
  onSignOut,
  onSave,
}: {
  initialState: State
  userEmail: string | null
  // The house id; needed to load/save teacher feedback. Null for local drafts.
  houseId?: string
  // When true (students), the Learn/Decide toggle is disabled and pinned.
  modeLocked?: boolean
  // When true (a teacher viewing a student's house, or a viewer collaborator),
  // edits don't persist and the write-affordances are disabled; a banner makes
  // the read-only state explicit.
  readOnly?: boolean
  // When true, this is an AI strawman to attack (implies readOnly upstream); the
  // banner reads differently from the teacher read-only case.
  strawman?: boolean
  // Owner's own turned-in submission (implies readOnly upstream); the banner
  // points at the dashboard's undo-turn-in instead of "a student's house".
  turnedIn?: boolean
  // Teacher assessment surface: 'edit' (teacher on a student submission),
  // 'view' (student on their own house), or null (not a graded context).
  feedback?: 'edit' | 'view' | null
  // Draft Mode (decision 016): true only for signed-in accounts with
  // canAuthorDraft (cosmetic here — the route re-checks server-side).
  draftEligible?: boolean
  // True when the user arrived via "Start with an AI draft" (?draft=1).
  draftEntry?: boolean
  // Founder Mode reasoning-pipeline entry point (2026-09-12, Samir's spec):
  // true when the user arrived via the dashboard's "Start with the reasoning
  // pipeline" card (?pipeline=1) — see PipelineFullView.tsx's own header
  // comment for the full design. Only ever true for a fresh, blank house.
  pipelineEntry?: boolean
  // Mechanism 1 ("Invite"): true when readOnly is true SPECIFICALLY because the
  // caller is a 'viewer' house_collaborators row (not a teacher/strawman case)
  // — the read-only banner reads differently for it.
  viewerCollaborator?: boolean
  // Real standing on this house (owner, or an existing collaborator) — surfaces
  // the RightRail Team tab when set; hidden entirely otherwise (teacher view,
  // strawman attack, a stranger who somehow reached this far).
  team?: TeamContext | null
  // Onboarding tour (September 2026 UX audit, item 1). True = the user has
  // already seen (or skipped) the tour. Defaults to true so the tour never
  // shows for callers that don't pass the flag (e.g. the /house local draft).
  hasSeenTour?: boolean
  onSignOut: () => void
  // Persistence adapter. Must REJECT on failure — a SaveError-shaped `code`
  // ('save-failed' | 'stale-write' | 'signed-out') drives the status machine.
  onSave: (state: State) => void | Promise<void>
}) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const strength = computeStrength(state)
  // Draft Mode: the stage loop lives here (not in the rail) so tab switches
  // can't kill a draft in progress. The card is created here and passed down.
  const canDraft = draftEligible && !readOnly && !strawman
  const draftRunner = useDraftRunner(state, dispatch, canDraft, houseId)
  // House-scoped reasoning pipeline (plan doc 27, decision 019): same
  // eligibility gate as Draft Mode (canDraft — draftEligible excludes
  // students server-side too via capabilitiesFor().canAuthorDraft) and same
  // "lives in BuildHousePage so it survives tab switches" rationale as
  // draftRunner above. Only ever passed down when canDraft AND there's a
  // real houseId to scope it to (undefined on the localStorage /house
  // builder) — CopilotPanel falls back to the pre-pipeline interview+draft
  // offer whenever pipelineRunner is undefined.
  const reasoningPipelineRunner = useReasoningPipelineRunner(dispatch, canDraft ? houseId : undefined)
  // Founder Mode entry-point redesign (2026-09-12, Samir's spec): a house
  // arriving via ?pipeline=1 starts fully taken over by PipelineFullView
  // instead of the normal canvas+rail — "Go to house" (in that view) and
  // "Reasoning pipeline" (in the status row below, once a run exists) toggle
  // this without ever remounting reasoningPipelineRunner, so a run in
  // progress keeps advancing regardless of which view is showing. Ignored
  // (falls straight through to the normal view) when the pipeline isn't
  // actually available — canDraft false (e.g. a student account) would
  // otherwise strand the person on a form whose Run button silently no-ops.
  const [pipelineTakeover, setPipelineTakeover] = useState(pipelineEntry && canDraft)
  // Suggestion cache + interview session live here (like the draft runner) so
  // tab switches and the mobile drawer can't destroy them — a discarded cache
  // refires a paid suggest call; a discarded transcript loses the interview.
  const suggestCacheRef = useRef<SuggestCache>(new Map())
  const interview = useInterviewSession()
  // Same-browser second tab: passive until Take over (frontend plan Phase 0 §6).
  const { lockedByOtherTab, takeOver } = useHouseTabLock(houseId)
  // Real owner/collaborator names + presence (team-panel-v2 items 1/4),
  // fetched once here and threaded to both ContextBar (avatars) and
  // RightRail/MobileRailDrawer (TeamPanel's membership list) so they can
  // never disagree about who's on this house. No-ops when team is null
  // (teacher view, strawman attack).
  const roster = useTeamRoster(team)
  // Sector deep-dive analyses (implications / perspectives). Managed outside
  // the house reducer because sectors live in their own DB table and don't
  // affect the house save controller.
  const sectors = useSectors(houseId)
  // Pipeline progress lives inline in the canvas (Level 2 redesign) — no
  // full-screen view state needed. Express mode only, for now.
  const pipelineMode: PipelineMode = 'thorough'
  // Toast when the pipeline finishes — no view transition needed since
  // progress is inline in the canvas (Level 2 redesign).
  const prevPipelinePhaseRef = useRef(reasoningPipelineRunner.phase)
  useEffect(() => {
    const prev = prevPipelinePhaseRef.current
    prevPipelinePhaseRef.current = reasoningPipelineRunner.phase
    if (prev !== 'done' && reasoningPipelineRunner.phase === 'done') {
      dispatch({ type: 'SET_TOAST', value: 'Your house is ready — review and refine each layer' })
    }
  }, [reasoningPipelineRunner.phase])
  // <1024px: the side rails swap for a step strip + a co-pilot drawer. UI-only
  // state, so it lives here rather than in the reducer.
  const isMobile = useIsMobile()
  // Onboarding tour (September 2026 UX audit, item 1). Shown once per user on
  // their very first house. Local state tracks dismissal; the flag is persisted
  // server-side on dismiss.
  const [showTour, setShowTour] = useState(!hasSeenTour && !readOnly && !strawman)
  const dismissTour = useCallback(() => {
    setShowTour(false)
    // Fire-and-forget profile update — a failure just means the tour shows once
    // more next session, which is harmless.
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles').update({ has_seen_builder_tour: true }).eq('id', user.id)
      }
    })()
  }, [])
  const [railOpen, setRailOpen] = useState(false)
  const canvasRef = useRef<HTMLElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstSave = useRef(true)
  // Held in refs so fresh closures each render never reset the debounce.
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const stateRef = useRef(state)
  stateRef.current = state
  const savedKeyRef = useRef<string | null>(null)
  const lockedRef = useRef(lockedByOtherTab)
  lockedRef.current = lockedByOtherTab

  // ── Save controller ────────────────────────────────────────────────────────
  // idle-shaped machine: saved → dirty → saving → saved | failed(retry w/
  // backoff) | conflict(stop — reload) | signed-out(stop — re-auth). At most one
  // save in flight; edits during a save queue exactly one trailing save that
  // runs with the LATEST state, so two saves can never interleave their
  // delete/insert sequences (fe-C2).
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const inFlightRef = useRef<Promise<void> | null>(null)
  const pendingRef = useRef(false)
  const attemptRef = useRef(0)
  const blockedRef = useRef(false) // stale-write: stop saving until reload

  // Named function expression: the trailing-save recursion and the retry timer
  // resolve to the function itself, not the outer const (TDZ-safe under lint).
  const runSave = useCallback(function runSave() {
    if (blockedRef.current || lockedRef.current) return
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    setSaveStatus('saving')
    inFlightRef.current = (async () => {
      try {
        await onSaveRef.current(stateRef.current)
        savedKeyRef.current = serializeContent(stateRef.current)
        attemptRef.current = 0
        inFlightRef.current = null
        if (pendingRef.current) {
          pendingRef.current = false
          runSave()
        } else {
          setSaveStatus('saved')
        }
      } catch (err) {
        inFlightRef.current = null
        pendingRef.current = false
        const code = (err as { code?: string } | null)?.code
        if (code === 'stale-write') {
          blockedRef.current = true
          setSaveStatus('conflict')
          return
        }
        if (code === 'signed-out') {
          setSaveStatus('signed-out')
          return
        }
        // Transient: retry with backoff, never silently clear the state.
        setSaveStatus('failed')
        attemptRef.current += 1
        const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attemptRef.current - 1, 4))
        if (retryTimer.current) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(runSave, delay)
      }
    })()
  }, [])

  // Flush a pending edit immediately (hidden tab, unmount, sign-out).
  const flushIfDirty = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (savedKeyRef.current !== null && serializeContent(stateRef.current) !== savedKeyRef.current) {
      runSave()
    }
  }, [runSave])

  // Toast auto-dismiss after 2200ms; a new toast resets the timer (04 §13).
  useEffect(() => {
    if (!state.toast) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => dispatch({ type: 'SET_TOAST', value: '' }), 2200)
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [state.toast])

  // Debounced autosave. Keyed on the persistable content only (contentKey), so
  // ephemeral changes (step, toast, open perspective) never trigger a write. Skips
  // the first render after load — that state matches the DB already.
  const contentKey = useMemo(() => serializeContent(state), [state])
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false
      savedKeyRef.current = contentKey // loaded state already matches the DB
      return
    }
    if (blockedRef.current || lockedRef.current) return
    setSaveStatus((s) => (s === 'saving' ? s : 'dirty'))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(runSave, 800)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // contentKey is the intended dependency; state/onSave are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey])

  // Flush on hide/close — the debounce window plus in-flight seconds used to be
  // lost work on tab close or laptop sleep (fe-H1); and on unmount (route change).
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushIfDirty()
    }
    window.addEventListener('pagehide', flushIfDirty)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flushIfDirty)
      document.removeEventListener('visibilitychange', onHidden)
      flushIfDirty()
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [flushIfDirty])

  // Sign-out must flush FIRST — after signOut() the session is gone and RLS
  // rejects the write (the old order silently lost the last edit).
  const handleSignOut = useCallback(async () => {
    flushIfDirty()
    try {
      await inFlightRef.current
    } catch {
      // Exiting anyway — the failure already surfaced via saveStatus.
    }
    onSignOut()
  }, [flushIfDirty, onSignOut])

  // ── Undo (bounded content-snapshot history; frontend plan Phase 2 §3) ──────
  const historyRef = useRef<string[]>([])
  const [undoAvailable, setUndoAvailable] = useState(false)
  const undoChipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const undo = useCallback(() => {
    const snap = historyRef.current.pop()
    if (!snap) return
    dispatch({ type: 'RESTORE_CONTENT', content: JSON.parse(snap) as PersistedContent })
    setUndoAvailable(false)
  }, [])

  // Read-only is enforced at this ONE seam (bl-C2): every content-mutating
  // action is dropped with an honest toast, instead of trusting dozens of
  // controls to individually disable themselves. The old behavior let a student
  // "edit" a strawman (or a teacher a student's house) with working controls,
  // live toasts, and zero persistence — the illusion of saved work.
  const effReadOnlyRef = useRef(false)
  effReadOnlyRef.current = readOnly || lockedByOtherTab
  const readOnlyToastRef = useRef(
    strawman
      ? "Read-only · notes here aren't saved — bring your findings to class"
      : turnedIn
        ? 'Turned in · undo turn-in from your dashboard to edit'
        : "Read-only · changes here don't save"
  )
  const VIEW_ACTIONS = useRef(
    new Set<Action['type']>([
      'GO_STEP',
      'OPEN_PERSPECTIVE',
      'CLOSE_PERSPECTIVE',
      'SET_TOAST',
    ])
  )

  // Every destructive REMOVE_* snapshots the content first and offers Undo —
  // one slipped tap used to permanently destroy a subtree within 800ms (fe-M2).
  const guardedDispatch = useCallback((action: Action) => {
    if (effReadOnlyRef.current && !VIEW_ACTIONS.current.has(action.type)) {
      dispatch({ type: 'SET_TOAST', value: readOnlyToastRef.current })
      return
    }
    if (action.type.startsWith('REMOVE_')) {
      historyRef.current.push(serializeContent(stateRef.current))
      if (historyRef.current.length > UNDO_CAP) historyRef.current.shift()
      setUndoAvailable(true)
      if (undoChipTimer.current) clearTimeout(undoChipTimer.current)
      undoChipTimer.current = setTimeout(() => setUndoAvailable(false), UNDO_CHIP_MS)
    }
    dispatch(action)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const t = e.target as HTMLElement | null
      // Native undo owns text fields; ours covers structural removes.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (historyRef.current.length === 0) return
      e.preventDefault()
      undo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo])

  // Scrolling now belongs to Canvas: a step change scrolls that layer's section
  // into view in the stacked document (builder-workspace-redesign plan §1).

  // "Start with an AI draft" arrival: on mobile the rail starts open so the
  // draft card (which drives the flow) is visible immediately.
  useEffect(() => {
    if (draftEntry && canDraft && isMobile) setRailOpen(true)
  }, [draftEntry, canDraft, isMobile])

  const feedbackHouse = useMemo(
    () => (feedback === 'edit' ? (JSON.parse(contentKey) as Record<string, unknown>) : undefined),
    [feedback, contentKey]
  )

  // Status row copy (replaces the ContextBar eyebrow + strength pill): the live
  // save state, plus the draft gate's own count while AI-drafted layers await
  // their claim (decision 016 §2).
  const effReadOnly = readOnly || lockedByOtherTab
  const save = effReadOnly ? null : SAVE_STATUS_TEXT[saveStatus]
  const draftedCount = state.draft ? DRAFT_STAGES.filter((s) => state.draft!.drafted[s]).length : 0
  const unclaimedCount = unclaimedDraftStages(state.draft).length

  return (
    <div className="vh-shell" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--parchment)' }}>
      {/* Header (app bar + status row) */}
      <header style={{ flex: '0 0 auto' }}>
        <AppBar
          userEmail={userEmail}
          title={state.title}
          question={state.question}
          readOnly={effReadOnly}
          roster={roster}
          currentUserId={team?.currentUserId ?? null}
          onTitleChange={(v) => guardedDispatch({ type: 'SET_TITLE', value: v })}
          onSignOut={() => void handleSignOut()}
        />
        {(readOnly || strawman) && (
          <div
            className="mono bhp-readonly-banner"
            style={{
              flex: '0 0 auto',
              padding: '7px 24px',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: strawman ? 'var(--amber-text)' : 'var(--blueprint)',
              background: 'var(--parchment)',
              borderBottom: `1px dashed ${strawman ? 'var(--amber-hover)' : 'var(--blueprint)'}`,
            }}
          >
            {strawman
              ? readOnly
                ? "AI Strawman · find the weak links, then open Review to critique it — notes here aren't saved"
                : 'AI Strawman · students will attack this — review and revise it, then release it from the assignment page'
              : turnedIn
                ? 'Turned in · read-only — undo turn-in from your dashboard to keep editing'
                : viewerCollaborator
                  ? 'Read-only · you have viewer access to this house'
                  : "Read-only · you're viewing a student's house"}
          </div>
        )}
        {lockedByOtherTab && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 24px',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--amber-tint)',
              borderBottom: '1px solid var(--amber)',
            }}
          >
            This house is open in another tab — edits here won&apos;t save.
            <button
              type="button"
              onClick={takeOver}
              style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink)', background: 'var(--white)', border: '1px solid var(--ink)', borderRadius: 6, padding: '4px 11px', cursor: 'pointer' }}
            >
              Take over
            </button>
          </div>
        )}
        {saveStatus === 'conflict' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 24px',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--amber-tint)',
              borderBottom: '1px solid var(--amber)',
            }}
          >
            This house changed elsewhere. Reload to continue — saving is paused so the newer
            version isn&apos;t overwritten.
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink)', background: 'var(--white)', border: '1px solid var(--ink)', borderRadius: 6, padding: '4px 11px', cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        )}
        {/* Status row: layer nav + save state + draft gate count. One nav for
            every viewport (builder-workspace-redesign plan §2). Hidden during
            the pipeline takeover (PipelineFullView.tsx) — nothing here means
            anything yet on a house that hasn't been reasoned through, and
            navigating to a still-empty layer would be a dead click with the
            canvas unmounted. */}
        {!pipelineTakeover && (
          <div className="bhp-status-row" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 24px', background: 'var(--white)', borderBottom: '1px solid var(--rule)' }}>
            <LayerNav state={state} onGo={(n) => dispatch({ type: 'GO_STEP', n })} />
            <PipelineToggleButton runner={reasoningPipelineRunner} pipelineEntry={pipelineEntry} onOpen={() => setPipelineTakeover(true)} />
            <div
              className="mono bhp-status-meta"
              role={save?.alert ? 'status' : undefined}
              style={{ marginLeft: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap', fontSize: 10, letterSpacing: '0.06em', color: save?.alert ? 'var(--warning-text)' : 'var(--ink-subtle)' }}
            >
              {effReadOnly ? 'Read-only' : save?.text}
              {unclaimedCount > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span style={{ color: 'var(--amber-text)' }}>
                    {unclaimedCount} of {draftedCount} drafted {draftedCount === 1 ? 'layer' : 'layers'} unclaimed
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {!pipelineTakeover && houseId && feedback && (
          <SubmissionFeedback houseId={houseId} mode={feedback} house={feedbackHouse} />
        )}
      </header>

      {/* Founder Mode entry-point redesign: full takeover, no canvas/rail at
          all, while pipelineTakeover is true. */}
      {pipelineTakeover && canDraft ? (
        <PipelineFullView
          state={state}
          dispatch={guardedDispatch}
          runner={reasoningPipelineRunner}
          onGoToHouse={() => setPipelineTakeover(false)}
        />
      ) : (
      <>
      {/* Two-column row (desktop) / document only (mobile) */}
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <Canvas
          ref={canvasRef}
          state={state}
          strength={strength}
          dispatch={guardedDispatch}
          houseId={houseId}
          sectors={sectors}
          pipelineMode={pipelineMode}
          pipelineRunner={canDraft ? reasoningPipelineRunner : undefined}
        />
        {!isMobile && (
          <RightRail
            state={state}
            strength={strength}
            dispatch={guardedDispatch}
            draftCard={canDraft ? <DraftCard state={state} dispatch={dispatch} runner={draftRunner} /> : null}
            suggestCache={suggestCacheRef}
            interview={interview}
            pipelineRunner={canDraft ? reasoningPipelineRunner : undefined}
            team={team}
            roster={roster}
            restrictAuthorship={modeLocked}
            houseId={houseId}
          />
        )}
      </div>

      {/* Mobile co-pilot: always-visible toggle + slide-over drawer. */}
      {isMobile && !railOpen && (
        <button
          type="button"
          className="bhp-mobile-copilot"
          onClick={() => setRailOpen(true)}
          aria-label="Open co-pilot"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            zIndex: 45,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 48,
            padding: '0 18px',
            background: 'var(--ink)',
            color: 'var(--parchment)',
            borderRadius: 999,
            fontWeight: 600,
            fontSize: 14,
            boxShadow: '0 12px 32px rgba(20,33,58,0.3)',
          }}
        >
          <SparkIcon size={15} fill="var(--amber)" />
          Co-pilot
        </button>
      )}
      {isMobile && railOpen && (
        <MobileRailDrawer
          state={state}
          strength={strength}
          dispatch={guardedDispatch}
          draftCard={canDraft ? <DraftCard state={state} dispatch={dispatch} runner={draftRunner} /> : null}
          suggestCache={suggestCacheRef}
          interview={interview}
          pipelineRunner={canDraft ? reasoningPipelineRunner : undefined}
          team={team}
          roster={roster}
          onClose={() => setRailOpen(false)}
          restrictAuthorship={modeLocked}
          houseId={houseId}
        />
      )}
      </>
      )}

      {/* Undo chip: appears beside the toast after a destructive remove. */}
      {undoAvailable && (
        <button
          type="button"
          onClick={undo}
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(64px + env(safe-area-inset-bottom))',
            zIndex: 60,
            fontWeight: 600,
            fontSize: 12,
            color: 'var(--parchment)',
            background: 'var(--ink)',
            border: 'none',
            borderRadius: 999,
            padding: '7px 16px',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(20,33,58,0.28)',
          }}
        >
          Undo remove (⌘Z)
        </button>
      )}

      {/* Onboarding tour (September 2026 UX audit, item 1). */}
      {showTour && <OnboardingTour onDismiss={dismissTour} />}

      <Toast message={state.toast} />
    </div>
  )
}
