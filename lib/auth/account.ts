// Server-side loader for the caller's account type + capabilities. This is the
// AUTHORITATIVE gate: client-side hiding is cosmetic, this is what actually
// decides what a request may do. Mirrors the server-only pattern in lib/ai/limits.ts.
//
// Anonymous callers (the open /house front door, decision 001 §6) resolve to
// 'standard' — they keep full AI posture; the student clamp only applies to a
// signed-in student profile.

import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/log'
import type { AccountType, WorkspaceMode } from '@/lib/profile/data'
import { capabilitiesFor, type Capabilities } from './capabilities'

if (typeof window !== 'undefined') {
  throw new Error('lib/auth/account.ts is server-only and must not run in the browser')
}

export async function getCallerAccountType(): Promise<AccountType> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return 'standard' // anonymous keeps full posture by design (007)
    const { data, error } = await supabase
      .from('profiles')
      .select('account_type')
      .eq('id', user.id)
      .single()
    if (error || !data?.account_type) {
      // Fail CLOSED for signed-in callers: 'standard' is MORE permissive than
      // 'student' (Decide mode, Draft Mode), so a transient profile-read hiccup
      // must not un-pin a student (bl-M5; capabilities.ts's own contract says a
      // bad DB row can never widen access).
      log.error('auth/account', 'profile lookup failed — failing closed to student posture', {
        error: error?.message ?? 'no row',
      })
      return 'student'
    }
    return data.account_type as AccountType
  } catch {
    // Auth itself unreachable: cannot distinguish signed-in from anonymous, and
    // clamping every anonymous /house visitor would break that surface — keep
    // the anonymous default here.
    return 'standard'
  }
}

export async function getCallerCapabilities(): Promise<Capabilities> {
  return capabilitiesFor(await getCallerAccountType())
}

// Business mode (decision 021 §2, plans/active/business-mode/02-business-
// prompts.md): read ONCE per request from the authenticated caller's own
// profile — never trust a client-supplied workspace_mode for anything that
// changes model behavior. Unlike getCallerAccountType, there is no
// privileged/unprivileged direction to fail closed toward (workspace_mode
// gates AI framing only, never access — decision 021 §2), so any failure
// (anonymous caller, missing profile, lookup error) falls back to 'general',
// the DB column's own default and the least-surprising choice either way.
export async function getCallerWorkspaceMode(): Promise<WorkspaceMode> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return 'general'
    const { data, error } = await supabase
      .from('profiles')
      .select('workspace_mode')
      .eq('id', user.id)
      .single()
    if (error || !data?.workspace_mode) return 'general'
    return data.workspace_mode as WorkspaceMode
  } catch {
    return 'general'
  }
}
