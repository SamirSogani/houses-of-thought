// /compare — the general comparison hub. Deliberately unlinked from every
// visible marketing page (redesign brief); reachable by direct URL or
// search/LLM discovery. May link to per-competitor spokes, and they link
// back here — the "no links" rule is about the visible marketing pages, not
// about this family being unable to reference itself.

import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/DuskHeader'
import MarketingFooter from '@/components/marketing/DuskFooter'
import MarketingCTASection from '@/components/marketing/DuskCTASection'
import { COMPETITORS, HUB_ROWS } from '@/lib/compare/data'

export const metadata: Metadata = pageMetadata({
  title: 'Houses of Thought vs. the field',
  description:
    'How Houses of Thought compares to AI decision tools: price, methodology depth, review rigor, transparency, and where the method comes from.',
  path: '/compare',
})

export default function ComparePage() {
  return (
    <div className="dusk-page">
      <MarketingHeader />
      <main id="main">
        <section style={{ paddingBlock: 'clamp(48px, 8vw, 96px)' }}>
          <div className="container" style={{ maxWidth: '68ch' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)' }}>
              Compare
            </p>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                fontSize: 'clamp(30px, 4.6vw, 50px)',
                lineHeight: 1.12,
                letterSpacing: '-0.015em',
                color: 'var(--dusk-ink)',
                marginTop: 16,
              }}
            >
              Free, reviewed reasoning, weighed against the field.
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, lineHeight: 1.65, color: 'var(--dusk-ink-mid)', marginTop: 18 }}>
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
                    <th style={{ ...thStyle, color: 'var(--amber)' }}>Houses of Thought</th>
                    <th style={thStyle}>Rationale-style tools</th>
                    <th style={thStyle}>Ad-hoc chatbot use</th>
                    <th style={thStyle}>Other paid decision tools</th>
                  </tr>
                </thead>
                <tbody>
                  {HUB_ROWS.map((r) => (
                    <tr key={r.dimension}>
                      <td style={{ ...tdStyle, color: 'var(--dusk-ink)', fontWeight: 600 }}>{r.dimension}</td>
                      <td style={tdStyle}>{r.houses}</td>
                      <td style={{ ...tdStyle, color: 'var(--dusk-ink-subtle)' }}>{r.rationaleStyle}</td>
                      <td style={{ ...tdStyle, color: 'var(--dusk-ink-subtle)' }}>{r.chatbot}</td>
                      <td style={{ ...tdStyle, color: 'var(--dusk-ink-subtle)' }}>{r.paidTools}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 24 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dusk-ink-subtle)', marginBottom: 10 }}>
                Named comparisons
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {Object.values(COMPETITORS).map((c) => (
                  <Link
                    key={c.slug}
                    href={`/compare/${c.slug}`}
                    className="dusk-card"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--dusk-ink)' }}
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
          primaryLabel="Try it instantly"
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
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--dusk-ink-subtle)',
  padding: '10px 16px',
  borderBottom: '1px solid var(--dusk-rule)',
}

const tdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--dusk-ink-mid)',
  padding: '14px 16px',
  borderBottom: '1px solid var(--dusk-rule-soft)',
  verticalAlign: 'top',
}
