export default function FaqIntroSection() {
  return (
    <section style={{ paddingBlock: 'var(--hero-py)' }}>
      <div className="container" style={{ maxWidth: 820, margin: '0 auto' }} data-reveal>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>FAQ</p>

        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5.4vw, 60px)',
            lineHeight: 1.08,
            letterSpacing: '-0.015em',
            maxWidth: '14ch',
            marginTop: 20,
            color: '#000',
          }}
        >
          Questions, answered.
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(17px, 1.6vw, 19px)',
            lineHeight: 1.6,
            color: 'rgba(0,0,0,0.5)',
            maxWidth: '52ch',
            marginTop: 20,
          }}
        >
          The short version of how Houses of Thought works, what the AI does, and
          how classrooms and accounts are handled.
        </p>
      </div>
    </section>
  )
}
