// Research domain generation for the Project Deep Dive engine (decision 022,
// plans/active/project-deep-dives/02-generation-engine.md). Extends Research
// Mode (app/api/ai/research/route.ts) rather than reinventing it: same
// Brave-backed, real-URL-only evidence discipline, same candidate shape
// (claim/quoteOrParaphrase/sourceTitle/url — components/build/layers/
// ResearchResults.tsx's Candidate), just scoped to a project's own prompt +
// accumulated context instead of a house.
//
// Deliberately calls braveSearch directly rather than going through
// runSearches (lib/ai/reasoning/search.ts): runSearches loops N queries and
// returns one pre-formatted findings string, discarding the individual
// results' URLs — but step 4 below (the same "every URL must trace to a real
// result from THIS request" rule app/api/ai/research/route.ts enforces)
// needs the actual URL set to validate against, not just formatted text.
// braveSearch is the same lower-level, globally-rate-limited function
// runSearches itself calls (lib/ai/brave.ts's waitForBraveSlot serializes
// every caller regardless of which wrapper reaches it), so this is not a
// different search path — just skipping a wrapper that would have thrown
// away the one thing this call needs back.

import { z } from 'zod'
import { completeJSON } from '@/lib/ai/router'
import { braveSearch } from '@/lib/ai/brave'
import { appendRegenerationFeedback, appendMasterGuidance } from './prompts'
import type { ReviewPanelVerdict, MasterReviewGuidance } from './contracts'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/deep-dive-research.ts is server-only and must not run in the browser')
}

// Mirrors ResearchResults.tsx's own Candidate interface exactly — same field
// names, so a future "Save to project" (Phase 4) or a shared results
// renderer needs no translation layer between the two.
export const DeepDiveResearchCandidateSchema = z.object({
  claim: z.string().min(1).max(600),
  quoteOrParaphrase: z.string().min(1).max(600),
  sourceTitle: z.string().min(1).max(200),
  url: z.string().min(1).max(500),
})
export type DeepDiveResearchCandidate = z.infer<typeof DeepDiveResearchCandidateSchema>

// Wrapped in an object (not a bare top-level array) for the same reason
// app/api/ai/research/route.ts's own CandidatesSchema is — completeJSON's
// structured-output path needs an object at the top level.
const DeepDiveResearchModelSchema = z.object({
  candidates: z.array(DeepDiveResearchCandidateSchema).max(8),
})

const DEEP_DIVE_RESEARCH_SYSTEM = `You are generating a Research Deep Dive for a Houses of Thought Founder Mode project — a focused, panel-reviewed writeup answering one specific research prompt the founder typed, grounded in real web search results and this project's own accumulated context.

Hard rules:
- Every claim must be supported by a specific numbered search result below. Copy that result's URL EXACTLY as given; never alter, guess, or invent a URL.
- Never invent or embellish beyond what a result's description states — descriptions are short snippets, keep each claim modest and checkable.
- Prefer a spread of sources, including ones that disagree, over piling onto one side.
- Stay scoped to the prompt as asked, read against this project's own context — don't wander into unrelated territory the search happened to surface.
- Plain, direct language — no lecturing, no hedging filler.
- Return at most 8 candidates. If nothing in the results genuinely supports the prompt, return an empty list rather than padding it.`

// One request's worth of real Brave results, numbered the same way
// app/api/ai/research/route.ts's own step 3 formats them for the model.
function formatResults(results: { title: string; url: string; description: string }[]): string {
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`).join('\n\n')
}

// Runs one search + synthesis round and returns the URL-validated candidate
// list — the deep-dive engine's one "generate" unit of work (whether this is
// attempt 1, a feedback-driven regeneration, or the master-guided final
// attempt is entirely the caller's concern; this function only knows how to
// produce ONE fresh draft from ONE set of real search results).
export async function runDeepDiveResearchGenerate(
  prompt: string,
  contextText: string,
  repair?: { priorArtifact: DeepDiveResearchCandidate[]; priorVerdict: ReviewPanelVerdict },
  masterGuidance?: { priorArtifact: DeepDiveResearchCandidate[]; guidance: MasterReviewGuidance }
): Promise<DeepDiveResearchCandidate[]> {
  // Same query every attempt (no query-derivation step — the founder typed
  // an explicit prompt, decision 022 Phase 2's own brief) — so regeneration
  // re-searches the identical query rather than reusing a cached result set.
  // Brave results for a fixed query are effectively stable run-to-run, and a
  // fresh search keeps this call self-contained (no extra persisted state
  // needed just to cache a search that's cheap and already globally
  // rate-limited by lib/ai/brave.ts) — the cost of one extra Brave call per
  // regeneration attempt (at most 3 over a run's lifetime) is negligible
  // next to the AI calls it accompanies.
  const results = await braveSearch(prompt, 6)

  const baseContext =
    `## Project context\n${contextText || '(none yet)'}\n\n` +
    `## Research prompt\n${prompt}\n\n` +
    `## Search results\n${results.length ? formatResults(results) : '(no results found)'}`

  const isRepair = !!repair || !!masterGuidance
  const { candidates } = await completeJSON({
    role: 'swarm',
    // Explicit 'draft' (the same default every non-fan-out, non-panel swarm
    // call already uses when it omits this field) — deliberately not
    // 'critic' (panel-only, orchestrator-panel.ts) or 'large' (reserved for
    // perspectives generation/global-assumptions-generate, router-config.ts's
    // TARGETS.deepinfraLarge comment) since this is a single first-pass
    // subject, not either of those two special cases.
    swarmTier: 'draft',
    system: DEEP_DIVE_RESEARCH_SYSTEM,
    user: masterGuidance
      ? appendMasterGuidance(baseContext, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(baseContext, repair),
    schema: DeepDiveResearchModelSchema,
    schemaName: 'deep_dive_research_candidates',
    // 'medium' first pass / 'high'+allowHighReasoning on repair — same split
    // orchestrator-perspectives.ts's own repair-eligible generate calls use
    // (see its runPerspectivesGenerateDetails), on the theory that a genuine
    // revision benefits from more deliberation than a first pass needs.
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 8000, matching the reasoning pipeline's own blanket bump for every
    // 'swarm'-role call (orchestrator-panel.ts/orchestrator-global.ts,
    // 2026-09-12): DeepInfra's "thinking" models can spend real tokens on a
    // hidden reasoning phase before ever writing JSON, and this role has
    // already shown that failure live at smaller caps.
    maxTokens: 8000,
    // This route's own maxDuration is 60s (Vercel Hobby's real hard ceiling,
    // see app/api/ai/deep-dive/route.ts's header comment) — nowhere near
    // CHAIN_DEADLINE_MS.swarm's default 260s (sized for the house pipeline's
    // 280s route). Without an explicit override here, a genuinely stuck
    // upstream call would run past what THIS route can honor and get a hard
    // platform kill instead of completeJSON's own clean ai-timeout — see
    // that constant's own module comment for why a role's deadline must stay
    // under its actual route's budget. 45s leaves real headroom under 60s
    // for the auth/DB work either side of this call.
    deadlineAt: Date.now() + 45_000,
  })

  // Step 4, same discipline as app/api/ai/research/route.ts's own: drop any
  // candidate whose URL isn't one of THIS request's real Brave results —
  // never trust the model's own copy of a URL, however plausible.
  const allowed = new Set(results.map((r) => r.url))
  return candidates.filter((c) => allowed.has(c.url))
}
