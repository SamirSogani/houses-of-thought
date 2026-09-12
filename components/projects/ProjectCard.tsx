'use client'

// A single project card for the /projects grid, plus the "New Project" tile.
// Styled to match components/dashboard/HouseCard.tsx (white card, rule border,
// mono meta, semantic status chip) so Projects reads as part of the same system.

import Link from 'next/link'
import type { ProjectSummary } from '@/lib/projects/data'

const statusMeta: Record<ProjectSummary['status'], { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: 'var(--green-text)', bg: 'rgba(63,143,91,0.12)' },
  archived: { label: 'Archived', color: 'var(--ink-subtle)', bg: 'var(--parchment)' },
}

export function ProjectCard({
  project,
  onArchive,
  onReactivate,
}: {
  project: ProjectSummary
  onArchive?: (id: string) => void
  onReactivate?: (id: string) => void
}) {
  const meta = statusMeta[project.status]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 18,
        minHeight: 190,
        background: 'var(--white)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <Link
          href={`/projects/${project.id}`}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18, letterSpacing: '-0.01em', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {project.name}
        </Link>
        <span
          className="mono"
          style={{ flex: '0 0 auto', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: meta.color, background: meta.bg, borderRadius: 4, padding: '3px 7px' }}
        >
          {meta.label}
        </span>
      </div>

      {project.description && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-mid)', lineHeight: 1.5, flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          {project.description}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)' }}>{project.editedLabel}</span>
        {project.status === 'active' && onArchive && (
          <button
            type="button"
            onClick={() => onArchive(project.id)}
            className="mono"
            style={{ fontSize: 10, color: 'var(--ink-subtle)', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 8px' }}
          >
            Archive
          </button>
        )}
        {project.status === 'archived' && onReactivate && (
          <button
            type="button"
            onClick={() => onReactivate(project.id)}
            className="mono"
            style={{ fontSize: 10, color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 6, padding: '4px 8px' }}
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  )
}

export function CreateProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        minHeight: 190,
        width: '100%',
        border: '1.5px dashed var(--rule)',
        borderRadius: 'var(--radius-card)',
        color: 'var(--ink)',
        background: 'transparent',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--ink)'
        e.currentTarget.style.background = 'rgba(20,33,58,0.02)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--rule)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">+</span>
      <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14 }}>New Project</span>
    </button>
  )
}
