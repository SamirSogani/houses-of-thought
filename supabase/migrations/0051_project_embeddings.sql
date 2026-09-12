-- 0051_project_embeddings.sql
-- Phase 5 of business/solo-founder mode (decision 021,
-- plans/active/business-mode/05-rag-retrieval.md): RAG over accumulated
-- project data. Embeddings provider decided with Samir before writing this
-- (the plan doc's own "open decision this phase cannot skip"): DeepInfra
-- (already an integrated vendor — reuses DEEP_INFRA_API_KEY, no new vendor
-- relationship; zero-retention/no-training-without-consent policy), model
-- BAAI/bge-m3, which is why the vector column below is 1024-dim, not the
-- 1536 in the plan doc's own placeholder schema (sized for OpenAI's models).
--
-- Scope decision for this pass, flagged not silent (see lib/ai/rag.ts's
-- module header): only source_type='document' is actually ingested here.
-- 'project_context' is deliberately NOT embedded — Phase 3 already injects
-- it directly and in full (it's small; retrieval would be redundant at this
-- scale). 'house' embeddings are schema-supported (the CHECK constraint
-- allows it, so nothing blocks adding this later) but no ingestion path
-- exists yet — a real future step, not built speculatively here.
-- Idempotent.

create extension if not exists vector;

create table if not exists public.project_embeddings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('project_context', 'house', 'document')),
  source_id   uuid,              -- house_id or project_documents.id; null for project_context
  chunk_text  text not null,
  chunk_index int not null default 0,
  embedding   vector(1024),      -- BAAI/bge-m3 via DeepInfra
  created_at  timestamptz not null default now()
);

create index if not exists project_embeddings_project_id_idx on public.project_embeddings (project_id);
create index if not exists project_embeddings_source_idx on public.project_embeddings (source_type, source_id);

alter table public.project_embeddings enable row level security;

drop policy if exists "Owner can manage own project embeddings" on public.project_embeddings;
create policy "Owner can manage own project embeddings"
  on public.project_embeddings for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Base-table GRANT — RLS restricts rows but Postgres checks table privilege
-- first (the repeated gap this repo keeps re-learning: 0005, 0019, 0029,
-- 0031, 0034, 0035, 0037, 0039, 0045; fixed proactively for projects/
-- project_documents in 0048/0050).
grant select, insert, update, delete on public.project_embeddings to authenticated;

create index if not exists project_embeddings_vector_idx
  on public.project_embeddings using ivfflat (embedding vector_cosine_ops);

-- Vector similarity search isn't expressible through PostgREST's normal
-- filter/order query shape (no `<=>` operator support), so retrieval goes
-- through this RPC instead — the standard Supabase pattern. SECURITY INVOKER
-- (explicit, though it's Postgres's default — same convention as the
-- save_house RPC, context/architecture/data-model/app-level-shapes.md):
-- this function grants no new access. The `owner_id = auth.uid()` clause
-- inside is defense-in-depth on top of the table's own RLS (which still
-- applies, since this runs as the caller) — belt-and-suspenders against ever
-- returning another user's chunks, per the plan doc's explicit "never a
-- global cross-user or cross-project similarity search."
create or replace function public.match_project_embeddings(
  p_project_id uuid,
  p_query_embedding vector(1024),
  p_match_count int default 5
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  chunk_text text,
  similarity float
)
language sql stable security invoker
as $$
  select
    id,
    source_type,
    source_id,
    chunk_text,
    1 - (embedding <=> p_query_embedding) as similarity
  from public.project_embeddings
  where project_id = p_project_id
    and owner_id = auth.uid()
  order by embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- RLS/table GRANTs don't cover function EXECUTE — same class of gap as the
-- base-table grant above, just for a different privilege.
grant execute on function public.match_project_embeddings(uuid, vector, int) to authenticated;
