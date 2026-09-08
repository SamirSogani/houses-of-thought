'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthCard, AuthError, AuthField, authButtonStyle } from '@/components/auth/AuthCard'

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // /auth/callback has already exchanged the emailed link for a recovery session
  // by the time we land here. If there's no session, the link was missing,
  // expired, or opened in a different browser than it was requested from.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setPhase(data.user ? 'ready' : 'invalid')
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }
    setPhase('done')
  }

  return (
    <AuthCard
      eyebrow={phase === 'done' ? 'All set' : 'Choose a new password'}
      heading={phase === 'done' ? 'Password\nupdated.' : 'Set a new\npassword.'}
    >
      {phase === 'checking' && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--ink-subtle)' }}>
          Verifying your link…
        </p>
      )}

      {phase === 'invalid' && (
        <>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              lineHeight: 1.55,
              color: 'var(--ink-subtle)',
              marginBottom: 20,
            }}
          >
            This reset link is invalid or has expired. Reset links last one hour and can only be used
            once. Request a fresh one to continue.
          </p>
          <Link
            href="/forgot-password"
            style={{ ...authButtonStyle, width: '100%' }}
          >
            Request a new link
          </Link>
        </>
      )}

      {phase === 'done' && (
        <>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              lineHeight: 1.55,
              color: 'var(--ink-subtle)',
              marginBottom: 20,
            }}
          >
            Your password has been changed. You&rsquo;re signed in and ready to go.
          </p>
          <button
            onClick={() => {
              router.push('/dashboard')
              router.refresh()
            }}
            style={{ ...authButtonStyle, width: '100%' }}
          >
            Go to dashboard
          </button>
        </>
      )}

      {phase === 'ready' && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AuthField
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={setPassword}
            placeholder="Min. 8 characters"
          />

          <AuthField
            id="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={setConfirm}
            placeholder="Re-enter password"
          />

          {error && <AuthError>{error}</AuthError>}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...authButtonStyle,
              width: '100%',
              marginTop: 8,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}
