# Plan — Founder Mode (Projects, accumulating context, RAG)

**Scoped:** 2026-09-11 · **Status:** All 5 phases shipped and merged to main
2026-09-11 (migrations 0048–0051 applied).
**Implements:** [decision 021](../../../decisions/021-business-mode-projects-and-rag.md),
which also records why this is an opt-in extension rather than a reversal of
the schools-first strategy in
[context/vision/product-strategy.md](../../../context/vision/product-strategy.md)
— see that decision for the **Founder Mode** product-name note (decided
2026-09-11, end of the implementation session). This doc and the phase docs
below still use the working name "business mode" throughout; that's the
same feature.

## Mission

Give standard accounts an opt-in **business/solo-founder mode**: a settings
toggle that (1) reframes AI prompts in both the House Builder and the
reasoning pipeline around business concerns, (2) groups houses under real
**Projects** that accumulate structured context over time, and (3) retrieves
that accumulated context — including uploaded documents — into new houses via
RAG, as a distinct, provenance-tagged input alongside (never instead of)
existing Research Mode evidence.

## Non-negotiable invariants (hold in every phase)

Everything in [plans/active/ai/README.md](../../ai/README.md) §"Non-negotiable
invariants" still applies without exception. In addition:

1. **`workspace_mode` gates framing only, never access.** No RLS policy, no
   server-side capability check (`capabilitiesFor`, `lib/auth/account.ts`)
   may branch on it. It is exactly as privileged as `about_me`.
2. **Retrieved context is labeled, not laundered.** Anything pulled in via
   RAG is tagged with its source project/document and surfaced to the user
   as "from your own material" — never merged into or displayed as
   Brave-verified Research Mode evidence.
3. **One pipeline, one builder.** Business mode changes prompt inputs and UI
   copy, not a second code path. If a change can't be expressed as a
   parameter/variant, stop and reconsider before forking anything.
4. **Off by default, fully reversible.** Turning the toggle off returns a
   user to exactly today's experience; no data is deleted, just unused.

## Phases — execute in order; each is independently shippable

| Phase | Doc | Delivers | Status |
|---|---|---|---|
| 1 | [01-projects-and-toggle.md](01-projects-and-toggle.md) | `workspace_mode` toggle + `projects` table/CRUD UI + houses linkable to a project. No AI changes. | ✅ Shipped (migration 0048) |
| 2 | [02-business-prompts.md](02-business-prompts.md) | Business-mode prompt/persona variants in Collab and the reasoning pipeline. | ✅ Shipped (no schema change) |
| 3 | [03-accumulating-context.md](03-accumulating-context.md) | Structured per-project context (facts, stage, stakeholders) that accumulates across sessions and feeds AI framing. | ✅ Shipped (migration 0049) |
| 4 | [04-document-upload.md](04-document-upload.md) | Per-project document upload (Supabase Storage) + text extraction. | ✅ Shipped (migration 0050) |
| 5 | [05-rag-retrieval.md](05-rag-retrieval.md) | `pgvector` embeddings + retrieval wired into house-building, with provenance tagging. | ✅ Shipped (migration 0051; DeepInfra/BAAI/bge-m3) |

Phases 1–3 have no new external dependencies and no meaningful cost surface.
Phases 4–5 introduce file storage, a parsing step, and a third-party
embeddings call per document/query — treat that as a real go/no-go
checkpoint after Phase 3, not an assumption that all five phases ship in one
push.

## Execution protocol (for a fresh session)

- Read this README, then only the phase doc(s) for the phase being executed
  — each doc lists exactly the files to read and modify.
- After each phase: `npx tsc --noEmit` and `npm run build` must pass; run
  the doc's manual checks against `npm run dev`; tick the phase here; commit.
- Every new migration runs against the shared dev/prod database
  ([context/architecture/data-model/index.md](../../../context/architecture/data-model/index.md))
  — write additively/idempotently, and for phases 4–5 use synthetic test
  data, never real business documents, during development.

## Out of scope (deliberate — do not build)

Team/multi-seat business accounts, billing, project collaborators, OCR or
scanned-document support, non-English document parsing, exposing
`workspace_mode` to teacher/student accounts, any change to Research Mode's
"Brave-only evidence" invariant.

## Risk note

Phases 4–5 add real per-document cost (parsing + embeddings) and a new data
sensitivity tier (uploaded business material, possibly confidential) beyond
anything else in this app. Do not enable document upload publicly without
per-project quotas and a clear answer to the embeddings-provider data
handling question raised in
[05-rag-retrieval.md](05-rag-retrieval.md).
