'use client'

// Pre-login header for the dusk-constellation redesign. A sibling of, not an
// edit to, components/Header.tsx — that original keeps serving the pages this
// redesign doesn't touch (the post-login app, and the For Educators route,
// which is byte-for-byte unchanged per the redesign brief's hard constraints).

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoMark } from '@/components/icons'
import { useFocusTrap } from '@/components/useFocusTrap'
import { MARKETING_NAV_LINKS } from '@/lib/site'

export default function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const sheetRef = useFocusTrap<HTMLDivElement>(mobileOpen)
  const pathname = usePathname()

  useEffect(() => {
    const header = document.getElementById('mk-header')
    if (!header) return
    const onScroll = () => {
      const past = window.scrollY > 24
      header.style.paddingBlock = past ? '11px' : '18px'
      header.style.borderBottom = past ? '1px solid var(--dusk-rule)' : '1px solid transparent'
      header.style.background = past ? 'rgba(6,8,20,0.86)' : 'rgba(6,8,20,0.5)'
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
        data-surface="ink"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          paddingBlock: 18,
          borderBottom: '1px solid transparent',
          transition: 'padding-block 0.24s ease, border-bottom 0.24s ease, background 0.24s ease',
        }}
      >
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LogoMark stroke="#F4F5FB" />
            <span
              className="mk-header-brand-text"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.01em', color: 'var(--dusk-ink)' }}
            >
              Houses of Thought
            </span>
          </Link>

          <nav className="dusk-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 28, marginLeft: 'auto' }}>
            {MARKETING_NAV_LINKS.map((l) => {
              const active = pathname === l.href
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 500,
                    fontSize: 15,
                    color: active ? 'var(--dusk-ink)' : 'var(--dusk-ink-subtle)',
                    borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
                    paddingBottom: 4,
                  }}
                >
                  {l.label}
                </Link>
              )
            })}
            {/* Matches the nav links' reserved underline space (2px border +
                4px padding) so its text sits on their baseline — without it,
                align-items:center drops "Log in" 3px below the row. */}
            <Link
              href="/login"
              style={{
                fontFamily: 'var(--font-body)',
                fontWeight: 500,
                fontSize: 15,
                color: 'var(--dusk-ink-subtle)',
                borderBottom: '2px solid transparent',
                paddingBottom: 4,
              }}
            >
              Log in
            </Link>
            <Link
              href="/try"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 44,
                padding: '0 20px',
                background: 'var(--amber)',
                color: 'var(--ink)',
                fontWeight: 600,
                fontSize: 15,
                borderRadius: 8,
              }}
            >
              Try it instantly
            </Link>
          </nav>

          {/* Mobile controls */}
          <div className="mk-mobile-controls" style={{ display: 'none', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <Link
              href="/try"
              style={{ display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 16px', background: 'var(--amber)', color: 'var(--ink)', fontWeight: 600, fontSize: 14, borderRadius: 8 }}
            >
              Try it instantly
            </Link>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
              className="tap-target"
              style={{ width: 42, height: 42, border: '1px solid var(--dusk-rule)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <line x1="2" y1="5" x2="16" y2="5" stroke="var(--dusk-ink)" strokeWidth="1.6" />
                <line x1="2" y1="13" x2="16" y2="13" stroke="var(--dusk-ink)" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <style>{`
        @media (max-width: 1023px) {
          #mk-header .dusk-nav-links { display: none !important; }
          #mk-header .mk-mobile-controls { display: flex !important; }
        }
      `}</style>

      {mobileOpen && (
        <div ref={sheetRef} className="dusk-page" role="dialog" aria-modal="true" aria-label="Menu" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', padding: '18px var(--px) 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--dusk-ink-subtle)' }}>Menu</span>
            <button
              onClick={closeMobile}
              aria-label="Close menu"
              className="tap-target"
              style={{ width: 42, height: 42, border: '1px solid var(--dusk-rule)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dusk-ink)' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 3l10 10M13 3l-10 10" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 40 }}>
            {MARKETING_NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={closeMobile} style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 34, color: 'var(--dusk-ink)', padding: '10px 0' }}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Link href="/try" onClick={closeMobile} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52, background: 'var(--amber)', color: 'var(--ink)', fontWeight: 600, fontSize: 16, borderRadius: 8 }}>
              Try it instantly
            </Link>
            <Link href="/login" onClick={closeMobile} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52, border: '1px solid var(--dusk-rule)', color: 'var(--dusk-ink)', fontWeight: 600, fontSize: 16, borderRadius: 8 }}>
              Log in
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--dusk-ink-subtle)' }}>
              <Link href="/story" onClick={closeMobile}>Our story</Link>
              <Link href="/contact" onClick={closeMobile}>Contact</Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
