// Standards dot indicator — shows passed/failed dots for a layer's review panel.

export default function StandardsDots({
  passed,
  total,
  retries,
}: {
  passed: number
  total: number
  retries?: number
}) {
  const dots = Array.from({ length: total }, (_, i) => i < passed)

  let label = `${passed}/${total}`
  if (retries) {
    label = retries > 1 ? `${passed}/${total} → ${retries} retries` : `${passed}/${total} → retry`
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {dots.map((isPassed, i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: isPassed ? '#000' : 'rgba(0,0,0,0.15)',
          }}
        />
      ))}
      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.35)' }}>
        {label}
      </span>
    </div>
  )
}
