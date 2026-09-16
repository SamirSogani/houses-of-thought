-- 0052_project_deep_dives.sql
-- Phase 1 of Project Deep Dive tools (decision 022,
-- plans/active/project-deep-dives/01-schema-and-entry-points.md). One row
-- per Deep Dive run: a prompt plus its (eventually panel-reviewed) result,
-- scoped to a project and a fixed domain. RLS mirrors projects (decision
-- 021) — owner_id = auth.uid(), no cross-project/cross-user visibility.
-- Idempotent.
--
-- attempt/draft/verdict/master_guidance added in Phase 2
-- (plans/active/project-deep-dives/02-generation-engine.md) — this
-- migration had NOT been applied anywhere yet at that point (see
-- supabase/migrations/README.md's own row for it), so these are folded
-- directly into the table's own create statement rather than a separate
-- patch migration, plus a defensive ADD COLUMN IF NOT EXISTS below in case
-- some environment ever runs an older copy of this same file number first.
-- Together they let app/api/ai/deep-dive/route.ts resume a run's
-- generate/review/regenerate/master-review loop correctly across the many
-- separate HTTP requests that loop is actually made of (one route call = one
-- unit of work, Vercel Hobby's real ~60s-per-request ceiling) without any
-- extra state: attempt is the current draft's attempt number (1..
-- MASTER_REVIEW_ATTEMPT, lib/ai/reasoning/budget.ts), draft is the latest
-- generated artifact awaiting review, verdict is that draft's review-panel
-- result once reviewed, and master_guidance is set once (and only once) the
-- bounded regeneration loop escalates to a master-reviewer synthesis for the
-- one final attempt it earns — see lib/projects/deepDives.ts's
-- nextDeepDiveAction for the full state machine these four fields encode.
create table if not exists public.project_deep_dives (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  owner_id         uuid not null references auth.users(id) on delete cascade,
  domain           text not null check (domain in ('perspectives', 'assumptions', 'research', 'implications')),
  prompt           text not null,
  status           text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result           jsonb,
  saved_to_project boolean not null default false,
  attempt          int not null default 1,
  draft            jsonb,
  verdict          jsonb,
  master_guidance  jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Defensive (see header comment) — a no-op the first time this file ever
-- runs anywhere, since the create table above already defines these columns.
alter table public.project_deep_dives add column if not exists attempt int not null default 1;
alter table public.project_deep_dives add column if not exists draft jsonb;
alter table public.project_deep_dives add column if not exists verdict jsonb;
alter table public.project_deep_dives add column if not exists master_guidance jsonb;

create index if not exists project_deep_dives_project_domain_idx
  on public.project_deep_dives (project_id, domain, created_at desc);

alter table public.project_deep_dives enable row level security;

drop policy if exists "Owner can manage own deep dives" on public.project_deep_dives;
create policy "Owner can manage own deep dives"
  on public.project_deep_dives for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Base-table GRANT — RLS restricts rows but Postgres checks table privilege
-- first, so without this every request 42501s before any policy runs (the
-- same gap fixed for projects in 0048, and repeatedly since: 0019, 0029,
-- 0031, 0034, 0035, 0037, 0039, 0045, 0051).
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
