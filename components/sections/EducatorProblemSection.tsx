const columns = [
  {
    letter: 'A',
    title: 'Chatbots skip the work',
    body: 'A polished essay can arrive without a single original thought behind it, which leaves you grading the surface instead of the thinking.',
  },
  {
    letter: 'B',
    title: 'Reasoning is invisible',
    body: 'The final paragraph hides the assumptions a student made, the evidence they used, and the perspectives they never considered.',
  },
  {
    letter: 'C',
    title: 'Feedback comes too late',
    body: 'By the time you read the conclusion, the chance to redirect the thinking has already passed.',
  },
]

export default function EducatorProblemSection() {
  return (
    <section
      style={{ background: '#fff', borderTop: '1px solid rgba(0,0,0,0.08)', paddingBlock: 'var(--section-py)' }}
    >
      <div className="container" data-reveal>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
          The problem you already feel
        </p>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.1, marginTop: 16, maxWidth: '24ch' }}>
          The answer looks fine. The thinking is a black box.
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 44 }}>
          {columns.map((c) => (
            <div key={c.letter} style={{ flex: '1 1 260px', borderTop: '2px solid #000', paddingTop: 20 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.35)' }}>
                {c.letter}
              </span>
              <h3
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 400,
                  fontSize: 21,
                  color: '#000',
                  marginTop: 12,
                }}
              >
                {c.title}
              </h3>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', marginTop: 10 }}>
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
