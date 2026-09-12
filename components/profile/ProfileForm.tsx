'use client'

// The Profile form. Holds all edits in local state (no backend yet). A debounced
// "saved" indicator reflects the auto-save affordance from the reference.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  autosaveRow,
  perspectiveFields,
  usernameError,
  type PerspectiveKey,
  type ProfileData,
} from '@/lib/profile/data'
import { SectionCard, FieldLabel, TextInput, TextArea } from './primitives'
import { AccountTypeSelector } from './AccountTypeSelector'
import { WorkspaceModeToggle } from './WorkspaceModeToggle'

type SaveState = 'saved' | 'saving' | 'error'

const twoCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 16,
}

export function ProfileForm({ initial, userId }: { initial: ProfileData; userId: string }) {
  const [profile, setProfile] = useState<ProfileData>(initial)
  const [save, setSave] = useState<SaveState>('saved')
  // The specific username the DB rejected as taken (23505); autosaveRow excludes
  // it so every OTHER field keeps saving while the inline error stands.
  const [taken, setTaken] = useState<string | null>(null)
  const takenRef = useRef<string | null>(null)
  takenRef.current = taken
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstRender = useRef(true)
  // Latest form state + the last row we know is persisted — used to flush a
  // pending change if the form unmounts before the debounce fires (below).
  const latestRef = useRef(initial)
  const savedRef = useRef(JSON.stringify(autosaveRow(initial, null)))
  latestRef.current = profile

  const nameError = usernameError(profile.username)

  // Debounced auto-save to public.profiles. Skips the first render (the loaded
  // state). An invalid or known-taken username is simply EXCLUDED from the
  // payload (autosaveRow) instead of blocking the whole save — a seeded-invalid
  // username used to freeze every field while showing "All changes saved"
  // (bl-H3). account_type is never in this payload — it's immutable post-signup.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setSave('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const supabase = createClient()
      const row = autosaveRow(profile, takenRef.current)
      const { error } = await supabase.from('profiles').update(row).eq('id', userId)
      if (error?.code === '23505') {
        // unique_violation: the username is taken — the WHOLE row was rejected,
        // so this is an error state, not "saved". Remember the rejected name;
        // the next save excludes it and the other fields go through.
        setTaken(profile.username)
        setSave('error')
      } else if (error) {
        // Surface real failures instead of a false "All changes saved" — this is
        // what hid the missing-GRANT 403 during testing.
        setSave('error')
      } else {
        if ('username' in row) setTaken(null)
        savedRef.current = JSON.stringify(row)
        setSave('saved')
      }
    }, 650)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [profile, userId])

  // Flush a still-pending change when the form unmounts (e.g. navigating away
  // inside the 650ms debounce window), so an edit isn't silently dropped.
  useEffect(() => {
    return () => {
      const row = autosaveRow(latestRef.current, takenRef.current)
      if (JSON.stringify(row) === savedRef.current) return
      // Best-effort final write; the component is unmounting so ignore the result.
      // A Supabase query builder is a lazy thenable — the request only fires when
      // it's awaited/.then()'d, so `void builder` never sent anything (audit B3).
      createClient().from('profiles').update(row).eq('id', userId).then(() => {})
    }
  }, [userId])

  const set = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) =>
    setProfile((p) => ({ ...p, [key]: value }))

  // account_type is chosen once at signup and pinned by RLS (migration 0026):
  // there is no self-service role change, so the profile just displays it.
  const setPerspective = (key: PerspectiveKey, value: string) =>
    setProfile((p) => ({ ...p, perspectives: { ...p.perspectives, [key]: value } }))

  return (
    <>
      {/* Breadcrumb + heading */}
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Link href="/dashboard" style={{ color: 'var(--ink-subtle)' }} onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-subtle)')}>
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <span style={{ color: 'var(--ink)' }}>Profile</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(30px, 4vw, 40px)', letterSpacing: '-0.015em', color: 'var(--ink)' }}>
            Your Profile
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--ink-mid)', marginTop: 8 }}>
            Personal information and foundational perspective. Changes save automatically.
          </p>
        </div>
        <SaveIndicator state={save} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 'clamp(20px, 3vw, 32px)' }}>
        {/* Username */}
        <SectionCard>
          <FieldLabel label="Username" helper="How teachers and classmates see you in classrooms. 3-30 characters: letters, numbers, underscore, dot, or dash." />
          <TextInput value={profile.username} onChange={(v) => set('username', v)} ariaLabel="Username" invalid={!!nameError || profile.username === taken} />
          {nameError && <p style={{ fontSize: 12, color: 'var(--warning-text)', marginTop: 7 }}>{nameError}</p>}
          {!nameError && profile.username === taken && (
            <p style={{ fontSize: 12, color: 'var(--warning-text)', marginTop: 7 }}>
              That username is taken — your other changes still save.
            </p>
          )}
        </SectionCard>

        {/* Account Type — set at signup, not editable here (migration 0026). */}
        <SectionCard>
          <FieldLabel label="Account Type" helper="Set when you created your account. To change it, contact us through the contact page." />
          <AccountTypeSelector value={profile.accountType} />
        </SectionCard>

        {/* Workspace Mode — self-editable (decision 021), unlike Account Type above. */}
        <SectionCard>
          <FieldLabel
            label="Workspace Mode"
            helper="Business mode adds a Projects section for grouping your houses. You can switch back at any time — nothing is deleted."
          />
          <WorkspaceModeToggle value={profile.workspaceMode} onChange={(v) => set('workspaceMode', v)} />
        </SectionCard>

        {/* About / Current Project */}
        <div className="acct-card-grid" style={twoCol}>
          <SectionCard>
            <FieldLabel label="About Me" />
            <TextArea value={profile.aboutMe} onChange={(v) => set('aboutMe', v)} placeholder="Tell us about yourself..." ariaLabel="About me" />
          </SectionCard>
          <SectionCard>
            <FieldLabel label="Current Project" />
            <TextInput value={profile.currentProject} onChange={(v) => set('currentProject', v)} placeholder="What are you working on?" ariaLabel="Current project" />
          </SectionCard>
        </div>

        {/* Role / Location */}
        <div className="acct-card-grid" style={twoCol}>
          <SectionCard>
            <FieldLabel label="Role" />
            <TextInput value={profile.role} onChange={(v) => set('role', v)} placeholder="Student, Researcher, Analyst..." ariaLabel="Role" />
          </SectionCard>
          <SectionCard>
            <FieldLabel label="Location / Context" />
            <TextInput value={profile.location} onChange={(v) => set('location', v)} placeholder="San Francisco, CA" ariaLabel="Location or context" />
          </SectionCard>
        </div>

        {/* Personal Foundational Point of View */}
        <div style={{ marginTop: 8 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(22px, 3vw, 28px)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
            Personal Foundational Point of View
          </h2>
          <p className="mono" style={{ fontSize: 10, color: 'var(--amber-text)', marginTop: 8 }}>
            These perspectives persist across all your houses.
          </p>
        </div>
        <div className="acct-card-grid" style={twoCol}>
          {perspectiveFields.map((f) => (
            <SectionCard key={f.key} accent="var(--amber)">
              <FieldLabel label={f.name} helper={f.desc} />
              <TextArea value={profile.perspectives[f.key]} onChange={(v) => setPerspective(f.key, v)} placeholder={f.placeholder} ariaLabel={`${f.name} perspective`} />
            </SectionCard>
          ))}
        </div>

        {/* Danger Zone */}
        <SectionCard accent="var(--warning)">
          <FieldLabel label="Danger Zone" helper="Account deletion" color="var(--warning)" />
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-mid)' }}>
            Self-service account deletion is not yet available. To request deletion of your account and associated data, visit our{' '}
            <Link href="/contact" style={{ color: 'var(--warning)', textDecoration: 'underline' }}>contact page</Link>.
          </p>
        </SectionCard>
      </div>
    </>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const color = state === 'error' ? 'var(--warning-text)' : state === 'saved' ? 'var(--green-text)' : 'var(--amber)'
  const label = state === 'error' ? "Couldn't save — try again" : state === 'saved' ? 'All changes saved' : 'Saving…'
  return (
    // role="status" — a failed autosave was previously invisible to screen
    // readers, which is the one state the user must not miss (a11y S2).
    <span
      role="status"
      className="mono"
      style={{ fontSize: 10, color: state === 'error' ? 'var(--warning-text)' : 'var(--ink-subtle)', display: 'inline-flex', alignItems: 'center', gap: 7 }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}
