// Assumptions domain generation for the Project Deep Dive engine (decision
// 022, plans/active/project-deep-dives/03-remaining-domains.md). Mirrors the
// house pipeline's Perspectives layer's own assumptions sub-element
// (PERSPECTIVE_ASSUMPTIONS_BLOCK, prompts.ts: "name what it quietly takes for
// granted... prefer load-bearing ones") but scoped to the project's own
// accumulated context + the founder's prompt, rather than one stance's frame
// — and, per 03-remaining-domains.md, each assumption is also assessed here
// (why it matters, how risky if false), not just named, since there is no
// separate review-only sub-element for that in this domain the way the house
// pipeline splits sub_questions/assumptions/evidence/counterargument apart.
//
// Does not reuse PERSPECTIVE_ASSUMPTIONS_BLOCK verbatim: that block's task
// framing ("given ONE perspective's stance below") assumes a single stance's
// frame to interrogate, which this domain doesn't have — the frame here is
// the project's own context and prompt. Writing a fresh, self-contained
// system prompt + schema follows the same precedent deep-dive-research.ts set
// for Research, same reasoning deep-dive-perspectives.ts gives for its own
// domain.

import { z } from 'zod'
import { completeJSON } from '@/lib/ai/router'
import { appendRegenerationFeedback, appendMasterGuidance } from './prompts'
import type { ReviewPanelVerdict, MasterReviewGuidance } from './contracts'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/deep-dive-assumptions.ts is server-only and must not run in the browser')
}

// One project-scoped assumption, assessed rather than just named: what's
// being taken for granted, what actually rides on it, and how damaging it
// would be if it turned out false.
export const DeepDiveAssumptionSchema = z.object({
  assumption: z.string().min(1).max(600),
  why_it_matters: z.string().min(1).max(600),
  risk_if_false: z.enum(['low', 'medium', 'high']),
})
export type DeepDiveAssumption = z.infer<typeof DeepDiveAssumptionSchema>

const DeepDiveModelSchema = z.object({
  assumptions: z.array(DeepDiveAssumptionSchema).min(1).max(8),
})

const DEEP_DIVE_ASSUMPTIONS_SYSTEM = `You are generating an Assumptions Deep Dive for a Houses of Thought Founder Mode project — surfacing what this project's own context and the founder's prompt are quietly taking for granted, and assessing how much actually rides on each one.

Task: given the project's accumulated context (stage, customer, business model, key facts) and the founder's own prompt below, name what is being assumed but not defended.

For each assumption return:
- assumption: one specific, testable claim being taken for granted — not a vague theme, and not several conditions bundled into one sentence.
- why_it_matters: what would actually change about this project's plan or reasoning if this assumption turned out false.
- risk_if_false: low/medium/high — how damaging it would genuinely be if this assumption doesn't hold.

Hard rules:
- Prefer load-bearing assumptions the project's current plan would not survive being wrong about, over safe or trivial ones.
- Ground each assumption specifically in this project's own context and prompt — not a generic assumption any founder's project might share.
- Return 1-8 assumptions. Fewer, genuinely load-bearing assumptions beat a padded list of trivial ones.
- Do not argue for or against the assumptions, gather evidence for them, or draw out their downstream consequences here — those are separate Deep Dives; stay scoped to naming and assessing the assumptions themselves.
- Plain, direct language — no lecturing, no hedging filler.`

// Runs one generation round and returns the assumption list — the deep-dive
// engine's one "generate" unit of work for this domain (see deep-dive-
// research.ts's own comment on this same split: attempt 1 vs. a feedback-
// driven regeneration vs. a master-guided final attempt is the caller's
// concern, not this function's).
export async function runDeepDiveAssumptionsGenerate(
  prompt: string,
  contextText: string,
  repair?: { priorArtifact: DeepDiveAssumption[]; priorVerdict: ReviewPanelVerdict },
  masterGuidance?: { priorArtifact: DeepDiveAssumption[]; guidance: MasterReviewGuidance }
): Promise<DeepDiveAssumption[]> {
  const baseContext = `## Project context\n${contextText || '(none yet)'}\n\n` + `## Founder's prompt\n${prompt}`

  const isRepair = !!repair || !!masterGuidance
  const { assumptions } = await completeJSON({
    role: 'swarm',
    swarmTier: 'draft',
    system: DEEP_DIVE_ASSUMPTIONS_SYSTEM,
    user: masterGuidance
      ? appendMasterGuidance(baseContext, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(baseContext, repair),
    schema: DeepDiveModelSchema,
    schemaName: 'deep_dive_assumptions_list',
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    maxTokens: 8000,
    deadlineAt: Date.now() + 45_000,
  })
  return assumptions
}
