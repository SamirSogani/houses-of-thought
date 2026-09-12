# Phase 1 — `workspace_mode` toggle + Projects entity

**Delivers:** a settings toggle and a real Projects section, with no AI
behavior change yet. Fully shippable on its own.

## Schema

New migration (next available number at implementation time — `0048` as of
2026-09-11, verify against `supabase/migrations/` before naming it):

```sql
-- profiles: the toggle. Self-editable, not privileged (decision 021 §2).
alter table profiles
  add column if not exists workspace_mode text not null default 'general'
    check (workspace_mode in ('general', 'business'));

-- projects: single-owner, mirrors houses' RLS pattern.
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table projects enable row level security;

create policy "Owner can manage own projects"
  on projects for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- houses: nullable link, existing houses and school use are unaffected.
alter table houses
  add column if not exists project_id uuid references projects(id) on delete set null;
```

Follow the `updated_at` trigger pattern already used for `houses`/`house_sectors`
(see `0044_house_sectors.sql`) rather than inventing a new one.

## App changes

- `lib/profile/data.ts` / `components/profile/ProfileForm.tsx`: add
  `workspaceMode` alongside the existing fields, same snake↔camel mapping
  convention as `current_project`/`currentProject`. A toggle control, not a
  free-text field — decide during implementation whether it lives on
  `/profile` (lower effort, matches how `account_type`/`current_project`
  already live there) or a new `/settings` route (cleaner IA if more
  toggles are coming) — flag this as an open call for Samir, don't default
  silently either way.
- New `lib/projects/data.ts`: CRUD against `projects`, same shape as
  `lib/dashboard/houses.ts`.
- New routes: `/projects` (list + create + archive) and `/projects/[id]`
  (detail — houses under this project, and the accumulating-context editor
  from Phase 3). Follow `proxy.ts`'s existing route-protection list —
  add `/projects` to the guarded paths.
- `/build`'s "Create New House" flow: optional project picker when
  `workspace_mode = 'business'`; sets `houses.project_id`. No behavior
  change for `workspace_mode = 'general'`.
- Dashboard: houses grouped by project when the user has any, ungrouped
  list otherwise (don't force project-first navigation on users with zero
  projects).

## Explicitly not in this phase

No prompt changes, no RAG, no document upload. A user can turn the toggle on
and create Projects and see nothing about how houses are built change yet —
that's Phase 2+.

## Manual verification

- Toggle survives reload; defaults to `general` for existing accounts.
- Create/archive a project; confirm RLS blocks reading another user's
  project via a direct PostgREST call (mirror the check style in
  `audits/2026-07-19/06-security.md`).
- Create a house from within a project; confirm `project_id` persists and
  a house created outside any project still works exactly as today.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` all pass.
