// Home: problem/value framing. This is about what the method itself does
// differently, not what it's not.

const PILLARS = [
  {
    title: 'Reasons in the open',
    body: 'Every layer and every verdict is visible while it happens, not a single answer with the thinking hidden.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#000" strokeWidth={1.5}>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 7v6M7 10h6" />
      </svg>
    ),
  },
  {
    title: 'Checks its own work',
    body: 'Six of seven layers are graded by nine independent reviewers. A failed check sends the layer back.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#000" strokeWidth={1.5}>
        <path d="M6 10l3 3 5-6" />
        <circle cx="10" cy="10" r="7" />
      </svg>
    ),
  },
  {
    title: "Won't decide for you",
    body: 'It frames, builds, and stress-tests. The conclusion — and the choice — stays yours.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#000" strokeWidth={1.5}>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 7v3l2 2" />
      </svg>
    ),
  },
]

export default function WhySection() {
  return (
    <section id="why" style={{ borderTop: '1px solid rgba(0,0,0,0.08)', padding: '64px 24px', maxWidth: 1024, margin: '0 auto' }}>
      <style>{`
        @media (max-width: 640px) {
          #why h2 { font-size: 24px !important; }
          #why .why-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
        Why it&rsquo;s different
      </p>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, lineHeight: 1.2 }}>
        Most AI just answers.
        <br />
        This reasons through it with you.
      </h2>

      <div className="why-grid" style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 32 }}>
        {PILLARS.map((p) => (
          <div key={p.title}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {p.icon}
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p.title}</span>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', margin: 0 }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
