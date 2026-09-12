-- 0049_project_context.sql
-- Phase 3 of business/solo-founder mode (decision 021,
-- plans/active/business-mode/03-accumulating-context.md): structured,
-- accumulating context on a project. App-level shape only (not enforced by a
-- DB constraint — same convention as profiles.perspectives and the house
-- builder's State, per context/architecture/data-model/app-level-shapes.md):
--
--   type ProjectContext = {
--     stage?: string
--     customer?: string
--     businessModel?: string
--     keyFacts: string[]      // accumulated facts, most recent last, capped
--                             // client-side (lib/projects/data.ts's
--                             // MAX_KEY_FACTS) — never let it grow unbounded.
--     updatedAt: string
--   }
--
-- Idempotent. No RLS/grant change needed — projects already has both
-- (0048): this is an additive column on an existing, already-secured table.

alter table public.projects
  add column if not exists context jsonb not null default '{}'::jsonb;
