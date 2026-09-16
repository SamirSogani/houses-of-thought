// Implications domain generation for the Project Deep Dive engine (decision
// 022, plans/active/project-deep-dives/03-remaining-domains.md). Mirrors
// ImplicationsPacketSchema's own item shape (contracts.ts: ikind/text/
// horizon/who, 2-8 items, "so what does this actually mean") but applied to
// the project's own accumulated context + the founder's prompt instead of a
// house's vetted conclusions — and drops the packet-level `confidence` /
// `caveats_from_degraded_layers` fields ImplicationsPacketSchema also has:
// those describe the house pipeline's own upstream-layer-degradation concept
// (ReviewPanelVerdictSchema.degraded, contracts.ts), which this domain has no
// equivalent of — a Deep Dive run fails outright rather than degrading a
// prior layer forward (see app/api/ai/deep-dive/route.ts's own comment on
// this), so there is nothing for those two fields to ever describe here.
//
// Does not reuse implicationsBlock (prompts.ts) verbatim: that block's task
// framing ("given the core question and the vetted conclusions below") and
// its workspaceMode business-note plumbing assume the house pipeline's own
// conclusions-stage input, which this domain doesn't produce. Writing a
// fresh, self-contained system prompt + schema follows the same precedent
// deep-dive-research.ts set for Research, same reasoning the other two
// Phase 3 domain modules give for their own.

import { z } from 'zod'
import { completeJSON } from '@/lib/ai/router'
import { appendRegenerationFeedback, appendMasterGuidance } from './prompts'
import type { ReviewPanelVerdict, MasterReviewGuidance } from './contracts'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/deep-dive-implications.ts is server-only and must not run in the browser')
}

// Same per-item shape as ImplicationsPacketSchema's own ImplicationItemSchema
// (contracts.ts) — ikind/text/horizon/who — redefined locally rather than
// imported since that schema's fields aren't exported standalone and the
// packet itself carries the two house-only fields this domain doesn't need
// (see header comment above).
const DeepDiveImplicationItemSchema = z.object({
  ikind: z.enum(['pos', 'neg', 'unc']),
  text: z.string().min(1).max(900),
  horizon: z.enum(['Near-term', 'Long-term']),
  who: z.string().min(1).max(300),
})
export type DeepDiveImplicationItem = z.infer<typeof DeepDiveImplicationItemSchema>

const DeepDiveModelSchema = z.object({
  implications: z.array(DeepDiveImplicationItemSchema).min(2).max(8),
})

const DEEP_DIVE_IMPLICATIONS_SYSTEM = `You are generating an Implications Deep Dive for a Houses of Thought Founder Mode project — mapping what actually follows from where this project is headed, given its accumulated context and the founder's own prompt.

Task: given the project's context (stage, customer, business model, key facts) and the founder's prompt below, map the downstream consequences — so what does this actually mean for the project.

Return 2-8 implications, each:
- ikind: pos/neg/unc — is this consequence positive, negative, or genuinely uncertain.
- text: a clear, concrete statement of what follows — not vague hand-waving about "impact."
- horizon: Near-term/Long-term.
- who: who actually bears this consequence — a named party (e.g. "the founder", "early customers", "the engineering team"), not a vague "society" or "stakeholders."

Hard rules:
- Spread across at least two different ikind values — a one-sided list under-explores the real consequences.
- Ground every implication specifically in this project's own context and the prompt — not a generic consequence any project in this space might face.
- Explore genuine second-order/downstream effects, not just the most obvious first-order one.
- Do not restate assumptions, argue standpoints, or cite new evidence here — those are separate Deep Dives; stay scoped to mapping consequences.
- Plain, direct language — no lecturing, no hedging filler.`

// Runs one generation round and returns the implications list — the deep-dive
// engine's one "generate" unit of work for this domain (see deep-dive-
// research.ts's own comment on this same split).
export async function runDeepDiveImplicationsGenerate(
  prompt: string,
  contextText: string,
  repair?: { priorArtifact: DeepDiveImplicationItem[]; priorVerdict: ReviewPanelVerdict },
  masterGuidance?: { priorArtifact: DeepDiveImplicationItem[]; guidance: MasterReviewGuidance }
): Promise<DeepDiveImplicationItem[]> {
  const baseContext = `## Project context\n${contextText || '(none yet)'}\n\n` + `## Founder's prompt\n${prompt}`

  const isRepair = !!repair || !!masterGuidance
  const { implications } = await completeJSON({
    role: 'swarm',
    swarmTier: 'draft',
    system: DEEP_DIVE_IMPLICATIONS_SYSTEM,
    user: masterGuidance
      ? appendMasterGuidance(baseContext, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(baseContext, repair),
    schema: DeepDiveModelSchema,
    schemaName: 'deep_dive_implications_list',
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    maxTokens: 8000,
    deadlineAt: Date.now() + 45_000,
  })
  return implications
}
