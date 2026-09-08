const chapterLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(0,0,0,0.35)',
}

const chapterHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontWeight: 400,
  fontSize: 'clamp(26px, 3.2vw, 34px)',
  lineHeight: 1.15,
  color: '#000',
  marginTop: 14,
}

const chapterBodyStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 18,
  lineHeight: 1.7,
  color: 'rgba(0,0,0,0.5)',
  marginTop: 16,
}

export default function StoryChaptersSection() {
  return (
    <section style={{ paddingBlock: 0 }}>
      <div
        className="container"
        style={{
          maxWidth: 720,
          borderTop: '1px solid rgba(0,0,0,0.08)',
          paddingTop: 'clamp(40px, 6vw, 64px)',
          paddingBottom: 'clamp(56px, 9vw, 96px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(40px, 6vw, 64px)',
        }}
      >
        <article data-reveal>
          <p style={chapterLabelStyle}>01 / The spark</p>
          <h2 style={chapterHeadingStyle}>I kept watching smart people make messy decisions.</h2>
          <p style={chapterBodyStyle}>
            Friends would agonize over a job offer for weeks and still second-guess
            it after taking it. Classmates would win an argument by talking the
            loudest, not by making the better case. I did the same thing to myself
            more than once, circling a decision for days before realizing I&rsquo;d
            never actually pinned down what I was deciding.
          </p>
          <p style={chapterBodyStyle}>
            It was never a lack of intelligence, and it was never a lack of
            information. What was missing, every time, was structure.
          </p>
        </article>

        <article data-reveal>
          <p style={chapterLabelStyle}>02 / The framework</p>
          <h2 style={chapterHeadingStyle}>The structure already existed. I just hadn&rsquo;t seen it yet.</h2>
          <p style={chapterBodyStyle}>
            My teacher, John Trapasso, had spent years teaching a framework for
            exactly this: work a question all the way through, one layer at a time,
            grounded in the Paul&ndash;Elder model for critical thinking. When he
            shared it with me, the gap I kept running into finally made sense.
          </p>
        </article>

        <article data-reveal>
          <p style={chapterLabelStyle}>03 / The build</p>
          <h2 style={chapterHeadingStyle}>So I built it.</h2>
          <p style={chapterBodyStyle}>
            Houses of Thought is that framework, built into software. It walks the
            same structure Trapasso teaches: the AI pushes on your thinking at every
            layer, but it never writes the conclusion for you. I built it as a
            student because the method changed how I made decisions, and there
            wasn&rsquo;t a good reason to keep it to myself.
          </p>
          <p
            style={{
              fontSize: 12,
              color: 'rgba(0,0,0,0.35)',
              marginTop: 20,
            }}
          >
            Created by Samir Sogani. Based on John Trapasso&rsquo;s classroom
            model, derived from the Paul&ndash;Elder model for critical thinking.
          </p>
        </article>
      </div>
    </section>
  )
}
