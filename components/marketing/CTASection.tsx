// CTA band — solid black full-bleed section with white text and buttons.
// Props interface preserved so callers don't need to change.

import Link from 'next/link'

export default function MarketingCTASection({
  eyebrow,
  heading,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
  note,
}: {
  eyebrow: string
  heading: string
  primaryLabel: string
  primaryHref: string
  secondaryLabel: string
  secondaryHref: string
  note: string
}) {
  return (
    <section style={{ background: '#000', color: '#fff', padding: '80px 24px', textAlign: 'center' }}>
      <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: 2.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', margin: '0 0 16px' }}>
        {eyebrow}
      </p>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 36, lineHeight: 1.2, margin: 0 }}>
        {heading}
      </h2>
      <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', margin: '14px 0 0' }}>{note}</p>
      <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
        <Link
          href={primaryHref}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 48,
            padding: '0 28px',
            background: '#fff',
            color: '#000',
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          {primaryLabel}
        </Link>
        <Link
          href={secondaryHref}
          style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}
        >
          {secondaryLabel}
        </Link>
      </div>
    </section>
  )
}
