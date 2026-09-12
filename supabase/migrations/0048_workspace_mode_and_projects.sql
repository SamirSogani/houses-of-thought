-- 0048_workspace_mode_and_projects.sql
-- Phase 1 of business/solo-founder mode (decision 021,
-- plans/active/business-mode/01-projects-and-toggle.md):
--   1. profiles.workspace_mode — the opt-in toggle. Self-editable, gates AI
--      framing and UI sections only, never RLS or a server-side capability
--      check (decision 021 §2 — unlike account_type, which IS privileged).
--   2. projects — a real, single-owner entity. RLS mirrors houses' owner-only
--      pattern (decisions 002/003).
--   3. houses.project_id — nullable link. Existing houses and school use are
--      completely unaffected.
-- Idempotent.

-- ── profiles.workspace_mode ─────────────────────────────────────────────────
alter table public.profiles
  add column if not exists workspace_mode text not null default 'general'
    check (workspace_mode in ('general', 'business'));

-- ── projects ─────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects (owner_id);

alter table public.projects enable row level security;

drop policy if exists "Owner can manage own projects" on public.projects;
create policy "Owner can manage own projects"
  on public.projects for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Base-table GRANT — RLS restricts rows but Postgres checks table privilege
-- first, so without this every request 42501s before any policy runs (the
-- same gap fixed for houses in 0005, and repeatedly since: 0019, 0029, 0031,
-- 0034, 0035, 0037, 0039, 0045).
grant select, insert, update, delete on public.projects to authenticated;

-- Bump updated_at on every update (same per-table trigger pattern as
-- house_sectors, 0044 — not the shared public.touch_updated_at() from 0003,
-- to match that precedent rather than introduce a third style).
create or replace function public.update_projects_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row
  execute function public.update_projects_updated_at();

-- ── houses.project_id ────────────────────────────────────────────────────
alter table public.houses
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists houses_project_id_idx on public.houses (project_id);
