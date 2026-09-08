import Link from 'next/link'

const cards = [
  {
    label: 'Age floor',
    body: 'Accounts require users to be at least 13. School-managed consent for younger classrooms is on the roadmap.',
  },
  {
    label: 'Privacy posture',
    body: "Student work is private to the classroom. We don't sell student data and don't use it for advertising.",
  },
]

const trustLinkStyle: React.CSSProperties = { color: '#000', borderBottom: '1px solid rgba(0,0,0,0.3)', paddingBottom: 1 }

export default function EducatorTrustSection() {
  return (
    <section
      style={{ background: '#fff', borderTop: '1px solid rgba(0,0,0,0.08)', paddingBlock: 'var(--section-py)' }}
    >
      <div className="container" data-reveal>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
          Trust & safety
        </p>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.1, marginTop: 16, maxWidth: '22ch' }}>
          Built for a classroom&rsquo;s standards.
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 44 }}>
          {cards.map((c) => (
            <div
              key={c.label}
              style={{ flex: '1 1 280px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 24 }}
            >
              <p
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'rgba(0,0,0,0.35)',
                  marginBottom: 8,
                }}
              >
                {c.label}
              </p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)' }}>
                {c.body}
              </p>
            </div>
          ))}

          <div style={{ flex: '1 1 280px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 24 }}>
            <p
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'rgba(0,0,0,0.35)',
                marginBottom: 8,
              }}
            >
              Data handling
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)' }}>
              Teachers control the roster and can remove students and their
              data. See <Link href="/privacy" style={trustLinkStyle}>Privacy</Link> and{' '}
              <Link href="/terms" style={trustLinkStyle}>Terms</Link>.
            </p>
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 28 }}>
          A formal COPPA / FERPA compliance review will be completed before
          any school-wide deployment.
        </p>
      </div>
    </section>
  )
}
