# Phase 1 — Schema + entry points

**Delivers:** the `project_deep_dives` table, the 4 boxes on the Project
detail page, and a Deep Dive page shell (prompt box + history list) that
persists prompts. No AI generation yet — that's Phase 2.

## Schema

```sql
-- 0052_project_deep_dives.sql
-- Phase 1 of Project Deep Dive tools (decision 022,
-- plans/active/project-deep-dives/01-schema-and-entry-points.md). One row
-- per Deep Dive run: a prompt plus its (eventually panel-reviewed) result,
-- scoped to a project and a fixed domain. RLS mirrors projects (decision
-- 021) — owner_id = auth.uid(), no cross-project/cross-user visibility.
-- Idempotent.

create table if not exists public.project_deep_dives (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  owner_id         uuid not null references auth.users(id) on delete cascade,
  domain           text not null check (domain in ('perspectives', 'assumptions', 'research', 'implications')),
  prompt           text not null,
  status           text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result           jsonb,
  saved_to_project boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists project_deep_dives_project_domain_idx
  on public.project_deep_dives (project_id, domain, created_at desc);

alter table public.project_deep_dives enable row level security;

drop policy if exists "Owner can manage own deep dives" on public.project_deep_dives;
create policy "Owner can manage own deep dives"
  on public.project_deep_dives for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select, insert, update, delete on public.project_deep_dives to authenticated;

create or replace function public.update_project_deep_dives_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists project_deep_dives_updated_at on public.project_deep_dives;
create trigger project_deep_dives_updated_at
  before update on public.project_deep_dives
  for each row
  execute function public.update_project_deep_dives_updated_at();
```

`result` shape is domain-dependent and app-level only (same convention as
`projects.context`, 0049) — do not add a DB constraint on its contents.

## UI

- `lib/projects/deepDives.ts`: types + CRUD (list by project+domain, create
  pending row), same shape as `lib/projects/data.ts`.
- Four boxes at the bottom of
  [app/projects/[id]/page.tsx](../../../app/projects/[id]/page.tsx), below
  the Houses section, one per domain — label, one-line description, link to
  `/projects/[id]/deep-dive/[domain]`.
- New route `app/projects/[id]/deep-dive/[domain]/page.tsx`: breadcrumb back
  to the project, a prompt textarea + submit (inserts a `pending` row, no
  generation call in this phase), and the domain's history list
  (prompt + status; `pending` renders as a stub since Phase 2 doesn't exist
  yet).
- Reject an unknown `domain` param the same way `/build/[id]` rejects an
  unowned house (not-found rather than a crash).

## Manual verification

- All four boxes render only when `workspace_mode === 'business'`, same
  gating as the existing Projects nav item.
- Create a Deep Dive entry in each of the 4 domains; confirm it lists under
  the right project and domain, and a second test user can't see it (RLS).
- `npx tsc --noEmit` and `npm run build` pass.
