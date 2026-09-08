// Dusk-styled CTA band — a sibling of components/sections/CTASection.tsx,
// which keeps serving the For Educators route (and the pages this redesign
// doesn't touch) unchanged.

import Link from 'next/link'
import { ArrowIcon } from '@/components/icons'

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
    <section style={{ paddingBlock: 'clamp(56px, 9vw, 104px)', borderTop: '1px solid var(--dusk-rule)' }}>
      <div className="container" style={{ maxWidth: '62ch', margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--amber)' }}>
          {eyebrow}
        </p>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'clamp(34px, 5vw, 60px)', lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--dusk-ink)', marginTop: 16 }}>
          {heading}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 32 }}>
          <Link href={primaryHref} className="btn-primary">
            {primaryLabel} <ArrowIcon />
          </Link>
          <Link
            href={secondaryHref}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, padding: '0 24px', border: '1px solid var(--dusk-rule)', color: 'var(--dusk-ink)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 16, borderRadius: 'var(--radius-btn)' }}
          >
            {secondaryLabel}
          </Link>
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--dusk-ink-subtle)', marginTop: 22 }}>{note}</p>
      </div>
    </section>
  )
}
