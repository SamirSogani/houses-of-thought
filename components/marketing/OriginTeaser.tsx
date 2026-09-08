// Home: a short nod to the origin story and its credibility (a real classroom
// model, not proprietary house style) — the full narrative lives at /story.

import Link from 'next/link'

export default function OriginTeaser() {
  return (
    <section style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '64px 24px', maxWidth: 1024, margin: '0 auto' }}>
      <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: 2.4, textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)', margin: '0 0 20px' }}>
        Origin
      </p>
      <p
        style={{
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 28,
          lineHeight: 1.35,
          margin: 0,
          maxWidth: 640,
        }}
      >
        &ldquo;It was never a lack of intelligence, and it was never a lack of information. What was
        missing was structure.&rdquo;
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', margin: '20px 0 0', maxWidth: 520 }}>
        John Trapasso&rsquo;s classroom model, taught for years before it was ever software. Derived from
        the Paul&ndash;Elder framework for critical thinking.
      </p>
      <Link
        href="/story"
        style={{
          display: 'inline-block',
          marginTop: 16,
          fontSize: 13,
          fontWeight: 600,
          color: '#000',
          textDecoration: 'none',
          borderBottom: '1px solid rgba(0,0,0,0.3)',
          paddingBottom: 1,
        }}
      >
        Read our story →
      </Link>
    </section>
  )
}
