'use client'

// Shared scaffold for authenticated client pages (frontend plan Phase 2 §1).
// Every authed page used to hand-copy the same preamble — getUser → profiles →
// capabilitiesFor → redirect — plus its own handleSignOut and centerNotice
// literal, and one page forgetting the clamp is a policy bug. This hook is the
// single home for that dance; migrate pages onto it as they're touched.
//
// Route protection stays proxy.ts's job — this hook only resolves WHO the
// user is and what their account type allows, for rendering decisions.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { capabilitiesFor, type Capabilities } from '@/lib/auth/capabilities'
import type { AccountType, WorkspaceMode } from '@/lib/profile/data'

export interface AuthedPage {
  // null while loading; the proxy guarantees a user on protected routes, so a
  // persistent null means the session died — pages may redirect on `resolved`.
  user: User | null
  accountType: AccountType
  // Business/solo-founder mode (decision 021) — UI framing only, never a
  // capability; see lib/auth/capabilities.ts, which this must never join.
  workspaceMode: WorkspaceMode
  caps: Capabilities
  resolved: boolean
  signOut: () => Promise<void>
}

export function useAuthedPage(): AuthedPage {
  const [user, setUser] = useState<User | null>(null)
  const [accountType, setAccountType] = useState<AccountType>('standard')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('general')
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      if (!user) {
        setResolved(true)
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_type, workspace_mode')
        .eq('id', user.id)
        .single()
      if (!active) return
      setUser(user)
      setAccountType((profile?.account_type as AccountType) ?? 'standard')
      setWorkspaceMode((profile?.workspace_mode as WorkspaceMode) ?? 'general')
      setResolved(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const signOut = useSignOut()

  return { user, accountType, workspaceMode, caps: capabilitiesFor(accountType), resolved, signOut }
}

// Standalone sign-out for pages with bespoke load flows (e.g. the build route's
// combined fetch) that shouldn't pay useAuthedPage's profile query — this alone
// replaces the handleSignOut copied into 9 files.
export function useSignOut(): () => Promise<void> {
  const router = useRouter()
  return useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }, [router])
}

// The full-screen mono loading/notice frame every page re-typed as a style
// literal (7 copies). Height via the dvh-safe .acct-vh-min class.
export function CenterNotice({ children }: { children: React.ReactNode }) {
  return (
    <main
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
      {children}
    </main>
  )
}
