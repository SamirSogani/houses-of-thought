# Phase 3 — Perspectives, Assumptions, Implications

**Delivers:** the three remaining domains on the same engine Phase 2
proved with Research. No new route, no new page — only prompt/schema
additions to the domain config.

## Starting shapes (not final — confirm against current contracts.ts at
## implementation time, this doc predates any code written against them)

- **Perspectives**: one subject, not an n-stance fan-out — a single
  generation covering "what are the distinct standpoints on this,"
  structurally lighter than the house pipeline's
  `runPerspectivesGenerateStances` (which generates one stance per
  candidate viewpoint label from a Breadth Scoping step this domain doesn't
  have). Do not port Breadth Scoping into this domain — the founder's
  prompt *is* the scoping.
- **Assumptions**: mirrors the Perspectives layer's assumptions
  sub-element (`PERSPECTIVE_ASSUMPTIONS_BLOCK`, `prompts.ts`) but scoped to
  the project's context rather than one stance's frame.
- **Implications**: mirrors `ImplicationsPacketSchema`
  (`contracts.ts:450`) — same 2-8 item shape, same "so what does this
  mean" framing, applied to the project's accumulated context instead of a
  house's conclusion.

Each still goes through the same `runReviewPanel` + regeneration loop from
Phase 2 — no domain gets a lighter or heavier bar than another.

## What to reuse vs. write fresh

Prefer reusing existing prompt-building helpers (`prompts.ts`) parameterized
with project context in place of house/frame context, over writing new
prompt strings from scratch — same spirit as decision 021 §4. If a helper
genuinely can't take a project-shaped input without forking its house-only
logic, write a new one rather than bending the existing one — don't force a
fit that adds a silent branch to shared code.

## Manual verification

- One successful run per domain, each landing in that domain's history on
  the right project.
- Spot-check that Assumptions and Implications results read as genuinely
  project-scoped (reference the project's stage/customer/facts), not
  generic boilerplate that ignores the context that was passed in.
- `npx tsc --noEmit` and `npm run build` pass.
