// Home: the seven-layer method walkthrough with per-layer standards review
// dots — a teaser for the full breakdown at /how-it-works.

import Link from 'next/link'
import StandardsDots from './StandardsDots'

const LAYERS: {
  title: string
  description: string
  dots?: { passed: number; total: number; retries?: number }
}[] = [
  {
    title: 'Frame the question',
    description:
      "Define what's actually being asked, what type of question it is, and what a good answer looks like.",
    dots: { passed: 9, total: 9 },
  },
  {
    title: 'Scope the angles',
    description: 'A judgment call — which angles the question needs to be examined from.',
  },
  {
    title: 'Build perspectives',
    description:
      'Independent viewpoints for each angle, each with its own assumptions and evidence.',
    dots: { passed: 8, total: 9, retries: 1 },
  },
  {
    title: 'Surface assumptions',
    description: 'The hidden assumptions each perspective relies on, examined in the open.',
    dots: { passed: 9, total: 9 },
  },
  {
    title: 'Weigh the evidence',
    description: "What's strong, what's speculative, and what's missing entirely.",
    dots: { passed: 9, total: 9 },
  },
  {
    title: 'Reach conclusions',
    description: 'A verdict that follows logically from what the evidence actually supports.',
    dots: { passed: 9, total: 9 },
  },
  {
    title: 'Trace implications',
    description: 'What follows — downstream consequences and second-order effects.',
    dots: { passed: 9, total: 9 },
  },
]

export default function HowItWorksTeaser() {
  return (
    <section
      id="how-it-works"
      style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '64px 24px', maxWidth: 1024, margin: '0 auto' }}
    >
      <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: 2.4, textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
        How it works
      </p>
      <h2
        className="how-it-works-heading"
        style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, lineHeight: 1.2 }}
      >
        Seven layers. Nine standards each.
        <br />
        One question at a time.
      </h2>
      <p style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)', maxWidth: 520, lineHeight: 1.6, marginTop: 12 }}>
        Built on John Trapasso&rsquo;s classroom model and the Paul&ndash;Elder framework for
        critical thinking. Taught for years before it was ever software.
      </p>

      <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column' }}>
        {LAYERS.map((layer, i) => (
          <div
            key={layer.title}
            style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '24px 0', display: 'flex', gap: 24 }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.25)', width: 40, flexShrink: 0 }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
                {layer.title}
              </p>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginTop: 4, lineHeight: 1.55 }}>
                {layer.description}
              </p>
              <div style={{ marginTop: 10 }}>
                {layer.dots ? (
                  <StandardsDots passed={layer.dots.passed} total={layer.dots.total} retries={layer.dots.retries} />
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.25)', fontStyle: 'italic' }}>
                    no review panel
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#000' }} />
          = standard passed
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(0,0,0,0.15)' }} />
          = failed → sent back
        </span>
      </div>

      <div style={{ marginTop: 32 }}>
        <Link
          href="/how-it-works"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 600,
            color: '#000',
            border: '1.5px solid rgba(0,0,0,0.15)',
            borderRadius: 8,
            padding: '10px 20px',
          }}
        >
          Dive deeper into the method →
        </Link>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .how-it-works-heading { font-size: 24px; }
        }
      `}</style>
    </section>
  )
}
