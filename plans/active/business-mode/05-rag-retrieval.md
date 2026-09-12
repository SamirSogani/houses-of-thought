# Phase 5 — RAG retrieval over accumulated project data

**Delivers:** house-building (both Collab and the reasoning pipeline) can
pull relevant chunks from a project's accumulated context, past houses, and
uploaded documents, surfaced as a distinct, labeled context input — never as
Research Mode evidence (decision 021 §5).

## The open decision this phase cannot skip

**No embeddings provider is configured anywhere in this stack.** This app
uses Groq and DeepInfra for chat completions ([decisions
012](../../../decisions/012-groq-tiered-failover.md),
[020](../../../decisions/020-deepinfra-swarm-synthesis-lanes.md)) — neither
call is an embeddings call today. Before writing retrieval code, pick a
provider and confirm:
- It offers an embeddings endpoint (check DeepInfra's catalog first, since
  it's already an integrated vendor — avoids a third relationship if it
  covers this).
- Its data-retention/training-use terms are acceptable for **business
  documents that may be confidential** — a higher bar than the general
  reasoning text this app already sends to model providers.
- Cost per embedding at expected chunk volumes.

This is a product/vendor decision, not an implementation detail — surface it
to Samir before building, don't default silently to whichever provider is
easiest to wire up.

## Schema

```sql
create extension if not exists vector;

create table if not exists project_embeddings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('project_context', 'house', 'document')),
  source_id   uuid,              -- house_id or project_documents.id; null for project_context itself
  chunk_text  text not null,
  chunk_index int not null default 0,
  embedding   vector(1536),      -- dimension depends on the chosen provider/model
  created_at  timestamptz not null default now()
);

alter table project_embeddings enable row level security;

create policy "Owner can manage own project embeddings"
  on project_embeddings for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index if not exists project_embeddings_vector_idx
  on project_embeddings using ivfflat (embedding vector_cosine_ops);
```

Chunking strategy (size, overlap) is an implementation detail to tune once a
provider's context/token limits are known — don't hard-code a chunk size in
this doc that predates that choice.

## Retrieval wiring

- **Scope every query to `project_id` (and therefore `owner_id`).** Never a
  global cross-user or cross-project similarity search — a solo founder's
  Project A must not leak into Project B's house-building, let alone
  another user's data.
- Retrieval point: the reasoning pipeline's Context-gather layer (the
  existing pre-frame/post-frame hook already designed to inject context,
  per `plans/active/reasoning-pipeline/README.md`'s architecture diagram)
  and the Collab builder's interviewer step (`05-interviewer.md`). Reuse
  these existing injection points rather than adding new ones.
- Retrieved chunks are packaged with explicit source attribution
  (`source_type` + originating document/house title) and surfaced to the
  user as their own material — same spirit as evidence provenance
  (`owner: 'ai'` / `byAI: true` marking), extended with a `fromUserData:
  true`-style tag so it's never visually confused with Brave-cited
  evidence in the UI.
- If a retrieved chunk is proposed as house evidence (not just background
  framing), it still goes through the existing explicit-accept flow like
  any other AI-surfaced content — Phase 5 does not add a new
  auto-accept path.

## Manual verification

- Two projects with distinct uploaded documents: confirm a house built
  under Project A only ever retrieves Project A's chunks.
- UI clearly distinguishes RAG-sourced context from Brave-sourced Research
  Mode evidence in at least one real screen, not just in data shape.
- Turning `workspace_mode` off (Phase 1's toggle) stops retrieval from
  running at all — confirm no embedding-generation cost is incurred for
  `general`-mode users regardless of whether they have projects.
