# Decision 021 — Business/solo-founder mode, Projects, and RAG over user data

**Date:** 2026-09-11
**Status:** Planned — not yet implemented. Full spec:
[plans/active/business-mode/](../plans/active/business-mode/README.md).

## Context

[context/vision/product-strategy.md](../context/vision/product-strategy.md)
and the 2026-07-07 strategy session (recorded only in memory, not previously
in-repo) settled on: schools are the go-to-market wedge, B2B/teams is fully
deferred, individuals are "welcome, not targeted." Samir asked (2026-09-11)
for the workflow to be optimized for businesses/solo founders — a toggleable
specialized mode, accumulating user/project data, RAG over that data when
building houses, and a Projects section.

Asked explicitly whether this reopens the B2B-deferred stance: Samir chose
**deliberate pivot — invest for real**, scoped to **both** the House Builder
and the reasoning pipeline, with Projects as a **real multi-project entity**
and RAG **including document upload**.

## Decisions made

1. **Opt-in segment, not a strategy replacement.** Schools remain the
   default and the primary product. Business mode is a self-serve toggle,
   off by default — an extension of "individuals welcome," not a new
   go-to-market motion. No B2B seats, team billing, or multi-seat accounts
   are in scope; that part of the original deferral stands untouched.
2. **`workspace_mode` is a preference, not a privilege.** New column on
   `profiles`, self-editable like `about_me`. Unlike `account_type`
   (`standard`/`student`/`teacher` — a capability gate with a real
   privilege-escalation incident behind it, see
   [audits/2026-07-19/06-security.md](../audits/2026-07-19/06-security.md)
   §C1), `workspace_mode` gates nothing security-relevant — only AI framing
   and which UI sections render. It must never be read by an RLS policy or a
   server-side capability check the way `account_type` is.
3. **Projects are a first-class, single-owner entity.** New `projects`
   table, RLS mirrors `houses` (`owner_id = auth.uid()`,
   [decisions/002](002-house-schema.md)/[003](003-collaboration-model.md)'s
   single-owner pattern — no project collaboration in v1).
   `houses.project_id` is a nullable FK so existing and school houses are
   unaffected.
4. **One pipeline, parameterized — not forked.** Business framing is a
   prompt/persona variant keyed by `workspace_mode`, applied in both
   `lib/ai/prompts.ts` (Collab) and the reasoning pipeline's layer prompts
   ([decision 019](019-multi-agent-reasoning-pipeline.md)). No second copy
   of either system. Every non-negotiable invariant in
   [plans/active/ai/README.md](../plans/active/ai/README.md) holds
   unchanged in business mode — the AI still never writes the conclusion,
   every item still needs an explicit accept, provenance is still marked.
5. **RAG is additive context, not evidence.** Retrieval over a user's own
   projects/documents produces a distinctly provenance-tagged context block
   (`source: 'user-data'`), never merged with or presented as Brave-verified
   Research Mode evidence (`plans/active/ai/06-research-mode.md`'s "Brave
   Search as the only source of evidence" invariant is about externally
   verified claims; it is unchanged — RAG is a new, separate context input,
   clearly labeled as the user's own material, not independent verification).
6. **Storage stays inside the existing Supabase stack.** Document upload
   uses Supabase Storage; embeddings use Postgres `pgvector` (Supabase
   supports it natively) rather than standing up a separate vector-DB
   vendor. Embedding *generation* still needs a provider decision — no
   embeddings API is configured anywhere in this stack today (open question,
   [05-rag-retrieval.md](../plans/active/business-mode/05-rag-retrieval.md)).

## Consequences

- New cost surface: embedding generation (per document, per query) and file
  storage, on top of the reasoning pipeline's existing per-run cost
  (~1.5–5¢, [houses-of-thought-next-priorities memory]). Needs a per-project
  document/size quota before any public rollout — this product has stayed
  free with no rate-limiting built for the pipeline surface yet.
- **Shared dev/prod database risk, sharper here than usual.**
  [context/architecture/data-model/index.md](../context/architecture/data-model/index.md)
  already warns local dev and production share one Supabase project with no
  staging copy. Phases 1–3 (schema, toggle, prompts) carry the same risk as
  any other migration. Phases 4–5 (document upload, embeddings) are a step
  up: they write real files to Storage and send document content to a
  third-party embeddings API during ordinary local testing. Use clearly
  synthetic test projects/documents, and revisit whether this feature is the
  forcing function for a real staging environment before it ships broadly.
- `context/vision/product-strategy.md`'s "Secondary audience" section will
  need a follow-up amendment once Phase 1 ships, to record business/solo
  founders as a supported opt-in segment. Not edited by this decision —
  strategy docs describe what's actually shipped, not what's planned.

## Deferred / open

- Embeddings provider (no vendor configured in this stack today).
- Document parsing approach/library (text-first for v1; OCR/scanned docs
  out of scope).
- Per-project/document quotas and abuse limits.
- Whether `workspace_mode` is ever exposed to teacher/student accounts —
  assumption for v1 is **no**, standard accounts only; classrooms stay on
  the existing framing.
- The staging-environment question raised above is not resolved here.
