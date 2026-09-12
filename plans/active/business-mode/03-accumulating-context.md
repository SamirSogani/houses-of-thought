# Phase 3 — Accumulating per-project context

**Delivers:** a structured, editable "what this project is" record on each
Project that grows over time and feeds AI framing for every house built
under it — the per-project analog of `profiles.perspectives`'s existing
Personal Foundational POV pattern, and the natural target for Phase 5's RAG
once documents exist.

## Schema

Extend `projects` (from Phase 1) with a jsonb column:

```sql
alter table projects
  add column if not exists context jsonb not null default '{}'::jsonb;
```

Shape (app-level, not enforced by a DB constraint — same convention as
`profiles.perspectives` and the house builder's `State`, per
`context/architecture/data-model/app-level-shapes.md`):

```ts
type ProjectContext = {
  stage?: string          // e.g. "idea", "pre-seed", "revenue"
  customer?: string
  businessModel?: string
  keyFacts: string[]      // free-form accumulated facts, most recent last
  updatedAt: string
}
```

## How it accumulates

- Direct edit: a form on `/projects/[id]` for the structured fields.
- Passive accumulation: when a house under a project reaches its Review
  layer (or the reasoning pipeline's Final composition), surface a
  one-click "save to project context" affordance for durable facts the
  house surfaced — explicit user action, not automatic scraping. This
  keeps the same explicit-accept spirit as every other AI-adjacent write
  in this app (decision 021 §4's "one pipeline, one builder" invariant is
  about code paths, not about silently writing state without the user
  choosing to).
- `keyFacts` is append-only from the UI's perspective; capping/pruning is
  an implementation detail, but do not let it grow unbounded into every
  prompt — Phase 3 should decide a simple cap (e.g. last N facts) before
  Phase 5 makes this retrievable at scale instead of always-injected.

## Wiring into prompts

- Phase 2's `workspaceMode`-aware prompt builders also accept the owning
  project's `context` (when present) and fold it into the same per-house
  AI context that `05-interviewer.md` already establishes — this is an
  extension of an existing mechanism, not a new injection point.

## Manual verification

- Editing project context persists and reloads correctly.
- A house built under a project with context populated visibly reflects it
  in AI-generated framing (spot-check one interview question, one
  co-pilot suggestion).
- A house with no project, or a project with empty context, behaves
  exactly as before this phase.
