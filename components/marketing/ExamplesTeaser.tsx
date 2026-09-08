// Home: a compact proof-by-example section. Uses hardcoded example rows for
// the redesign — lib/examples/data.ts stays untouched.

import Link from 'next/link'

const EXAMPLE_ROWS = [
  {
    question: 'Should I leave my job to start a company?',
    stats: '7 layers · 62/63 standards passed · 1 retry',
  },
  {
    question: 'Is remote work better for productivity?',
    stats: '7 layers · 63/63 standards passed',
  },
  {
    question: 'Should schools ban phones in class?',
    stats: '7 layers · 61/63 standards passed · 2 retries',
  },
]

export default function ExamplesTeaser() {
  return (
    <section id="examples" style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '64px 24px', maxWidth: 1024, margin: '0 auto' }}>
      <style>{`
        @media (max-width: 640px) {
          #examples h2 { font-size: 24px !important; }
        }
      `}</style>

      <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
        Examples
      </p>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, lineHeight: 1.2 }}>
        See what a finished house looks like.
      </h2>
      <p style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)', maxWidth: 520, lineHeight: 1.6, margin: '12px 0 0' }}>
        Real questions, run through all seven layers. Every perspective, every assumption, every piece of evidence — visible.
      </p>

      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column' }}>
        {EXAMPLE_ROWS.map((row) => (
          <div
            key={row.question}
            style={{ display: 'flex', gap: 24, padding: '20px 0', borderTop: '1px solid rgba(0,0,0,0.08)', alignItems: 'baseline' }}
          >
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.25)', width: 20, flexShrink: 0 }}>
              →
            </span>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{row.question}</p>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', margin: '3px 0 0' }}>{row.stats}</p>
            </div>
          </div>
        ))}
      </div>

      <Link
        href="/examples"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 14,
          fontWeight: 600,
          color: '#000',
          textDecoration: 'none',
          border: '1.5px solid rgba(0,0,0,0.15)',
          borderRadius: 8,
          padding: '10px 20px',
          marginTop: 28,
        }}
      >
        Browse all examples →
      </Link>
    </section>
  )
}
