'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthCard, AuthDivider, AuthError, AuthField, authButtonStyle } from '@/components/auth/AuthCard'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  // /auth/callback bounces expired/used links back here with ?error=link_invalid.
  // Read once from window to avoid needing a Suspense boundary for useSearchParams.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error') === 'link_invalid') {
      setError('That reset link was invalid or had expired. Request a new one below.')
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    // The emailed link bounces through /auth/callback, which mints a short-lived
    // recovery session and forwards to /reset-password to set a new password.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })

    setLoading(false)
    // Show the same confirmation whether or not the address has an account, so
    // this page can't be used to probe which emails are registered.
    if (error && error.status !== 429) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <AuthCard
      eyebrow={sent ? 'Check your inbox' : 'Reset password'}
      heading={sent ? 'Check your\nemail.' : 'Forgot your\npassword?'}
    >
      {sent ? (
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            lineHeight: 1.55,
            color: 'var(--ink-subtle)',
          }}
        >
          If an account exists for <strong style={{ color: 'var(--ink)' }}>{email}</strong>, we&rsquo;ve
          sent a link to reset your password. The link expires in one hour.
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              lineHeight: 1.55,
              color: 'var(--ink-subtle)',
              marginBottom: 4,
            }}
          >
            Enter the email on your account and we&rsquo;ll send you a link to set a new password.
          </p>

          <AuthField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
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
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <AuthDivider />

      {/* Back to login */}
      <p
        style={{
          textAlign: 'center',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--ink-subtle)',
        }}
      >
        Remembered it?{' '}
        <Link
          href="/login"
          style={{
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 14,
            color: 'var(--ink)',
            borderBottom: '1px solid var(--ink)',
            paddingBottom: 1,
          }}
        >
          Back to log in
        </Link>
      </p>
    </AuthCard>
  )
}
