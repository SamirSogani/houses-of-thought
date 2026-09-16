// Per-domain, per-standard review criteria for the Project Deep Dive engine
// (decision 022, plans/active/project-deep-dives/02-generation-engine.md).
// Same idea as standards.ts's LAYER_STANDARD_CRITERIA — what each of the nine
// Paul-Elder standards actually means for THIS specific artifact — but keyed
// by DeepDiveDomain instead of ReviewGateStep, since Deep Dive runs outside
// the house pipeline's own closed, compile-time-exhaustive step sequence
// (lib/ai/reasoning/steps.ts's STEP_ORDER/ReviewGateStep is tied to that
// pipeline's own routing and must not gain entries for this feature — see
// decision 022 Phase 2's brief). runReviewPanelWithCriteria
// (orchestrator-panel.ts) takes a plain `Record<StandardId, string>`, so this
// file only has to supply that map per domain, not thread a new step id
// through the shared panel machinery.
//
// Only 'research' is filled in this phase — Perspectives/Assumptions/
// Implications are Phase 3 (plans/active/project-deep-dives/
// 03-remaining-domains.md). Partial<...> lets the other three stay absent
// rather than forcing placeholder criteria for domains with no generation
// logic yet; criteriaForDeepDiveDomain below is the one place that turns a
// missing entry into a clear, early error instead of a silent undefined
// reaching buildReviewerPrompt.

import type { StandardId } from './contracts'
import { STANDARD_IDS } from './contracts'
import type { DeepDiveDomain } from '@/lib/projects/deepDives'

// The Research domain's artifact is a synthesized writeup: an array of
// candidate evidence items (claim, quoteOrParaphrase, sourceTitle, url) drawn
// from this run's own real Brave search results and grounded in the
// project's accumulated context — the same shape Research Mode's
// ResearchResults.tsx already shows (claim/quoteOrParaphrase/sourceTitle/url),
// reused here rather than invented fresh. Unlike a house's Frame or
// Perspectives artifact, there is no "argue a stance" or "pose a question"
// job here — the job is: ground real, checkable evidence in what the founder
// actually asked, scoped to what's already known about their project.
const RESEARCH_CRITERIA: Record<StandardId, string> = {
  clarity:
    'Is each claim stated as one plain, understandable assertion — no vague hedging about what it actually shows — and does quoteOrParaphrase make it obvious exactly what in the source backs that claim?',
  accuracy:
    "Does each claim faithfully represent what its own quoteOrParaphrase actually says, without overstating certainty, dropping a caveat the source itself states, or asserting something the cited material doesn't support?",
  precision:
    "Are claims specific to THIS project's prompt and context — not generic, could-apply-to-any-founder statements — and does sourceTitle/url point at one identifiable real source rather than a vague gesture at 'research shows'?",
  relevance:
    "Does each candidate actually bear on the prompt as asked, read against the project's own context (stage/customer/business model/key facts), rather than being evidence the search surfaced that doesn't actually answer what was asked?",
  depth:
    'Do the candidates collectively engage the substantive, non-obvious part of the prompt — not just the easiest surface-level fact the first search result offered?',
  breadth:
    'Do the candidates draw on a genuine spread of sources/angles on the prompt, rather than resting on one source repeated or one narrow slice of the question?',
  logic:
    'Does each claim actually follow from its own cited quote/paraphrase, without an unjustified leap to something the source only loosely implies?',
  significance:
    "Do the candidates focus on what would actually matter most to the founder's prompt and their project's real situation, not a minor or tangential fact that happened to turn up?",
  fairness:
    'Where the search results include material cutting more than one way on a debatable point, do the candidates represent that honestly rather than cherry-picking only the evidence for one side?',
}

// Partial by design — see this file's header comment. Add 'perspectives' /
// 'assumptions' / 'implications' here in Phase 3, one domain at a time, same
// as this entry.
export const DEEP_DIVE_STANDARD_CRITERIA: Partial<Record<DeepDiveDomain, Record<StandardId, string>>> = {
  research: RESEARCH_CRITERIA,
}

// Defensive, same discipline as standards.ts's own module-load check: every
// domain that DOES have an entry must define all 9 standards — throws at
// import time rather than shipping a gap that only surfaces mid-review.
for (const [domain, criteria] of Object.entries(DEEP_DIVE_STANDARD_CRITERIA)) {
  for (const id of STANDARD_IDS) {
    if (!criteria?.[id]?.trim()) {
      throw new Error(`Missing Deep Dive criterion: ${domain} / ${id}`)
    }
  }
}

// The one place a "domain not yet implemented" gap becomes a clear thrown
// error instead of undefined criteria silently reaching buildReviewerPrompt.
// Safe today because only 'research' is reachable from the UI (Phase 1's
// DEEP_DIVE_DOMAINS lists all four, but app/api/ai/deep-dive/route.ts itself
// already refuses non-research domains before ever calling this) — this is
// the belt to that route's own suspenders.
export function criteriaForDeepDiveDomain(domain: DeepDiveDomain): Record<StandardId, string> {
  const criteria = DEEP_DIVE_STANDARD_CRITERIA[domain]
  if (!criteria) {
    throw new Error(`Deep Dive domain not yet implemented: ${domain}`)
  }
  return criteria
}
