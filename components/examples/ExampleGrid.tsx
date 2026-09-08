'use client'

// The filterable card grid for /examples. Split out of the page (seo #6) so the
// page itself can stay a server component and export metadata — a 'use client'
// page cannot. Only the filter state needs the client; the cards themselves are
// plain markup that pre-renders either way.

import { useState } from 'react'
import Link from 'next/link'
import { examples, exampleDomains, type ExampleDomain, type ExampleHouse } from '@/lib/examples/data'
import { computeStrength, strengthColor, overallLabel } from '@/lib/build/strength'

type Filter = 'All' | ExampleDomain

export function ExampleGrid() {
  const [filter, setFilter] = useState<Filter>('All')
  const shown = filter === 'All' ? examples : examples.filter((e) => e.domain === filter)

  return (
    <>
      {/* Filter chips */}
      <div
        role="group"
        aria-label="Filter examples by domain"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 28 }}
      >
        {(['All', ...exampleDomains] as Filter[]).map((d) => {
          const active = filter === d
          return (
            <button
              key={d}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(d)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                letterSpacing: '0.02em',
                padding: '7px 14px',
                borderRadius: 999,
                border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
                background: active ? 'var(--ink)' : 'transparent',
                color: active ? 'var(--parchment)' : 'var(--ink-mid)',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s, color 0.15s',
              }}
            >
              {d}
            </button>
          )
        })}
      </div>

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))',
          gap: 22,
          marginTop: 'clamp(24px, 3vw, 36px)',
        }}
      >
        {shown.map((e) => (
          <ExampleCard key={e.slug} example={e} />
        ))}
      </div>
    </>
  )
}

function ExampleCard({ example }: { example: ExampleHouse }) {
  const s = computeStrength(example.house)
  const badge = strengthColor(s.overall)

  return (
    <Link
      href={`/examples/${example.slug}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--white)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-card)',
        padding: 22,
        minHeight: 230,
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--ink)'
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(20,33,58,0.08)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--rule)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'none'
      }}
    >
      {/* Tags */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--ink-subtle)', border: '1px solid var(--rule)', borderRadius: 5, padding: '2px 8px' }}
        >
          {example.domain}
        </span>
        <span
          className="mono"
          style={{ fontSize: 10, color: badge, border: `1px solid ${badge}`, borderRadius: 5, padding: '2px 8px', marginLeft: 'auto' }}
        >
          Strength {s.overall} · {overallLabel(s.overall)}
        </span>
      </div>

      {/* Question */}
      <h3
        style={{
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          fontSize: 21,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          lineHeight: 1.25,
          marginTop: 14,
        }}
      >
        {example.house.title}
      </h3>

      {/* Stance line */}
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--ink-mid)',
          lineHeight: 1.5,
          marginTop: 10,
        }}
      >
        {example.summary}
      </p>

      {/* Mini axis bars */}
      <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 18 }}>
        {([
          ['Evidence', s.evidence],
          ['Logic', s.logic],
          ['Coverage', s.coverage],
        ] as const).map(([label, value]) => (
          <div key={label} style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)', display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span>{label}</span>
              <span style={{ color: strengthColor(value) }}>{value}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--rule)', overflow: 'hidden' }}>
              <div style={{ width: `${value}%`, height: '100%', borderRadius: 2, background: strengthColor(value) }} />
            </div>
          </div>
        ))}
      </div>
    </Link>
  )
}
