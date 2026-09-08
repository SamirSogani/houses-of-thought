import Link from 'next/link'
import { ArrowIcon } from '@/components/icons'

const roster: { name: string; topic: string; score: number | null; color: string }[] = [
  { name: 'A. Rivera', topic: 'Should AI be used in schools?', score: 82, color: 'var(--green-text)' },
  { name: 'J. Okafor', topic: 'Should AI be used in schools?', score: 61, color: 'var(--green-mid)' },
  { name: 'M. Chen', topic: 'In progress · 4 / 7 layers', score: null, color: 'var(--ink-subtle)' },
  { name: 'S. Patel', topic: 'Is a hot dog a sandwich?', score: 77, color: 'var(--green-text)' },
]

export default function EducatorHeroSection() {
  return (
    <section style={{ background: '#fff', paddingBlock: 'var(--hero-py)' }}>
      <div
        className="container"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(40px, 5vw, 72px)', alignItems: 'center' }}
      >
        <div style={{ flex: '1 1 380px', minWidth: 'min(300px, 100%)' }} data-reveal>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
            For educators
          </p>

          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 'clamp(40px, 6vw, 66px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              maxWidth: '14ch',
              marginTop: 20,
              color: '#000',
            }}
          >
            Make critical thinking visible.
          </h1>

          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'clamp(17px, 1.6vw, 19px)',
              lineHeight: 1.6,
              color: 'rgba(0,0,0,0.5)',
              maxWidth: '44ch',
              marginTop: 20,
            }}
          >
            Houses of Thought gives your students a structure for reasoning. It
            also gives you a window into how they think, beyond the answer they
            land on.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 32 }}>
            <Link
              href="/login?mode=signup&role=educator"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 52, padding: '0 26px', background: '#000', color: '#fff', fontWeight: 600, fontSize: 16, borderRadius: 999 }}
            >
              Create a classroom <ArrowIcon />
            </Link>
            <Link
              href="/try"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 52, padding: '0 24px', border: '1px solid rgba(0,0,0,0.15)', color: '#000', fontWeight: 600, fontSize: 16, borderRadius: 999 }}
            >
              Try it yourself
            </Link>
          </div>
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 'min(300px, 100%)', maxWidth: 480 }} data-reveal>
          <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 22 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'rgba(0,0,0,0.35)',
                marginBottom: 16,
              }}
            >
              <span>Class · AP Seminar · Period 3</span>
              <span>24 houses</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {roster.map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    background: 'rgba(0,0,0,0.02)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 8,
                    padding: '12px 14px',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 14, color: '#000', minWidth: 72 }}>
                    {s.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(0,0,0,0.35)', flex: 1 }}>
                    {s.topic}
                  </span>
                  {s.score !== null ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: s.color }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                      {s.score}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: s.color }}>···</span>
                  )}
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: 'rgba(0,0,0,0.35)',
                marginTop: 16,
              }}
            >
              <span>Teacher view</span>
              <span>Sorted by strength</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
