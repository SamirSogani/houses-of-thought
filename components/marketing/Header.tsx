'use client'

// Shared pre-login header. White bg, sticky. Two variants:
//   - 'homepage' (default) — anchor nav into the single-scroll homepage.
//   - 'subpage'  — real page links (lib/site.ts's MARKETING_NAV_LINKS), with
//                  the current page underlined, for every other pre-login page.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFocusTrap } from '@/components/useFocusTrap'
import { MARKETING_NAV_LINKS } from '@/lib/site'

const HOME_NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#examples', label: 'Examples' },
  { href: '#educators', label: 'Educators' },
]

function HouseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10L10 3L17 10" />
      <path d="M5 9V17H15V9" />
    </svg>
  )
}

export default function MarketingHeader({ variant = 'homepage' }: { variant?: 'homepage' | 'subpage' }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const sheetRef = useFocusTrap<HTMLDivElement>(mobileOpen)
  const pathname = usePathname()
  const navLinks = variant === 'subpage' ? MARKETING_NAV_LINKS : HOME_NAV_LINKS

  useEffect(() => {
    const header = document.getElementById('mk-header')
    if (!header) return
    const onScroll = () => {
      const past = window.scrollY > 24
      header.style.borderBottom = past ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent'
      header.style.background = past ? 'rgba(255,255,255,0.92)' : 'var(--hp-bg, #fff)'
      header.style.backdropFilter = past ? 'blur(14px)' : 'none'
      header.style.setProperty('-webkit-backdrop-filter', past ? 'blur(14px)' : 'none')
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    if (mobileOpen) window.addEventListener('keydown', onEsc)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onEsc)
    }
  }, [mobileOpen])

  const closeMobile = () => setMobileOpen(false)

  return (
    <>
      <header
        id="mk-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--hp-bg, #fff)',
          borderBottom: '1px solid transparent',
          transition: 'border-bottom 0.24s ease, background 0.24s ease',
        }}
      >
        <div
          style={{
            maxWidth: 1024,
            margin: '0 auto',
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}
        >
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HouseIcon />
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.03em', color: '#000' }}>
              Houses of Thought
            </span>
          </Link>

          <nav className="mk-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 28, marginLeft: 'auto' }}>
            {navLinks.map((l) => {
              const active = variant === 'subpage' && pathname === l.href
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    color: active ? '#000' : 'rgba(0,0,0,0.5)',
                    borderBottom: active ? '1px solid #000' : '1px solid transparent',
                    paddingBottom: 3,
                  }}
                >
                  {l.label}
                </Link>
              )
            })}
            <Link
              href="/login"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 36,
                padding: '0 16px',
                background: '#000',
                color: '#fff',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Sign in
            </Link>
          </nav>

          {/* Mobile controls */}
          <div className="mk-mobile-controls" style={{ display: 'none', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
              style={{ width: 40, height: 40, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <line x1="2" y1="5" x2="16" y2="5" stroke="#000" strokeWidth="1.6" />
                <line x1="2" y1="13" x2="16" y2="13" stroke="#000" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <style>{`
        @media (max-width: 768px) {
          #mk-header .mk-nav-links { display: none !important; }
          #mk-header .mk-mobile-controls { display: flex !important; }
        }
      `}</style>

      {mobileOpen && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 24px 32px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Link href="/" onClick={closeMobile} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HouseIcon />
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.03em', color: '#000' }}>
                Houses of Thought
              </span>
            </Link>
            <button
              onClick={closeMobile}
              aria-label="Close menu"
              style={{ width: 40, height: 40, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 3l10 10M13 3l-10 10" stroke="#000" strokeWidth="1.6" />
              </svg>
            </button>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 40 }}>
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={closeMobile}
                style={{ fontSize: 28, fontWeight: 500, color: '#000', padding: '10px 0' }}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div style={{ marginTop: 'auto' }}>
            <Link
              href="/login"
              onClick={closeMobile}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 48,
                background: '#000',
                color: '#fff',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
