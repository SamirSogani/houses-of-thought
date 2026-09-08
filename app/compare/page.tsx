// /compare — the general comparison hub. Deliberately unlinked from every
// visible marketing page (redesign brief); reachable by direct URL or
// search/LLM discovery. May link to per-competitor spokes, and they link
// back here — the "no links" rule is about the visible marketing pages, not
// about this family being unable to reference itself.

import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
import MarketingCTASection from '@/components/marketing/CTASection'
import { COMPETITORS, HUB_ROWS } from '@/lib/compare/data'

export const metadata: Metadata = pageMetadata({
  title: 'Houses of Thought vs. the field',
  description:
    'How Houses of Thought compares to AI decision tools: price, methodology depth, review rigor, transparency, and where the method comes from.',
  path: '/compare',
})

export default function ComparePage() {
  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <MarketingHeader variant="subpage" />
      <main id="main">
        <section style={{ paddingBlock: 'clamp(48px, 8vw, 96px)' }}>
          <div className="container" style={{ maxWidth: '68ch' }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
              Compare
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
              Free, reviewed reasoning, weighed against the field.
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 18 }}>
              A structural look at how Houses of Thought differs from ad-hoc chatbot use,
              other AI decision tools, and Rationale by Jina AI specifically.
            </p>
          </div>
        </section>

        <section style={{ paddingBlock: '0 var(--section-py)' }}>
          <div className="container">
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Dimension</th>
                    <th style={{ ...thStyle, color: '#000' }}>Houses of Thought</th>
                    <th style={thStyle}>Rationale-style tools</th>
                    <th style={thStyle}>Ad-hoc chatbot use</th>
                    <th style={thStyle}>Other paid decision tools</th>
                  </tr>
                </thead>
                <tbody>
                  {HUB_ROWS.map((r) => (
                    <tr key={r.dimension}>
                      <td style={{ ...tdStyle, color: '#000', fontWeight: 600 }}>{r.dimension}</td>
                      <td style={tdStyle}>{r.houses}</td>
                      <td style={{ ...tdStyle, color: 'rgba(0,0,0,0.35)' }}>{r.rationaleStyle}</td>
                      <td style={{ ...tdStyle, color: 'rgba(0,0,0,0.35)' }}>{r.chatbot}</td>
                      <td style={{ ...tdStyle, color: 'rgba(0,0,0,0.35)' }}>{r.paidTools}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,0,0,0.35)', marginBottom: 10 }}>
                Named comparisons
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {Object.values(COMPETITORS).map((c) => (
                  <Link
                    key={c.slug}
                    href={`/compare/${c.slug}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 16px',
                      background: '#fff',
                      border: '1px solid rgba(0,0,0,0.08)',
                      borderRadius: 'var(--radius-card)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#000',
                    }}
                  >
                    vs. {c.shortName} →
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <MarketingCTASection
          eyebrow="See for yourself"
          heading="Free forever. Start now."
          primaryLabel="Try it free"
          primaryHref="/try"
          secondaryLabel="How it works"
          secondaryHref="/how-it-works"
          note="No account needed to try it."
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
  fontSize: 14,
  lineHeight: 1.5,
  color: 'rgba(0,0,0,0.5)',
  padding: '14px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  verticalAlign: 'top',
}
