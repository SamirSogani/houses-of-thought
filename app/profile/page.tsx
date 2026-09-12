'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { ProfileForm } from '@/components/profile/ProfileForm'
import Footer from '@/components/sections/Footer'
import { rowToProfile, type ProfileData, type ProfileRow } from '@/lib/profile/data'
import { capabilitiesFor } from '@/lib/auth/capabilities'

// Columns selected for the form — keep in sync with ProfileRow.
const PROFILE_COLUMNS =
  'username, account_type, workspace_mode, about_me, current_project, role, location, perspectives'

export default function ProfilePage() {
  const router = useRouter()
  const [initial, setInitial] = useState<ProfileData | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Route protection is handled by proxy.ts; here we only load the profile.
  useEffect(() => {
    const supabase = createClient()
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active || !user) return

      const { data: row } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', user.id)
        .maybeSingle()
      if (!active) return

      const profile = rowToProfile(row as ProfileRow | null)
      // Seed the username from the email local-part only when the DB value is null.
      if (!profile.username) {
        const local = user.email?.split('@')[0]
        if (local) profile.username = local
      }
      setUserId(user.id)
      setInitial(profile)
    })()
    return () => {
      active = false
    }
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (initial === null || userId === null) {
    return (
      <main
        id="main"
        className="acct-vh-min"
        style={{
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
        Loading your profile…
      </main>
    )
  }

  return (
    <div className="acct-vh-min" style={{ display: 'flex', flexDirection: 'column', background: 'var(--parchment)' }}>
      <DashboardHeader
        onSignOut={handleSignOut}
        active="profile"
        showClassroom={initial.accountType === 'teacher' || initial.accountType === 'student'}
        classroomHref={capabilitiesFor(initial.accountType).canCreateClasses ? '/classroom' : '/classes'}
        showProjects={initial.workspaceMode === 'business'}
      />

      <main style={{ flex: '1 1 auto' }}>
        <div className="container" style={{ paddingBlock: 'clamp(28px, 4vw, 48px)', maxWidth: 900 }}>
          <ProfileForm initial={initial} userId={userId} />
        </div>
      </main>

      <Footer />
    </div>
  )
}
