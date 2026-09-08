import type { ReactNode } from 'react'
import MarketingHeader from '@/components/marketing/Header'

// Shared scaffold for the auth pages (login, forgot-password, reset-password):
// the site header, the centered white stage, the eyebrow + display heading,
// and a bordered card that holds the form. Login/signup is a genuinely
// pre-login surface, so this uses the shared marketing header — but the form
// CARD itself stays on the light --white/--ink tokens the form fields and
// AccountTypeSelector already assume (AccountTypeSelector is also rendered,
// read-only, on the post-login Profile page — it isn't safe to recolor).
// `children` render inside the card; `belowCard` renders beneath it.
export function AuthCard({
  eyebrow,
  heading,
  children,
  belowCard,
}: {
  eyebrow: string
  heading: string
  children: ReactNode
  belowCard?: ReactNode
}) {
  return (
    <div style={{ background: '#fff', color: '#000', minHeight: '100vh' }}>
      <MarketingHeader variant="subpage" />

      {/* acct-vh-header = dvh-safe `calc(100vh - 73px)` (account-responsive.css). */}
      <main
        className="acct-vh-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'clamp(32px, 6vw, 80px) var(--px)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Eyebrow */}
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)', marginBottom: 20 }}>
            {eyebrow}
          </p>

          {/* Heading */}
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 'clamp(32px, 5vw, 44px)',
              lineHeight: 1.08,
              letterSpacing: '-0.015em',
              color: '#000',
              marginBottom: 32,
            }}
          >
            {heading}
          </h1>

          {/* Card */}
          <div style={{ padding: 'clamp(24px, 4vw, 36px)', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--radius-card)' }}>
            {children}
          </div>

          {belowCard}
        </div>
      </main>
    </div>
  )
}

// Shared black-pill / outlined button styles for the auth pages, replacing
// the sitewide .btn-primary/.btn-secondary (amber) classes — those stay
// amber for post-login pages, so auth's own buttons are styled locally.
export const authButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 48,
  padding: '0 20px',
  background: '#000',
  color: '#fff',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  fontSize: 15,
  borderRadius: 8,
}

export const authButtonSecondaryStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 48,
  padding: '0 20px',
  border: '1px solid rgba(0,0,0,0.15)',
  background: 'transparent',
  color: '#000',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  fontSize: 15,
  borderRadius: 8,
}

export const authInputStyle: React.CSSProperties = {
  height: 48,
  padding: '0 14px',
  fontFamily: 'var(--font-body)',
  fontSize: 16,
  color: 'var(--ink)',
  background: 'var(--parchment)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  outline: 'none',
  transition: 'border-color 0.15s',
}

const authLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-subtle)',
}

// A labelled text input matching the auth card's field styling. Focus/blur nudge
// the border colour imperatively (same behaviour as the original inline fields).
export function AuthField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  minLength,
}: {
  id: string
  label: string
  type: 'email' | 'password' | 'text'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  required?: boolean
  minLength?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={authLabelStyle}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={authInputStyle}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--ink)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--rule)')}
      />
    </div>
  )
}

// The "— or —" rule between the form and the mode-switch line.
export function AuthDivider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--ink-subtle)',
          textTransform: 'uppercase',
        }}
      >
        or
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
    </div>
  )
}

export function AuthError({ children }: { children: ReactNode }) {
  // role="alert" so a failed sign-in is announced rather than appearing
  // silently for screen-reader users (a11y S2).
  return (
    <p role="alert" style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--warning-text)' }}>
      {children}
    </p>
  )
}
