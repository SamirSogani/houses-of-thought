import { CheckIcon, XIcon } from '@/components/icons'

const studentFeatures = [
  { text: 'Structured house builder', ok: true },
  { text: 'Research Mode with cited sources', ok: true },
  { text: 'House Strength & Stress Test', ok: true },
  { text: 'Co-pilot pinned to Learn mode (questions, not answers)', ok: false },
]

const teacherFeatures = [
  'Everything in Student mode',
  'Full AI co-pilot (Learn and Decide modes)',
  'Classroom roster & review tools',
  'Assign, monitor & give feedback',
]

export default function EducatorDifferenceSection() {
  return (
    <section
      style={{ background: '#fff', borderTop: '1px solid rgba(0,0,0,0.08)', paddingBlock: 'var(--section-py)' }}
    >
      <div className="container" data-reveal>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
          The key difference
        </p>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(28px, 3.6vw, 44px)', lineHeight: 1.1, marginTop: 16, maxWidth: '20ch' }}>
          The AI won&rsquo;t do their homework. That&rsquo;s the point.
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 44 }}>
          {/* Student mode card */}
          <div
            style={{
              flex: '1 1 340px',
              background: 'rgba(0,0,0,0.02)',
              border: '1px solid #000',
              borderRadius: 12,
              padding: 30,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 22, color: '#000' }}>
                Student mode
              </h3>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  border: '1px solid #000',
                  borderRadius: 5,
                  padding: '4px 8px',
                  color: '#000',
                }}
              >
                Assistant off
              </span>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(0,0,0,0.5)', marginTop: 12 }}>
              A full structured builder, with the co-reasoning assistant switched
              off on purpose.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
              {studentFeatures.map((f) => (
                <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {f.ok ? <CheckIcon /> : <XIcon />}
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(0,0,0,0.5)' }}>{f.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Teacher & Standard card */}
          <div
            style={{
              flex: '1 1 340px',
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 12,
              padding: 30,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 22, color: '#000' }}>
                Teacher & Standard
              </h3>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  border: '1px solid var(--green-strong)',
                  borderRadius: 5,
                  padding: '4px 8px',
                  color: 'var(--green-text)',
                }}
              >
                Full access
              </span>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(0,0,0,0.5)', marginTop: 12 }}>
              Everything students get, plus the co-reasoning assistant for your
              own work.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
              {teacherFeatures.map((text) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckIcon />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(0,0,0,0.5)' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.6, color: 'rgba(0,0,0,0.35)', maxWidth: '60ch', marginTop: 28 }}>
          The restriction is pedagogy rather than a shortcoming. With the
          assistant stepped back, students do the reasoning themselves, which is
          the whole thing you set out to teach and grade.
        </p>
      </div>
    </section>
  )
}
