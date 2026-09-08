// Home: a compact pitch to teachers, with a link into the full /educators
// page. Kept deliberately plain — this is a checklist of what the classroom
// experience gives a teacher, not a sales pitch.

import Link from 'next/link'

const POINTS = [
  'Create classes and invite students with a join code',
  "See every student's reasoning — every layer, every verdict",
  'Works alongside any curriculum — not a replacement, a tool',
  'Free for teachers. Free for students. Free for good.',
]

export default function EducatorsTeaser() {
  return (
    <section
      id="educators"
      style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '64px 24px', maxWidth: 1024, margin: '0 auto' }}
    >
      <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: 2.4, textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
        For educators
      </p>
      <h2
        className="educators-teaser-heading"
        style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, lineHeight: 1.2, margin: '12px 0 0' }}
      >
        Built from a classroom.
        <br />
        Built for classrooms.
      </h2>
      <p style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)', maxWidth: 560, lineHeight: 1.6, margin: '12px 0 0' }}>
        Houses of Thought started as a teaching method. The seven-layer model comes from years of
        classroom use — students learning to reason through complex questions instead of looking up
        answers.
      </p>

      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column' }}>
        {POINTS.map((point, i) => (
          <div
            key={point}
            style={{
              display: 'flex',
              gap: 16,
              padding: '16px 0',
              borderTop: '1px solid rgba(0,0,0,0.08)',
              borderBottom: i === POINTS.length - 1 ? '1px solid rgba(0,0,0,0.08)' : undefined,
              alignItems: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#000" strokeWidth="1.5">
              <path d="M6 9l2 2 4-4" />
            </svg>
            <span style={{ fontSize: 14, color: 'rgba(0,0,0,0.6)' }}>{point}</span>
          </div>
        ))}
      </div>

      <Link
        href="/educators"
        style={{
          marginTop: 28,
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
        }}
      >
        Learn more for educators →
      </Link>

      <style>{`
        @media (max-width: 640px) {
          .educators-teaser-heading { font-size: 24px; }
        }
      `}</style>
    </section>
  )
}
