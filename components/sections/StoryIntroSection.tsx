export default function StoryIntroSection() {
  return (
    <section style={{ paddingBlock: 'var(--hero-py)' }}>
      <div className="container" style={{ maxWidth: 720, margin: '0 auto' }} data-reveal>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>Our story</p>

        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5.4vw, 60px)',
            lineHeight: 1.08,
            letterSpacing: '-0.015em',
            maxWidth: '16ch',
            marginTop: 20,
            color: '#000',
          }}
        >
          A short story about how this started.
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(18px, 1.7vw, 20px)',
            lineHeight: 1.6,
            color: 'rgba(0,0,0,0.5)',
            maxWidth: '56ch',
            marginTop: 20,
          }}
        >
          Houses of Thought started as a student project, built around a framework
          his teacher was willing to share.
        </p>
      </div>
    </section>
  )
}
