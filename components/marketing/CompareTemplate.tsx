// Reusable render for any /compare/[slug] competitor page (redesign brief:
// "built to extend to more competitors later without redesigning"). All copy
// comes from lib/compare/data.ts — this file only lays it out.

import Link from 'next/link'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
import MarketingCTASection from '@/components/marketing/CTASection'
import type { Competitor } from '@/lib/compare/data'

export function CompareTemplate({ competitor }: { competitor: Competitor }) {
  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <MarketingHeader variant="subpage" />
      <main id="main">
        <section style={{ paddingBlock: 'clamp(48px, 8vw, 96px)' }}>
          <div className="container" style={{ maxWidth: '68ch' }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
              {competitor.eyebrow}
            </p>
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 400,
                fontSize: 'clamp(30px, 4.6vw, 50px)',
                lineHeight: 1.12,
                letterSpacing: '-0.015em',
                color: '#000',
                marginTop: 16,
              }}
            >
              {competitor.headline}
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 18 }}>
              {competitor.intro}
            </p>
          </div>
        </section>

        <section style={{ paddingBlock: '0 var(--section-py)' }}>
          <div className="container">
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Dimension</th>
                    <th style={{ ...thStyle, color: '#000' }}>Houses of Thought</th>
                    <th style={thStyle}>{competitor.shortName}</th>
                  </tr>
                </thead>
                <tbody>
                  {competitor.rows.map((r) => (
                    <tr key={r.dimension}>
                      <td style={{ ...tdStyle, color: '#000', fontWeight: 600 }}>{r.dimension}</td>
                      <td style={tdStyle}>{r.houses}</td>
                      <td style={{ ...tdStyle, color: 'rgba(0,0,0,0.35)' }}>{r.them}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 16 }}>
              <Link href="/compare" style={{ color: '#000', borderBottom: '1px solid rgba(0,0,0,0.3)', paddingBottom: 1 }}>
                See the general comparison →
              </Link>
            </p>
          </div>
        </section>

        <MarketingCTASection
          eyebrow="Bring your decisions here"
          heading="Free forever. Start now."
          primaryLabel="Try it free"
          primaryHref="/try"
          secondaryLabel="How it works"
          secondaryHref="/how-it-works"
          note="No account needed to try it, and no paid tier waiting behind it."
        />
      </main>
      <MarketingFooter />
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(0,0,0,0.35)',
  padding: '10px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
}

const tdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 14.5,
  lineHeight: 1.5,
  color: 'rgba(0,0,0,0.5)',
  padding: '14px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  verticalAlign: 'top',
}
