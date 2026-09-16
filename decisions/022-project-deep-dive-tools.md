# Decision 022 — Project Deep Dive tools (Perspectives, Assumptions, Research, Implications)

**Date:** 2026-09-15
**Status:** Decided — implementation not started. Plan:
[plans/active/project-deep-dives/](../plans/active/project-deep-dives/README.md).

## Context

[Decision 021](021-business-mode-projects-and-rag.md) (Founder Mode) made Projects
a real container: accumulating context (stage/customer/business model/key
facts) and RAG over project documents + past houses, both scoped to
`project_id`. But project-level knowledge only ever moves passively — key
facts accumulate *from* a house's Review layer, RAG pulls project material
*into* a new house. There's no way to actively research or reason at the
project level itself, independent of any single house's framed question.

Samir asked (2026-09-15) for a small set of project-level tools — reachable
from the Project page, not from inside a house — for when a founder wants
one specific aspect of deep thinking (e.g. "research for a debate case")
without running the full per-house pipeline (Frame → Perspectives →
Review → Critique).

## Decisions made

1. **Four fixed tools, not an extensible registry.** Perspectives,
   Assumptions, Research, Implications. No plugin system, no admin UI to add
   a fifth later — that's explicitly out of scope for now (see Deferred).
   Because the set is small and fixed, this is one parameterized "Deep Dive"
   engine/page template with a 4-value domain config
   (`'perspectives' | 'assumptions' | 'research' | 'implications'`), not four
   bespoke routes/components — the same "one pipeline, parameterized, not
   forked" discipline decision 021 §4 already applies to the house pipeline,
   extended to this new surface.
2. **These are new entry points into existing machinery, not new
   capabilities.**
   - **Research** extends Research Mode as it exists today inline in a house
     ([ResearchResults.tsx](../components/build/layers/ResearchResults.tsx),
     Brave-backed search via `/api/ai/research`) — re-pointed to read a
     project's key facts/description instead of house state. Deliberately
     named "Research" rather than "Evidence" in the UI to avoid colliding
     with the Perspectives layer's own internal "evidence" sub-element
     vocabulary (`EvidenceStrategySchema` etc., `contracts.ts`) — a
     different, project-scoped thing wearing a similar word.
   - **Perspectives, Assumptions, Implications** each run one generation
     scoped to the project's accumulated context (not a house's Frame),
     using the corresponding existing schema/prompt family
     (`PerspectiveStanceSchema`, the Perspectives layer's assumptions
     sub-element, `ImplicationsPacketSchema`) as the starting shape, then go
     through step 3 below. None of these fan out per-perspective the way the
     house pipeline's Perspectives layer does (n stances) — one subject in,
     one panel-reviewed artifact out.
3. **Full quality bar, unchanged from the house pipeline — deliberate, not
   an oversight.** Every Deep Dive result goes through the real 9-standard
   review panel (`runReviewPanel`, `orchestrator-panel.ts`) with the same
   bounded regeneration loop (`MAX_REGENERATION_ATTEMPTS` = 3 +
   `MASTER_REVIEW_ATTEMPT`, `budget.ts`). This costs more than the "quick
   aspect, not the full pipeline" framing might suggest — accepted for now
   because results can be saved into permanent project facts and should
   clear the same bar those do. A cheaper/faster loop variant is explicitly
   deferred, not designed here (see Deferred).
4. **Write-back follows the existing rule, unchanged.** Same as houses: the
   AI never auto-writes to project key facts. Each Deep Dive result gets its
   own explicit "Save to project" action, mirroring the existing
   `SaveFactsToProjectButton` pattern — no new exception to
   [plans/active/ai/README.md](../plans/active/ai/README.md)'s "AI never
   writes the conclusion" invariant.
5. **Per-tool history, scoped to project + domain.** Each of the 4 boxes
   keeps its own running history of past prompts/results for that project —
   a new table, RLS mirroring `projects`/`houses`
   (`owner_id = auth.uid()`), no cross-project or cross-user visibility.
6. **Entry point: 4 boxes at the bottom of the Project detail page**
   ([app/projects/[id]/page.tsx](../app/projects/[id]/page.tsx)), each
   linking to a domain-parameterized Deep Dive page. `houses.project_id`
   and the house pipeline are untouched — this is additive, not a
   replacement for anything.
7. **`workspace_mode` invariant holds unchanged** (decision 021 §2): this
   entire surface lives inside Founder Mode, gates UI only, never access.

## Consequences

- New migration for the history table (next number: 0052) — additive,
  Phase 1 of the plan. Same shared-dev/prod-database caution as every prior
  Founder Mode migration: synthetic test data only during development.
- New per-run cost surface on top of the pipeline's existing one: smaller
  than a full house run (no n-perspective fan-out) but not trivial, given
  decision 3's full review-panel-and-loop. No quota exists yet — same gap
  decision 021 already flagged for the pipeline generally.

## Deferred / open

- **Cheaper review-loop variant for Deep Dive results** — explicitly
  parked, not designed now. Revisit once real usage shows whether the full
  9-reviewer/loop bar is worth its cost for this lighter surface.
- Extending beyond the 4 fixed tools (not in scope now — decision 1).
- Exact schema reuse for Perspectives/Assumptions/Implications: whether
  they literally reuse the house pipeline's Zod schemas as-is or need their
  own lighter project-scoped variants is an implementation-time question,
  not decided here.
