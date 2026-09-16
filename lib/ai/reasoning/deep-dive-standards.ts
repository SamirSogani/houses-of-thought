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
// All four domains are filled in as of Phase 3 (plans/active/
// project-deep-dives/03-remaining-domains.md) — 'research' shipped in Phase 2,
// 'perspectives'/'assumptions'/'implications' added here. Record<DeepDiveDomain,
// ...> is exhaustive by construction, same discipline as standards.ts's own
// LAYER_STANDARD_CRITERIA: a missing domain or standard is a type error, and
// the defensive loop below also catches an empty/blank string at module load.

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

// The Perspectives domain's artifact (deep-dive-perspectives.ts) is 2-6
// standpoints, each a label/summary/key_claims — one project-scoped subject,
// not an n-stance fan-out and with no Breadth Scoping step feeding it
// candidate labels (see that file's own header comment). Job: name AND argue
// distinct standpoints on the founder's prompt — not pose sub-questions, list
// assumptions, gather evidence, or draw implications; those are the other two
// Deep Dive domains' jobs.
const PERSPECTIVES_CRITERIA: Record<StandardId, string> = {
  clarity:
    "Is each standpoint's label a clear, specific name (not a vague pro/con tag), and does summary state one committed position rather than hedging across several?",
  accuracy:
    'Do key_claims represent real, defensible claims for that standpoint rather than a strawman or an overstated certainty no one holding this view would actually make?',
  precision:
    "Are label and key_claims specific to THIS project's own prompt and context, not generic pro/con boilerplate that could describe any founder's debate?",
  relevance:
    "Does each standpoint actually bear on the founder's prompt as asked, rather than arguing a tangential angle the prompt didn't raise?",
  depth:
    "Does each standpoint engage its strongest, most substantive form of the argument, not a shallow or superficial version of the view?",
  breadth:
    'Do the standpoints collectively span genuinely different angles on the prompt, rather than two rephrasings of the same underlying view?',
  logic:
    "Do a standpoint's key_claims cohere with its own summary, without internal contradiction?",
  significance:
    "Do the standpoints focus on what would actually matter most to the founder's decision, not a minor or tangential angle?",
  fairness:
    'Is each standpoint argued as if genuinely held, on its own terms, rather than caricatured to make it easy to dismiss?',
}

// The Assumptions domain's artifact (deep-dive-assumptions.ts) is 1-8
// assumptions, each assessed (assumption/why_it_matters/risk_if_false) rather
// than merely named — mirrors the house pipeline's own Perspectives layer's
// assumptions sub-element (PERSPECTIVE_ASSUMPTIONS_BLOCK, prompts.ts) but
// scoped to the project's own context + the founder's prompt, not one
// stance's frame.
const ASSUMPTIONS_CRITERIA: Record<StandardId, string> = {
  clarity:
    'Is each assumption stated as one clear, testable claim, not a vague generality or several conditions bundled into one sentence?',
  accuracy:
    "Is each assumption genuinely implicit in this project's own context/prompt, not misattributed or invented from nothing there?",
  precision:
    "Is the assumption named specifically — the actual claim being taken for granted — rather than a fuzzy gesture at a theme, and does why_it_matters name a concrete consequence rather than a generic 'this could be wrong'?",
  relevance:
    "Does each assumption actually bear on this project's own plan or prompt, rather than being an incidental belief that wouldn't change anything if false?",
  depth:
    "Do the assumptions surface non-obvious, load-bearing beliefs the project's plan actually depends on, rather than restating something the context already states outright?",
  breadth:
    "Do the assumptions span genuinely different parts of the project's context (e.g. customer, business model, stage), rather than all restating one narrow belief?",
  logic:
    "Does why_it_matters actually follow from the stated assumption — a coherent account of what breaks if it's false, not a non-sequitur?",
  significance:
    'Is risk_if_false calibrated to how much would actually change if the assumption failed, not inflated or minimized against what why_it_matters itself describes?',
  fairness:
    'Are the assumptions named evenhandedly — surfacing genuinely uncomfortable ones too, not only the safe or flattering ones?',
}

// The Implications domain's artifact (deep-dive-implications.ts) is a 2-8
// item list (ikind/text/horizon/who) — mirrors ImplicationsPacketSchema's own
// item shape (contracts.ts), applied to the project's own accumulated context
// + the founder's prompt instead of a house's vetted conclusions.
const IMPLICATIONS_CRITERIA: Record<StandardId, string> = {
  clarity:
    "Is each implication's text a clear, concrete statement of what follows, not vague hand-waving about \"impact\"?",
  accuracy:
    "Do the implications correctly follow from this project's own actual context and the founder's prompt, rather than inventing an unrelated consequence?",
  precision:
    "Are who and horizon specific — a named party and a concrete near-/long-term claim — rather than generic ('the market', 'eventually')?",
  relevance:
    'Does each implication actually follow from where this project is headed per its own context and the prompt, rather than being a tangent?',
  depth:
    'Do the implications explore genuine second-order/downstream effects, not just the most obvious first-order one?',
  breadth:
    'Do the implications span multiple ikind values and different affected parties, rather than clustering on one type or one party?',
  logic:
    "Does each implication logically follow from this project's own context, without a non-sequitur?",
  significance:
    'Are these the implications that would actually matter to the founder deciding what to do next, not trivial side-effects?',
  fairness:
    'Are positive and negative implications both explored honestly, rather than stacking the deck one way?',
}

export const DEEP_DIVE_STANDARD_CRITERIA: Record<DeepDiveDomain, Record<StandardId, string>> = {
  research: RESEARCH_CRITERIA,
  perspectives: PERSPECTIVES_CRITERIA,
  assumptions: ASSUMPTIONS_CRITERIA,
  implications: IMPLICATIONS_CRITERIA,
}

// Defensive, same discipline as standards.ts's own module-load check: every
// domain must define all 9 standards — throws at import time rather than
// shipping a gap that only surfaces mid-review.
for (const [domain, criteria] of Object.entries(DEEP_DIVE_STANDARD_CRITERIA)) {
  for (const id of STANDARD_IDS) {
    if (!criteria?.[id]?.trim()) {
      throw new Error(`Missing Deep Dive criterion: ${domain} / ${id}`)
    }
  }
}

// Thin named lookup rather than every caller reaching into
// DEEP_DIVE_STANDARD_CRITERIA directly — kept as its own function (rather
// than inlined at the one call site, app/api/ai/deep-dive/route.ts) since
// DeepDiveDomain being a closed, exhaustive key here means this can never
// actually return undefined; the name is what route.ts imports and reads.
export function criteriaForDeepDiveDomain(domain: DeepDiveDomain): Record<StandardId, string> {
  return DEEP_DIVE_STANDARD_CRITERIA[domain]
}
