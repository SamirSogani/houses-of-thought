-- 0050_project_documents.sql
-- Phase 4 of business/solo-founder mode (decision 021,
-- plans/active/business-mode/04-document-upload.md): per-project document
-- upload. Text is extracted and stored, ready for Phase 5's retrieval — this
-- phase does NOT wire retrieval into house-building.
--
-- Two distinct policy surfaces, both written here (not as an afterthought):
--   1. project_documents (a normal table) — table RLS, same owner_id =
--      auth.uid() shape as projects (0048).
--   2. storage.objects (Supabase Storage) — a DIFFERENT policy surface with
--      its own syntax (storage.foldername()), genuinely new ground for this
--      repo (no prior bucket to model this on). Storage path convention:
--      "<owner_id>/<project_id>/<uuid>-<filename>" — (storage.foldername(name))[1]
--      is the owner segment, checked against auth.uid() with no lookup join,
--      mirroring why houses.project_id / projects.owner_id need none either.
-- Idempotent.

-- ── project_documents ────────────────────────────────────────────────────
create table if not exists public.project_documents (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  filename       text not null,
  mime_type      text not null,
  storage_path   text not null,
  status         text not null default 'pending' check (status in ('pending', 'parsed', 'failed')),
  extracted_text text,
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists project_documents_project_id_idx on public.project_documents (project_id);
create index if not exists project_documents_owner_id_idx on public.project_documents (owner_id);

alter table public.project_documents enable row level security;

drop policy if exists "Owner can manage own project documents" on public.project_documents;
create policy "Owner can manage own project documents"
  on public.project_documents for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Base-table GRANT — RLS restricts rows but Postgres checks table privilege
-- first, so without this every request 42501s before any policy runs (the
-- same gap fixed for houses in 0005 and repeated since: 0019, 0029, 0031,
-- 0034, 0035, 0037, 0039, 0045; fixed proactively for projects in 0048).
grant select, insert, update, delete on public.project_documents to authenticated;

-- ── Storage: one bucket, path-namespaced by owner_id/project_id ─────────
-- Private (public = false): every read goes through RLS below, never a
-- public URL. 10MB/file (plans/active/business-mode/04-document-upload.md's
-- own example cap) enforced here as a belt on top of the app's own check —
-- Supabase Storage supports a per-bucket file_size_limit natively.
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-documents', 'project-documents', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- storage.objects RLS is enabled by default project-wide (Supabase's
-- standard, not something this migration turns on) — only the policy is new.
drop policy if exists "Owner can manage own files in project-documents" on storage.objects;
create policy "Owner can manage own files in project-documents"
  on storage.objects for all
  using (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
