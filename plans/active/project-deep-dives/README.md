# Plan — Project Deep Dive tools

**Scoped:** 2026-09-15 · **Status:** Not started
**Implements:** [decision 022](../../../decisions/022-project-deep-dive-tools.md),
which has the full rationale — read that first, this doc is execution only.

## Mission

Give Founder Mode projects four fixed, project-scoped tools — Perspectives,
Assumptions, Research, Implications — for when a founder wants one specific
aspect of deep thinking without running the full per-house reasoning
pipeline. Each tool is a prompt box + running history, reads the project's
accumulated context, and can explicitly save results back into it.

## Non-negotiable invariants (hold in every phase)

Everything in [plans/active/ai/README.md](../../ai/README.md) and
[plans/active/business-mode/README.md](../../business-mode/README.md) still
applies. In addition, from decision 022:

1. **One engine, four configs — not four bespoke tools.** A domain enum
   (`'perspectives' | 'assumptions' | 'research' | 'implications'`) selects
   prompt/schema per box. Do not fork the page/route per domain.
2. **No auto-write.** Every save into project key facts is an explicit user
   action, never automatic — same rule as houses.
3. **Full review panel, every domain.** All four tools go through
   `runReviewPanel` and the existing bounded regeneration loop
   (`budget.ts`). Do not build a cheaper loop as part of this plan —
   decision 022 explicitly defers that.
4. **Project-scoped only.** No relation to `houses` beyond reading a
   project's accumulated context (`stage`/`customer`/`businessModel`/
   `keyFacts`) as input. `houses.project_id` and the house pipeline are
   untouched.

## Phases — execute in order; each is independently shippable

| Phase | Doc | Delivers |
|---|---|---|
| 1 | [01-schema-and-entry-points.md](01-schema-and-entry-points.md) | History table + RLS, 4 boxes on the Project page, Deep Dive page shell (prompt box + history list). No generation yet. |
| 2 | [02-generation-engine.md](02-generation-engine.md) | The domain-parameterized generate-and-review engine, wired to **Research** first (extends existing Research Mode — cheapest to validate end to end). |
| 3 | [03-remaining-domains.md](03-remaining-domains.md) | Perspectives, Assumptions, Implications on the same engine from Phase 2. |
| 4 | [04-save-to-project.md](04-save-to-project.md) | Explicit "Save to project" action wiring a Deep Dive result into project key facts. |

## Execution protocol

- Read this README, then only the phase doc for the phase being executed.
- After each phase: `npx tsc --noEmit` and `npm run build` must pass; run
  the doc's manual checks against `npm run dev`; tick the phase here;
  commit.
- The history-table migration (Phase 1) runs against the shared dev/prod
  database — write additively, use synthetic test projects during
  development, same caution as every Founder Mode migration before it.

## Out of scope (deliberate — do not build)

A fifth tool or a config UI to add one (decision 022 §1); a cheaper/faster
review loop for these tools (decision 022 §3, explicitly deferred); any
change to the house pipeline, Research Mode's Brave-only evidence
invariant, or `workspace_mode`'s framing-only scope.
