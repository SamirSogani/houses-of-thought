// Pre-login footer for the redesign. Minimal single-line layout.

import Link from 'next/link'

export default function MarketingFooter() {
  return (
    <footer
      style={{
        padding: '20px 24px',
        maxWidth: 1024,
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid rgba(0,0,0,0.08)',
      }}
    >
      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>© 2026 Houses of Thought</span>
      <div style={{ display: 'flex', gap: 20 }}>
        <Link href="/privacy" style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textDecoration: 'none' }}>
          Privacy
        </Link>
        <Link href="/terms" style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textDecoration: 'none' }}>
          Terms
        </Link>
        <Link href="/contact" style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textDecoration: 'none' }}>
          Contact
        </Link>
      </div>
    </footer>
  )
}
