'use client'

// Pre-login footer for the dusk-constellation redesign. A sibling of, not an
// edit to, components/sections/Footer.tsx — that original keeps serving the
// post-login app (dashboard, classroom, classes, profile) and the For
// Educators route unchanged.

import Link from 'next/link'
import { LogoMark } from '@/components/icons'
import { MARKETING_FOOTER_GROUPS } from '@/lib/site'

const colHeadStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--dusk-ink-subtle)',
  marginBottom: 14,
}

const linkStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  color: 'var(--dusk-ink-mid)',
}

export default function MarketingFooter() {
  return (
    <footer style={{ borderTop: '1px solid var(--dusk-rule)', paddingBlock: 'var(--section-py)' }}>
      <div className="container">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 40 }}>
          <div style={{ flex: '1 1 280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LogoMark stroke="#F4F5FB" />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.01em', color: 'var(--dusk-ink)' }}>
                Houses of Thought
              </span>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.6, color: 'var(--dusk-ink-subtle)', maxWidth: '34ch', marginTop: 14 }}>
              Free, structured reasoning built on a real classroom framework, and free for good, not just for now.
            </p>
          </div>

          <div className="mk-footer-links" style={{ display: 'flex', flexWrap: 'wrap', gap: 48 }}>
            {MARKETING_FOOTER_GROUPS.map((g) => (
              <div key={g.heading}>
                <p style={colHeadStyle}>{g.heading}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {g.links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      style={linkStyle}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--dusk-ink-mid)')}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: 48,
            paddingTop: 22,
            borderTop: '1px solid var(--dusk-rule)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 12,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--dusk-ink-subtle)',
          }}
        >
          <span>Free, always</span>
          <span>© 2026 Houses of Thought</span>
        </div>
      </div>
    </footer>
  )
}
