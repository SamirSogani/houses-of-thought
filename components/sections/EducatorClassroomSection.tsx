const steps = [
  {
    num: '01',
    title: 'Create a class & invite',
    body: 'Spin up a classroom and share a join link or code. Students create a free account, redeem the code, and the class is waiting for them.',
  },
  {
    num: '02',
    title: 'Assign or let them choose',
    body: 'Hand the whole class one question, or let students bring their own. Either way they build a full house.',
  },
  {
    num: '03',
    title: 'Review their houses',
    body: 'See the evidence, assumptions, perspectives, and strength for every student, one layer at a time.',
  },
]

export default function EducatorClassroomSection() {
  return (
    <section
      style={{ background: 'rgba(0,0,0,0.02)', borderTop: '1px solid rgba(0,0,0,0.08)', paddingBlock: 'var(--section-py)' }}
    >
      <div className="container" data-reveal>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
          How classrooms work
        </p>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.1, marginTop: 16, maxWidth: '22ch' }}>
          Set up in minutes. Grade the reasoning behind the verdict.
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 44 }}>
          {steps.map((s) => (
            <div
              key={s.num}
              style={{
                flex: '1 1 280px',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 12,
                padding: 28,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.35)' }}>
                {s.num}
              </span>
              <h3
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 400,
                  fontSize: 22,
                  color: '#000',
                  marginTop: 14,
                }}
              >
                {s.title}
              </h3>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', marginTop: 10 }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
