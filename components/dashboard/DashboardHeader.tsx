'use client'

// Authenticated app bar for the dashboard. Matches the reference layout
// (logo + blueprint subtitle · Framework · Collab · Profile · Sign Out) in brand style.

import Link from 'next/link'
import { LogoMark } from '@/components/icons'
import { SparkIcon } from '@/components/build/buildIcons'
import { AdminNavLink } from '@/components/admin/AdminNavLink'

const monoLink: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--ink-subtle)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  transition: 'color 0.15s',
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2.5H3.5A1.5 1.5 0 002 4v8a1.5 1.5 0 001.5 1.5H6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M9.5 11l3-3-3-3M12.5 8H6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.6l1.2 1.5H12.5A1.5 1.5 0 0114 6v5.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
    </svg>
  )
}

export function DashboardHeader({
  onSignOut,
  active,
  showClassroom = false,
  classroomHref = '/classroom',
  showProjects = false,
}: {
  onSignOut: () => void
  active?: 'framework' | 'collab' | 'classroom' | 'profile' | 'admin' | 'projects'
  // Teachers get a Classroom entry point (capabilities.canCreateClasses); students
  // get their own panel via classroomHref='/classes'.
  showClassroom?: boolean
  classroomHref?: string
  // Business mode (decision 021): opt-in nav entry for /projects. UI-only —
  // never a capability gate (lib/auth/capabilities.ts stays untouched by this).
  showProjects?: boolean
}) {
  const hover = (c: string) => (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = c)
  const activeStyle: React.CSSProperties = { color: 'var(--ink)', borderBottom: '2px solid var(--amber)', paddingBottom: 3 }

  return (
    <header style={{ background: 'var(--white)', borderBottom: '1px solid var(--rule)' }}>
      {/* Below 768px, acct-dash-bar (account-responsive.css) collapses this grid:
          the brand subtitle and center Framework slot hide, and the nav wraps
          onto its own row with 44px-tall tappable links. */}
      <div
        className="container acct-dash-bar"
        style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', paddingBlock: 14, gap: 20 }}
      >
        {/* Left: brand */}
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, justifySelf: 'start' }}>
          <LogoMark />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
            Houses of Thought
          </span>
        </Link>

        {/* Center: Framework */}
        <Link
          href="/framework"
          className="acct-dash-center"
          style={{ ...monoLink, justifySelf: 'center', ...(active === 'framework' ? activeStyle : {}) }}
          onMouseEnter={hover('var(--ink)')}
          onMouseLeave={hover(active === 'framework' ? 'var(--ink)' : 'var(--ink-subtle)')}
        >
          Framework
        </Link>

        {/* Right: Classroom · Collab · Profile · Sign Out */}
        <nav className="acct-dash-nav" style={{ display: 'flex', alignItems: 'center', gap: 22, justifySelf: 'end' }}>
          {showClassroom && (
            <Link
              href={classroomHref}
              style={{ ...monoLink, ...(active === 'classroom' ? activeStyle : {}) }}
              onMouseEnter={hover('var(--ink)')}
              onMouseLeave={hover(active === 'classroom' ? 'var(--ink)' : 'var(--ink-subtle)')}
            >
              Classroom
            </Link>
          )}
          {showProjects && (
            <Link
              href="/projects"
              style={{ ...monoLink, ...(active === 'projects' ? activeStyle : {}) }}
              onMouseEnter={hover('var(--ink)')}
              onMouseLeave={hover(active === 'projects' ? 'var(--ink)' : 'var(--ink-subtle)')}
            >
              <FolderIcon />
              Projects
            </Link>
          )}
          <Link href="/build" style={{ ...monoLink, color: 'var(--ink)', ...(active === 'collab' ? activeStyle : {}) }} onMouseEnter={hover('var(--amber-text)')} onMouseLeave={hover('var(--ink)')}>
            <SparkIcon size={13} fill="var(--amber-hover)" />
            New house
          </Link>
          <Link
            href="/profile"
            style={{ ...monoLink, ...(active === 'profile' ? activeStyle : {}) }}
            onMouseEnter={hover('var(--ink)')}
            onMouseLeave={hover(active === 'profile' ? 'var(--ink)' : 'var(--ink-subtle)')}
          >
            <GearIcon />
            Profile
          </Link>
          <AdminNavLink active={active === 'admin'} />
          <button type="button" onClick={onSignOut} style={monoLink} onMouseEnter={hover('var(--ink)')} onMouseLeave={hover('var(--ink-subtle)')}>
            <SignOutIcon />
            Sign Out
          </button>
        </nav>
      </div>
    </header>
  )
}
