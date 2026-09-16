# Phase 2 — Generation engine, wired for Research first

**Delivers:** the domain-parameterized generate-and-review engine, proven
end to end on the **Research** domain before the other three (decision 022
§2: Research is the one that's explicitly an extension of existing
machinery, not new — cheapest to validate).

## Engine shape

One server route, `app/api/ai/deep-dive/route.ts`, taking
`{ deepDiveId }`:

1. Load the `project_deep_dives` row (pending, owner-checked) and its
   project's `ProjectContext` (`formatProjectContextLines`,
   `lib/projects/data.ts` — reused as-is, same "CONTEXT (from project)"
   framing Collab and the reasoning pipeline already use).
2. Run one domain-specific generation call (prompt below) — a single
   subject, not an n-perspective fan-out.
3. Run the result through `runReviewPanel` (`orchestrator-panel.ts`) with
   the existing bounded-regeneration loop
   (`MAX_REGENERATION_ATTEMPTS`, `MASTER_REVIEW_ATTEMPT` — `budget.ts`),
   unchanged from how the house pipeline uses them (decision 022 §3 — do
   not build a cheaper variant here).
4. Write `result` + `status: 'done'`, or `status: 'error'` if the panel
   loop still fails after the master-review attempt.

## Research domain

- Reuses `runSearches` (`lib/ai/reasoning/search.ts`, the same Brave-backed
  search Research Mode already calls) with the deep dive's `prompt` as the
  query and the project's context lines as framing, instead of house state.
- Candidate evidence shape mirrors `ResearchResults.tsx`'s `Candidate`
  (claim, quote/paraphrase, source title, URL) — same "Brave-verified
  evidence, not laundered as anything else" invariant Research Mode already
  holds (`plans/active/ai/06-research-mode.md`).
- Panel-reviews the synthesized writeup, not each individual candidate link.

## UI

- Deep Dive page (from Phase 1) polls or re-fetches on submit; `pending`
  moves to `done`/`error` once the route above finishes.
- Show panel-loop status honestly if it's regenerating (reuse whatever copy
  pattern the house pipeline's rail already uses for "revising" — don't
  invent new copy for the same state).

## Manual verification

- Submit a Research prompt on a project with existing key facts; confirm
  the project's context actually reaches the search/synthesis call (check
  the request payload, same way `03-accumulating-context.md` verified
  `extraContext`).
- Force a panel failure (e.g. temporarily lower a reviewer threshold in a
  local test) and confirm the regeneration loop and eventual `error` status
  behave the same as the house pipeline's, not a silently different path.
- `npx tsc --noEmit` and `npm run build` pass.
