// Perspectives domain generation for the Project Deep Dive engine (decision
// 022, plans/active/project-deep-dives/03-remaining-domains.md). Deliberately
// structured lighter than the house pipeline's own Perspectives layer
// (orchestrator-perspectives.ts's runPerspectivesGenerateStances): that layer
// fans out ONE stance per candidate viewpoint label produced by a prior
// Breadth Scoping step (BreadthScopingPacketSchema, contracts.ts) — this
// domain deliberately has no such step. The founder's own prompt IS the
// scoping (03-remaining-domains.md's own note not to port Breadth Scoping
// in), so one call names AND argues a handful of distinct standpoints in the
// same pass, rather than an n-way parallel fan-out of independent generator
// calls each assigned one label.
//
// Does not reuse perspectiveStanceBlock/PerspectiveStanceSchema or
// PerspectiveBundleSchema (prompts.ts/contracts.ts) verbatim: that block's own
// task framing ("you have been assigned a viewpoint label; argue it as if you
// hold it") assumes exactly the one-stance-per-call fan-out this domain
// doesn't do, and PerspectiveBundleSchema's sibling shape carries
// sub_questions/assumptions/evidence/counterargument — this phase's OTHER two
// Deep Dive domains' jobs (Assumptions, Implications), not Perspectives'.
// Writing a fresh, self-contained system prompt + schema here follows the
// same precedent deep-dive-research.ts already set for Research (see that
// file's own header comment on why it doesn't reuse runSearches) rather than
// forking a house-only helper to fit a shape it wasn't designed for.

import { z } from 'zod'
import { completeJSON } from '@/lib/ai/router'
import { appendRegenerationFeedback, appendMasterGuidance } from './prompts'
import type { ReviewPanelVerdict, MasterReviewGuidance } from './contracts'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/deep-dive-perspectives.ts is server-only and must not run in the browser')
}

// One project-scoped standpoint: a label, a short committed summary, and the
// specific claims it rests on — deliberately NOT a full PerspectiveBundle
// (no sub_questions/assumptions/evidence/counterargument; those live in the
// Assumptions and Implications Deep Dives, and there's no per-perspective
// evidence-gather step here at all).
export const DeepDiveStandpointSchema = z.object({
  label: z.string().min(1).max(120),
  summary: z.string().min(1).max(900),
  key_claims: z.array(z.string().min(1).max(600)).min(1).max(6),
})
export type DeepDiveStandpoint = z.infer<typeof DeepDiveStandpointSchema>

// Wrapped in an object, same reason as every other Deep Dive model schema
// (deep-dive-research.ts's own comment) — completeJSON's structured-output
// path needs an object at the top level, not a bare array.
const DeepDiveModelSchema = z.object({
  standpoints: z.array(DeepDiveStandpointSchema).min(2).max(6),
})

const DEEP_DIVE_PERSPECTIVES_SYSTEM = `You are generating a Perspectives Deep Dive for a Houses of Thought Founder Mode project — identifying the distinct standpoints one could take on the founder's own prompt, read against this project's accumulated context (stage, customer, business model, key facts).

Task: name 2-6 genuinely distinct standpoints on the prompt below and argue each one as if held with conviction, specifically to THIS project, not in the abstract.

For each standpoint return:
- label: a short, specific name for this standpoint (e.g. "The cost-conscious early customer", "The regulator's view") — not a generic pro/con tag.
- summary: 2-3 sentences stating this standpoint's position as if genuinely held.
- key_claims: 1-6 short, specific claims this standpoint rests on, grounded in the project's own context where it bears on the claim.

Hard rules:
- Each standpoint must be a genuinely different angle — not a hedge, and not a rephrasing of another standpoint already returned.
- Argue each standpoint on its own terms; do not soften into one balanced synthesis across them.
- Ground claims in this project's own stage/customer/business model/facts where relevant — don't produce generic claims that could describe any founder's project.
- Do not pose sub-questions, list assumptions, gather evidence, or draw out downstream consequences here — those are separate Deep Dives; stay scoped to naming and arguing standpoints only.
- Plain, direct language — no lecturing, no hedging filler.`

// Runs one generation round and returns the standpoint list — the deep-dive
// engine's one "generate" unit of work for this domain (whether this is
// attempt 1, a feedback-driven regeneration, or the master-guided final
// attempt is entirely the caller's concern; this function only knows how to
// produce ONE fresh draft from the project's own context + prompt).
export async function runDeepDivePerspectivesGenerate(
  prompt: string,
  contextText: string,
  repair?: { priorArtifact: DeepDiveStandpoint[]; priorVerdict: ReviewPanelVerdict },
  masterGuidance?: { priorArtifact: DeepDiveStandpoint[]; guidance: MasterReviewGuidance }
): Promise<DeepDiveStandpoint[]> {
  const baseContext = `## Project context\n${contextText || '(none yet)'}\n\n` + `## Founder's prompt\n${prompt}`

  const isRepair = !!repair || !!masterGuidance
  const { standpoints } = await completeJSON({
    role: 'swarm',
    // Explicit 'draft', same reasoning as deep-dive-research.ts's own comment
    // on this field — a single first-pass subject, not a fan-out or panel call.
    swarmTier: 'draft',
    system: DEEP_DIVE_PERSPECTIVES_SYSTEM,
    user: masterGuidance
      ? appendMasterGuidance(baseContext, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(baseContext, repair),
    schema: DeepDiveModelSchema,
    schemaName: 'deep_dive_perspectives_standpoints',
    // Same medium/high first-pass/repair split as deep-dive-research.ts.
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 8000, same blanket 'swarm'-role bump as deep-dive-research.ts.
    maxTokens: 8000,
    // Same 45s-under-this-route's-60s-ceiling discipline as deep-dive-
    // research.ts's own deadlineAt — see that file's comment for why.
    deadlineAt: Date.now() + 45_000,
  })
  return standpoints
}
