# Phase 2 — Business-mode prompt/persona variants

**Delivers:** when `workspace_mode = 'business'`, both the House Builder and
the reasoning pipeline frame their questions and outputs around business
concerns — stakeholders instead of generic "perspectives," market/unit-economics
evidence framing, runway/hiring/fundraising implications. Same underlying
code path in both cases; no forked pipeline (decision 021 §4).

## Collab builder

- `lib/ai/prompts.ts` holds the shared persona + capability blocks. Add a
  `workspaceMode` parameter threaded through the functions that build these
  blocks; add a business-mode variant block alongside the existing one,
  reusing the same structure (same sections, different examples/framing).
- `lib/ai/router.ts`'s callers (`app/api/ai/suggest`, interviewer,
  research, critic) pass the caller's `workspace_mode` through. Read it
  once per request from the authenticated user's profile — do not trust a
  client-supplied value for anything that changes model behavior in a way
  that matters for cost or safety (same caution as any other server-trusted
  field, though this one carries no privilege).
- `05-interviewer.md`'s per-house AI context gains business-flavored
  interview questions (e.g. "who's the customer," "what's the current
  stage") when the owning project (if any) is in business mode.

## Reasoning pipeline

- Layer prompts in `01-layers-and-standards.md`'s implementation
  (wherever they're materialized in code — locate via that doc, don't
  guess the file) take the same `workspaceMode` parameter. Business framing
  affects the **Frame**, **Perspectives**, **Global evidence**, and
  **Implications** layers most; **Breadth-scoping**, **Global assumptions**,
  and **Final composition** likely need no change — confirm during
  implementation rather than touching layers that don't need it.
- The nine-agent review panel's standards (clarity, accuracy, precision,
  relevance, depth, breadth, logic, significance, fairness) are
  domain-neutral already — no change expected there.

## What does not change

- Every invariant in `plans/active/ai/README.md` — no AI-authored
  conclusions, explicit accept, Brave-only evidence, provenance marking,
  deterministic House Strength untouched by AI critique.
- Decision 019's "separate reasoning surface" framing and its non-touching
  of decisions 016/018.

## Manual verification

- Same house question run once in `general` and once in `business` mode
  (two test accounts/projects): confirm the framing differs but the
  invariants above hold identically in both — check the AI never proposes
  a conclusion/reasoning value directly, and every suggestion still
  requires an explicit accept.
- `npx tsc --noEmit`, `npm run build` pass; existing AI route tests
  (if any) pass for both modes.
