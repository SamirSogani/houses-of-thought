# Phase 4 — Save to project

**Delivers:** the explicit "Save to project" action on a completed Deep
Dive result, wiring it into the project's key facts. No auto-write, no new
storage path — reuses the existing accumulating-context mechanism verbatim.

## Behavior

- A `done` Deep Dive result gets a "Save to project" button per
  extractable fact (or per whole result, if the domain's result isn't
  naturally fact-shaped — decide per domain, e.g. Research candidates save
  individually like `ResearchResults.tsx`'s per-item Add, while an
  Implications packet's items save the same way).
- On click: call `appendProjectContextFacts` (`lib/projects/data.ts:219`)
  — the exact function houses' Review layer already uses via
  `SaveFactsToProjectButton`. No new write path, no new dedupe/cap logic
  (`MAX_KEY_FACTS`, `mergeKeyFacts` already handle that).
- Mark the source row `saved_to_project = true` so the history view can
  show which results were already folded in, without re-deriving that from
  the project's `keyFacts` array (which doesn't carry provenance back to
  the run that produced it).
- Saved facts are indistinguishable from house-sourced facts once in
  `keyFacts` — same as decision 021 intended: it's all "the project's
  accumulated context," not tagged by origin. If Samir wants provenance on
  individual key facts later, that's a new decision, not assumed here.

## Manual verification

- Save a fact from a Deep Dive result; confirm it appears on
  `/projects/[id]`'s Key facts section immediately (same list the project
  page already renders) and is removable there exactly like any other fact.
- Confirm a fact saved from a Deep Dive, then removed on the project page,
  does not silently reappear — `saved_to_project` on the source row stays
  `true` (it records that a save happened, not that the fact still exists).
- `npx tsc --noEmit` and `npm run build` pass.
