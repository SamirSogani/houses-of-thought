// Static data, validation, and row<->form mapping for the Profile page.
// Profiles ARE database-backed (public.profiles); rowToProfile/autosaveRow below
// are the boundary. Copy taken from references/ux/Migration_v2_Profile.pdf.

export type AccountType = 'standard' | 'student' | 'teacher'

// Business/solo-founder mode (decision 021). A preference, not a privilege —
// unlike account_type it must never be read by RLS or capabilitiesFor
// (lib/auth/capabilities.ts); it only changes which UI sections render.
export type WorkspaceMode = 'general' | 'business'

export interface AccountTypeMeta {
  key: AccountType
  name: string
  desc: string
}

export const accountTypes: AccountTypeMeta[] = [
  {
    key: 'standard',
    name: 'Standard',
    desc: 'Full access to every feature, including the AI co-pilot in both Learn and Decide modes.',
  },
  {
    key: 'student',
    name: 'Student',
    desc: 'Built for classroom learning. The AI co-pilot works in Learn mode only: it coaches with Socratic questions and never writes your house for you.',
  },
  {
    key: 'teacher',
    name: 'Teacher',
    desc: 'Full access for educators. Same features as Standard.',
  },
]

export type PerspectiveKey = 'biological' | 'social' | 'familial' | 'individual'

export interface PerspectiveMeta {
  key: PerspectiveKey
  name: string
  desc: string
  placeholder: string
}

export const perspectiveFields: PerspectiveMeta[] = [
  {
    key: 'biological',
    name: 'Biological',
    desc: 'Your biological influences, instincts, and physical perspective',
    placeholder: 'Describe your biological perspective...',
  },
  {
    key: 'social',
    name: 'Social',
    desc: 'Your social context, cultural background, and community influences',
    placeholder: 'Describe your social perspective...',
  },
  {
    key: 'familial',
    name: 'Familial',
    desc: 'Your family upbringing, traditions, and familial values',
    placeholder: 'Describe your familial perspective...',
  },
  {
    key: 'individual',
    name: 'Individual',
    desc: 'Your unique personal experiences, beliefs, and individual identity',
    placeholder: 'Describe your individual perspective...',
  },
]

export interface ProfileData {
  username: string
  accountType: AccountType
  workspaceMode: WorkspaceMode
  aboutMe: string
  currentProject: string
  role: string
  location: string
  perspectives: Record<PerspectiveKey, string>
}

// Shape of a public.profiles row (see 0002_profiles_extend.sql). Column names are
// snake_case; username is nullable until the user sets one.
export interface ProfileRow {
  username: string | null
  account_type: AccountType
  workspace_mode: WorkspaceMode
  about_me: string
  current_project: string
  role: string
  location: string
  perspectives: Record<PerspectiveKey, string> | null
}

// Map a DB row (or null, when the row is somehow missing) to the form's camelCase
// shape. A null username becomes '' so the page can seed it from the email.
export function rowToProfile(row: ProfileRow | null): ProfileData {
  return {
    username: row?.username ?? '',
    accountType: row?.account_type ?? 'standard',
    workspaceMode: row?.workspace_mode ?? 'general',
    aboutMe: row?.about_me ?? '',
    currentProject: row?.current_project ?? '',
    role: row?.role ?? '',
    location: row?.location ?? '',
    perspectives: {
      biological: row?.perspectives?.biological ?? '',
      social: row?.perspectives?.social ?? '',
      familial: row?.perspectives?.familial ?? '',
      individual: row?.perspectives?.individual ?? '',
    },
  }
}

// Map the form shape back to a profiles row for update(). An empty username is
// stored as null so the nullable unique/regex constraints are satisfied.
export function profileToRow(p: ProfileData): ProfileRow {
  return {
    username: p.username || null,
    account_type: p.accountType,
    workspace_mode: p.workspaceMode,
    about_me: p.aboutMe,
    current_project: p.currentProject,
    role: p.role,
    location: p.location,
    perspectives: p.perspectives,
  }
}

// The AUTOSAVE payload (bl-H3). Deliberately narrower than profileToRow:
//   - no account_type — it's written only by the selector's explicit change, so
//     a stale tab's autosave can never silently revert a switch made elsewhere;
//   - workspace_mode IS included — unlike account_type it's a plain preference
//     (decision 021 §2), self-editable the same way about_me is;
//   - username only when locally valid AND not a name the DB already rejected
//     as taken — otherwise one bad username froze (or 23505-rejected) every
//     other field's save while the header claimed "All changes saved".
export function autosaveRow(
  p: ProfileData,
  knownTaken: string | null
): Partial<ProfileRow> {
  const row: Partial<ProfileRow> = {
    workspace_mode: p.workspaceMode,
    about_me: p.aboutMe,
    current_project: p.currentProject,
    role: p.role,
    location: p.location,
    perspectives: p.perspectives,
  }
  if (!usernameError(p.username) && p.username !== knownTaken) row.username = p.username
  return row
}

// Username rule from the reference: 3-30 chars; letters, numbers, underscore, dot, dash.
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/

export function usernameError(value: string): string | null {
  if (value.length === 0) return 'Username is required.'
  if (value.length < 3) return 'Use at least 3 characters.'
  if (value.length > 30) return 'Use 30 characters or fewer.'
  if (!USERNAME_RE.test(value)) return 'Only letters, numbers, underscore, dot, or dash.'
  return null
}
