'use client'

// Business/solo-founder mode toggle (decision 021, plans/active/business-mode/
// 01-projects-and-toggle.md). Visually mirrors AccountTypeSelector, but this one
// stays interactive — workspace_mode is self-editable (decision 021 §2), never
// pinned by RLS the way account_type is. It must never be added to
// lib/auth/capabilities.ts: it gates AI framing and which UI sections render,
// never access.

import type { WorkspaceMode } from '@/lib/profile/data'

const modes: { key: WorkspaceMode; name: string; desc: string }[] = [
  {
    key: 'general',
    name: 'General',
    desc: 'The default Houses of Thought experience — unchanged.',
  },
  {
    key: 'business',
    name: 'Business',
    desc: 'Adds a Projects section for grouping houses by project. Business-framed AI guidance is coming in a later update.',
  },
]

export function WorkspaceModeToggle({
  value,
  onChange,
}: {
  value: WorkspaceMode
  onChange: (mode: WorkspaceMode) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Workspace mode"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}
    >
      {modes.map((m) => {
        const active = m.key === value
        return (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m.key)}
            style={{
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 15px',
              borderRadius: 10,
              background: active ? 'var(--amber-tint)' : 'var(--white)',
              border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
              transition: 'background 0.15s, border-color 0.15s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--ink-subtle)' }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--rule)' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{m.name}</span>
              {active && (
                <span className="mono" style={{ fontSize: 8, color: 'var(--amber-text)', border: '1px solid var(--amber-hover)', borderRadius: 4, padding: '2px 6px' }}>
                  Active
                </span>
              )}
            </span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.5 }}>{m.desc}</span>
          </button>
        )
      })}
    </div>
  )
}
