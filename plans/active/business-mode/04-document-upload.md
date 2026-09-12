# Phase 4 — Per-project document upload

**Delivers:** a user can attach documents (pitch decks, notes, financials)
to a Project; text is extracted and stored, ready for Phase 5's embedding
and retrieval. This phase does **not** wire retrieval into house-building —
that's Phase 5, kept separate because it's the phase with genuine unknowns
(parsing quality, provider choice).

## Open questions to resolve before writing code (do not assume)

- **Parsing library/approach.** No document-parsing dependency exists in
  this codebase today. Text-first for v1 (plain text, `.md`, extractable-text
  PDFs); scanned/image-only PDFs are out of scope (README). Evaluate
  options against `package.json`'s existing dependency footprint before
  adding one.
- **Size/type limits.** Needs a hard cap (e.g. 10MB/file, N files/project)
  before this is exposed publicly — unbounded upload is a storage-cost and
  abuse surface with no existing precedent in this app to copy.
- **Where files live.** Supabase Storage, one bucket
  (e.g. `project-documents`), path-namespaced by `owner_id`/`project_id` so
  storage policies can mirror the `projects` RLS pattern without a lookup
  join on every request.

## Schema

```sql
create table if not exists project_documents (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  filename    text not null,
  mime_type   text not null,
  storage_path text not null,
  status      text not null default 'pending' check (status in ('pending', 'parsed', 'failed')),
  extracted_text text,
  error       text,
  created_at  timestamptz not null default now()
);

alter table project_documents enable row level security;

create policy "Owner can manage own project documents"
  on project_documents for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

Storage bucket policies follow the same `owner_id = auth.uid()` shape,
scoped to the bucket's path prefix — write these alongside the migration,
not as an afterthought (Supabase Storage RLS is a distinct policy surface
from table RLS; `context/architecture/data-model/access-control.md` has no
existing Storage bucket to model this on, so this is genuinely new ground
for this repo — read Supabase's own Storage RLS docs when implementing,
don't assume table-RLS syntax carries over unchanged).

## Parsing pipeline

- Upload → Storage → a server route (or background job, if upload volume
  ever justifies one — not needed at v1 scale) extracts text and writes
  `extracted_text`, flips `status`.
- Failure is a first-class state (`status = 'failed'`, `error` populated) —
  surfaced to the user, not silently dropped. Matches this app's existing
  posture on AI/pipeline failures (visible `haltReason`, not silent stalls).

## Manual verification

- Upload a small synthetic `.txt`/`.md` test file (never a real business
  document during development — see the README's risk note); confirm it
  parses and `extracted_text` is populated.
- Confirm RLS/Storage policy blocks fetching another user's document by
  guessing/enumerating a storage path.
- Oversized/wrong-type upload is rejected with a clear error, not a
  silent failure.
