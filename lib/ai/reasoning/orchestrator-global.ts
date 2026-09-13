// Server-only orchestration for the reasoning pipeline's global layers and
// final composition: global assumptions/evidence (question-level, informed by
// all perspectives but scoped to none), conclusions, implications, and
// packaging into the FinalAnswer. All five reviewed layers here hard-block on
// a failed panel (lib/ai/reasoning/steps.ts STEP_FAILURE_MODE) — none has the
// redundancy the Perspectives layer has.

import { completeJSON } from '@/lib/ai/router'
import { log } from '@/lib/log'
import {
  type FramePacket,
  type PerspectiveBundle,
  GlobalAssumptionsPacketSchema,
  type GlobalAssumptionsPacket,
  type GlobalEvidencePacket,
  EvidenceStrategySchema,
  type EvidenceStrategy,
  GlobalEvidencePopulateSchema,
  type GlobalEvidenceItemDraft,
  GlobalEvidenceConfidenceSchema,
  ConclusionsPacketSchema,
  type ConclusionsPacket,
  ImplicationsPacketSchema,
  type ImplicationsPacket,
  FinalAnswerSchema,
  type FinalAnswer,
  type ReviewPanelVerdict,
  type MasterReviewGuidance,
} from './contracts'
import {
  REASONING_PERSONA,
  GLOBAL_ASSUMPTIONS_BLOCK,
  globalEvidenceStrategyBlock,
  globalEvidencePopulateBlock,
  GLOBAL_EVIDENCE_CONFIDENCE_BLOCK,
  CONCLUSIONS_BLOCK,
  implicationsBlock,
  FINAL_COMPOSITION_BLOCK,
  serializeFrame,
  serializePerspectives,
  appendRegenerationFeedback,
  appendMasterGuidance,
  formatGatherHistory,
} from './prompts'
import { REPAIR_TOKEN_HEADROOM } from './budget'
import type { WorkspaceMode } from '@/lib/profile/data'

// Shared shape for "regenerate this after a failed panel verdict" across the
// hard-block global/conclusions/implications generators below.
interface Repair<T> {
  priorArtifact: T
  priorVerdict: ReviewPanelVerdict
}

// Shared shape for the ONE extra attempt a hard-block layer earns after
// exhausting MAX_REGENERATION_ATTEMPTS still failing (route.ts's master-
// review escalation) — takes priority over Repair<T>'s raw per-standard notes
// when present (the two are never both set on the same call).
interface MasterGuided<T> {
  priorArtifact: T
  guidance: MasterReviewGuidance
}
import { runReviewPanel } from './orchestrator-panel'
import { runSearches } from './search'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/orchestrator-global.ts is server-only and must not run in the browser')
}

// extraContext (Phase 3 item 1, decision 019): context-gather-post's + any
// ad-hoc calls' answers so far, pre-formatted by route.ts's
// buildExtraContext. Threaded through every function in this file that builds
// a context string, so an answer re-contextualizes everything downstream of
// wherever it was given, not just the very next call.
export function questionContext(frame: FramePacket, bundles: PerspectiveBundle[], extraContext?: string | null): string {
  return `${serializeFrame(frame, extraContext)}\n\n## Vetted perspectives\n${serializePerspectives(bundles)}`
}

export async function runGlobalAssumptionsGenerate(
  frame: FramePacket,
  bundles: PerspectiveBundle[],
  dryRun: boolean,
  repair?: Repair<GlobalAssumptionsPacket>,
  extraContext?: string | null,
  masterGuidance?: MasterGuided<GlobalAssumptionsPacket>
): Promise<GlobalAssumptionsPacket> {
  if (dryRun) {
    return {
      question_level_assumptions: ['[dry run] question-level assumption.'],
      cross_perspective_notes: '[dry run] cross-perspective note.',
    }
  }
  const context = questionContext(frame, bundles, extraContext)
  const isRepair = !!repair || !!masterGuidance
  return completeJSON({
    role: 'swarm',
    // Samir's 2026-09-12 per-step tiering (router-config.ts's
    // TARGETS.deepinfraLarge) — global assumptions generation always runs
    // on the largest model, same as perspectives generation
    // (orchestrator-perspectives.ts).
    swarmTier: 'large',
    system: `${REASONING_PERSONA}\n\n${GLOBAL_ASSUMPTIONS_BLOCK}`,
    user: masterGuidance
      ? appendMasterGuidance(context, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(context, repair),
    schema: GlobalAssumptionsPacketSchema,
    schemaName: 'global_assumptions_packet',
    // medium(first pass)/high(repair or master-guided) — 2026-08-11, Samir:
    // same split as every generate call in the pipeline; see
    // reasoningEffortFor's allowHighReasoning (router-shared.ts).
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 900 → 8000 (2026-09-12, Samir): the large tier's first real test
    // (subagent-driven, this session) halted here 3x — `upstream empty
    // output`, finishReason "length" — the exact failure shape gpt-oss-20b
    // and Qwen3.8-27B (critic tier) both hit: hidden reasoning tokens
    // burning the whole budget before any JSON. Unlike those two, this
    // call isn't being swapped off the model yet — try headroom first,
    // since Qwen3.8-2.4T-A95B was chosen specifically for its stronger
    // schema/JSON behavior and Samir wants that kept if a bigger budget
    // alone resolves it. +REPAIR_TOKEN_HEADROOM on repair only, same as
    // every other call — see budget.ts for why.
    maxTokens: isRepair ? 8000 + REPAIR_TOKEN_HEADROOM : 8000,
  })
}

export async function runGlobalAssumptionsReview(
  frame: FramePacket,
  bundles: PerspectiveBundle[],
  packet: GlobalAssumptionsPacket,
  dryRun: boolean,
  panelsOff = false,
  extraContext?: string | null
): Promise<ReviewPanelVerdict> {
  return runReviewPanel(
    frame.core_question,
    'global-assumptions-review',
    packet,
    questionContext(frame, bundles, extraContext),
    dryRun,
    panelsOff
  )
}

// ── Global evidence, 3 phases (2026-08-13, Samir) — replaces the old single
// runGlobalEvidenceGenerate (one generateWithOptionalSearch call juggling
// search-vs-ask, epistemic hedging about real-vs-hypothetical sourcing, AND
// confidence all at once). Mirrors orchestrator-perspectives.ts's evidence
// split exactly, just for the ONE question-level unit instead of n
// per-perspective ones — see that file's comments for the full rationale.
// No PerspectivesGenerateError-style aggregation needed here: a single unit
// failing IS the whole failure, no ambiguity about "which one" the way n
// parallel perspective calls have.
export async function runGlobalEvidenceStrategy(
  frame: FramePacket,
  bundles: PerspectiveBundle[],
  dryRun: boolean,
  // Dev-testing only (mirrors runContextGather's forceNeedsInput,
  // orchestrator-setup.ts, and runPerspectivesEvidenceStrategy's own copy of
  // this) — forces the dry-run strategy to ask a question, so the
  // single-unit pause UI can be exercised for free. No effect outside
  // dryRun.
  forceNeedsInput = false,
  // 2026-09-09, Samir's spec — every real Q&A round this run's global
  // evidence strategy has already asked/received, so a loop-back
  // (global-evidence-review failing, route.ts's retryStep) doesn't re-ask the
  // same or an overlapping question. See route-schema.ts's
  // globalEvidenceGatherHistory for how this accumulates client-side.
  priorGatherHistory?: string | null,
  repair?: Repair<GlobalEvidencePacket>,
  extraContext?: string | null,
  masterGuidance?: MasterGuided<GlobalEvidencePacket>,
  // Business mode (decision 021): defaults to 'general' so the admin-only
  // pipeline (not to be touched — plan doc 27) keeps calling this unchanged.
  workspaceMode: WorkspaceMode = 'general'
): Promise<EvidenceStrategy> {
  if (dryRun) {
    if (forceNeedsInput) {
      return {
        search_queries: [],
        needs_user_input: true,
        questions_for_user: [{ question: '[dry run] Anything specific the global evidence pass should look for?', options: [] }],
        reason: '[dry run] simulated clarification need, for UI testing only.',
      }
    }
    return { search_queries: [], needs_user_input: false, questions_for_user: [], reason: '[dry run] no evidence strategy needed.' }
  }
  const context = questionContext(frame, bundles, extraContext) + formatGatherHistory(priorGatherHistory)
  return completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${globalEvidenceStrategyBlock(workspaceMode)}`,
    user: masterGuidance
      ? appendMasterGuidance(context, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(context, repair),
    schema: EvidenceStrategySchema,
    schemaName: 'global_evidence_strategy',
    // Deciding search-vs-ask is a simple call by design (Samir's explicit
    // scoping) — 'medium' always, no repair-mode 'high' bump; mirrors
    // orchestrator-perspectives.ts's runPerspectivesEvidenceStrategy.
    effort: 'medium',
    maxTokens: 8000, // blanket bump, 2026-09-12 (was 500) — see runGlobalAssumptionsGenerate above
  })
}

// Runs the strategy's requested search (if any) via runSearches (search.ts)
// — ONE round, not generateWithOptionalSearch's old multi-round loop (that
// loop no longer exists anywhere in evidence generation: strategy decides
// search terms ONCE, up front, so there's nothing left to iterate on — this
// also resolves the multi-round CHAIN_DEADLINE_MS-sharing complexity doc
// 20/22 flagged as a known gap for this exact call).
export async function runGlobalEvidencePopulate(
  frame: FramePacket,
  bundles: PerspectiveBundle[],
  strategy: EvidenceStrategy,
  // The admin's answer, if strategy asked and they answered (Phase 3 item
  // 1's pattern, extended — EvidenceGatherUnit/Answers, contracts.ts).
  userAnswer: string | null,
  dryRun: boolean,
  repair?: Repair<GlobalEvidencePacket>,
  extraContext?: string | null,
  masterGuidance?: MasterGuided<GlobalEvidencePacket>,
  // Business mode (decision 021): defaults to 'general' so the admin-only
  // pipeline (not to be touched — plan doc 27) keeps calling this unchanged.
  workspaceMode: WorkspaceMode = 'general'
): Promise<GlobalEvidenceItemDraft[]> {
  if (dryRun) return [{ claim_id: '[dry run] claim', source_ref: '[dry run] source' }]
  const isRepair = !!repair || !!masterGuidance
  let context = questionContext(frame, bundles, extraContext)
  const searchFindings = strategy.search_queries.length ? await runSearches(strategy.search_queries) : null
  if (searchFindings) context += `\n\n## Real search results\n${searchFindings}`
  if (userAnswer) context += `\n\n## The person's answer to your question\n${userAnswer}`
  const out = await completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${globalEvidencePopulateBlock(workspaceMode)}`,
    user: masterGuidance
      ? appendMasterGuidance(context, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(context, repair),
    schema: GlobalEvidencePopulateSchema,
    schemaName: 'global_evidence_populate',
    // medium(first pass)/high(repair or master-guided) — 2026-08-11 split,
    // still applies to this call now that it's populate's own job.
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 2400 (carried over from the old single-call version's 2026-08-10
    // finding): gpt-oss-20b's evidence items (citations) run long. Blanket-
    // bumped to 8000, 2026-09-12 — see runGlobalAssumptionsGenerate above.
    // +REPAIR_TOKEN_HEADROOM on repair only — see budget.ts for why.
    maxTokens: isRepair ? 8000 + REPAIR_TOKEN_HEADROOM : 8000,
  })
  return out.evidence
}

// Sees ONLY the finished items — scoring how well each item's OWN source
// backs its OWN claim, nothing else ("a separate request/subagent," Samir).
// Matches confidence entries back to drafts by claim_id, not array
// position — a missing match falls back to 'medium' with the item kept
// anyway, rather than either side needing to stay positionally in sync.
export async function runGlobalEvidenceConfidence(
  frame: FramePacket,
  draft: GlobalEvidenceItemDraft[],
  dryRun: boolean,
  repair?: Repair<GlobalEvidencePacket>,
  extraContext?: string | null,
  masterGuidance?: MasterGuided<GlobalEvidencePacket>
): Promise<GlobalEvidencePacket> {
  if (dryRun) {
    return { question_level_evidence: draft.map((d) => ({ ...d, confidence: 'medium' as const })) }
  }
  if (draft.length === 0) return { question_level_evidence: [] }
  const isRepair = !!repair || !!masterGuidance
  const itemsBlock = `## Evidence items\n${JSON.stringify(draft, null, 2)}\n\n${serializeFrame(frame, extraContext)}`
  const out = await completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${GLOBAL_EVIDENCE_CONFIDENCE_BLOCK}`,
    user: masterGuidance
      ? appendMasterGuidance(itemsBlock, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(itemsBlock, repair),
    schema: GlobalEvidenceConfidenceSchema,
    schemaName: 'global_evidence_confidence',
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // blanket bump, 2026-09-12 (was 800) — see runGlobalAssumptionsGenerate above
    maxTokens: isRepair ? 8000 + REPAIR_TOKEN_HEADROOM : 8000,
  })
  const byId = new Map(out.confidence.map((c) => [c.claim_id, c.confidence]))
  const question_level_evidence = draft.map((d) => ({ ...d, confidence: byId.get(d.claim_id) ?? ('medium' as const) }))
  return { question_level_evidence }
}

export async function runGlobalEvidenceReview(
  frame: FramePacket,
  packet: GlobalEvidencePacket,
  dryRun: boolean,
  panelsOff = false,
  extraContext?: string | null
): Promise<ReviewPanelVerdict> {
  return runReviewPanel(
    frame.core_question,
    'global-evidence-review',
    packet,
    serializeFrame(frame, extraContext),
    dryRun,
    panelsOff
  )
}

export async function runConclusionsGenerate(
  frame: FramePacket,
  bundles: PerspectiveBundle[],
  globalAssumptions: GlobalAssumptionsPacket,
  globalEvidence: GlobalEvidencePacket,
  dryRun: boolean,
  repair?: Repair<ConclusionsPacket>,
  extraContext?: string | null,
  masterGuidance?: MasterGuided<ConclusionsPacket>
): Promise<ConclusionsPacket> {
  if (dryRun) return { conclusions: ['[dry run] conclusion.'], supporting_chain: ['[dry run] supporting step.'] }
  const context = `${questionContext(frame, bundles, extraContext)}\n\n## Global assumptions\n${globalAssumptions.question_level_assumptions.map((a) => `- ${a}`).join('\n')}\n\n## Global evidence\n${globalEvidence.question_level_evidence.map((e) => `- ${e.claim_id} (${e.source_ref}, ${e.confidence})`).join('\n')}`
  const isRepair = !!repair || !!masterGuidance
  return completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${CONCLUSIONS_BLOCK}`,
    user: masterGuidance
      ? appendMasterGuidance(context, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(context, repair),
    schema: ConclusionsPacketSchema,
    schemaName: 'conclusions_packet',
    // medium(first pass)/high(repair or master-guided) — 2026-08-11, Samir:
    // same split as every generate call in the pipeline; see
    // reasoningEffortFor's allowHighReasoning (router-shared.ts).
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 900 -> 1800 (real traffic 2026-08-02): ConclusionsPacketSchema's own
    // bounds allow up to 4 conclusions + 8 supporting_chain items at 600 chars
    // each - 900 tokens can't cover that even at typical (non-maxed) length.
    // Confirmed live: Gemini's raw output truncated mid-JSON on the 3rd
    // conclusion, twice in a row, at exactly this cap. Blanket-bumped to
    // 8000, 2026-09-12 — see runGlobalAssumptionsGenerate above.
    // +REPAIR_TOKEN_HEADROOM on repair only — see budget.ts for why.
    maxTokens: isRepair ? 8000 + REPAIR_TOKEN_HEADROOM : 8000,
  })
}

export async function runConclusionsReview(
  frame: FramePacket,
  packet: ConclusionsPacket,
  dryRun: boolean,
  panelsOff = false,
  extraContext?: string | null
): Promise<ReviewPanelVerdict> {
  return runReviewPanel(
    frame.core_question,
    'conclusions-review',
    packet,
    serializeFrame(frame, extraContext),
    dryRun,
    panelsOff
  )
}

export async function runImplicationsGenerate(
  frame: FramePacket,
  conclusions: ConclusionsPacket,
  degradedNotes: string[],
  dryRun: boolean,
  repair?: Repair<ImplicationsPacket>,
  extraContext?: string | null,
  masterGuidance?: MasterGuided<ImplicationsPacket>,
  // Business mode (decision 021): defaults to 'general' so the admin-only
  // pipeline (not to be touched — plan doc 27) keeps calling this unchanged.
  workspaceMode: WorkspaceMode = 'general'
): Promise<ImplicationsPacket> {
  if (dryRun) {
    return {
      implications: [
        { ikind: 'pos', text: '[dry run] implication.', horizon: 'Near-term', who: '[dry run] who' },
        { ikind: 'neg', text: '[dry run] implication.', horizon: 'Long-term', who: '[dry run] who' },
      ],
      confidence: 'medium',
      caveats_from_degraded_layers: degradedNotes,
    }
  }
  const context = `${serializeFrame(frame, extraContext)}\n\n## Conclusions\n${conclusions.conclusions.map((c) => `- ${c}`).join('\n')}\n\n## Supporting chain\n${conclusions.supporting_chain.map((s) => `- ${s}`).join('\n')}${degradedNotes.length ? `\n\n## Degraded upstream layers\n${degradedNotes.map((d) => `- ${d}`).join('\n')}` : ''}`
  const isRepair = !!repair || !!masterGuidance
  return completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${implicationsBlock(workspaceMode)}`,
    user: masterGuidance
      ? appendMasterGuidance(context, masterGuidance.priorArtifact, masterGuidance.guidance)
      : appendRegenerationFeedback(context, repair),
    schema: ImplicationsPacketSchema,
    schemaName: 'implications_packet',
    // medium(first pass)/high(repair or master-guided) — 2026-08-11, Samir:
    // same split as every generate call in the pipeline; see
    // reasoningEffortFor's allowHighReasoning (router-shared.ts).
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 900 -> 1800, same fix and same evidence shape as conclusions_packet
    // above: ImplicationsPacketSchema allows up to 8 implications (each with
    // a 600-char text AND a 600-char who) plus 6 caveats at 600 chars -
    // structurally larger than conclusions_packet's own bounds, so it needed
    // at least the same headroom. Confirmed live: Gemini truncated mid-JSON
    // on the first implication's text field, twice in a row, at this cap.
    // Blanket-bumped to 8000, 2026-09-12 — see runGlobalAssumptionsGenerate
    // above. +REPAIR_TOKEN_HEADROOM on repair only — see budget.ts for why.
    maxTokens: isRepair ? 8000 + REPAIR_TOKEN_HEADROOM : 8000,
  })
}

export async function runImplicationsReview(
  frame: FramePacket,
  packet: ImplicationsPacket,
  dryRun: boolean,
  panelsOff = false,
  extraContext?: string | null
): Promise<ReviewPanelVerdict> {
  return runReviewPanel(
    frame.core_question,
    'implications-review',
    packet,
    serializeFrame(frame, extraContext),
    dryRun,
    panelsOff
  )
}

export async function runFinalComposition(
  frame: FramePacket,
  conclusions: ConclusionsPacket,
  implications: ImplicationsPacket,
  dryRun: boolean,
  // 2026-09-09, Samir's spec — implications-review's own degraded flag,
  // which implications-generate couldn't have known about when it wrote its
  // own caveats_from_degraded_layers (implications hadn't been reviewed yet
  // at that point). Set by route.ts/dispatch.ts's final-composition case
  // from run.implicationsVerdict?.degraded. Folded in alongside (not instead
  // of) implications' own degraded-upstream caveats everywhere those are
  // used below.
  extraCaveats?: string[],
  extraContext?: string | null
): Promise<FinalAnswer> {
  if (dryRun) {
    return {
      core_question: frame.core_question,
      answer: '[dry run] composed answer.',
      caveats: [...(extraCaveats ?? []), ...implications.caveats_from_degraded_layers].slice(0, 8),
    }
  }
  const degradedNotes = [...(extraCaveats ?? []), ...implications.caveats_from_degraded_layers]
  const context = `${serializeFrame(frame, extraContext)}\n\n## Implications\n${implications.implications.map((i) => `- (${i.ikind}) ${i.text} — ${i.who}, ${i.horizon}`).join('\n')}\n\nConfidence: ${implications.confidence}${degradedNotes.length ? `\nDegraded upstream: ${degradedNotes.join('; ')}` : ''}`
  try {
    return await completeJSON({
      role: 'synthesis',
      system: `${REASONING_PERSONA}\n\n${FINAL_COMPOSITION_BLOCK}`,
      user: context,
      schema: FinalAnswerSchema,
      schemaName: 'final_answer',
      // 'medium' (was 'low', 2026-08-11) — no repair path exists for final
      // composition (packaging only, no review panel), so every call here is a
      // "first-pass" call by definition; matches the medium-first-pass default
      // every other generate call now uses.
      effort: 'medium',
      maxTokens: 8000, // blanket bump, 2026-09-12 (was 1200) — see runGlobalAssumptionsGenerate above
    })
  } catch (err) {
    // Template fallback (2026-09-09, Samir's spec, real-verified live the
    // same session): final composition is packaging only — by this point
    // conclusions and implications have ALREADY passed their own 9-agent
    // review panels (every layer before this one hard-blocks on a failed
    // panel, steps.ts STEP_FAILURE_MODE), so there is real, vetted substance
    // to build a deterministic answer from without another model call.
    // Deliberately catches ANY completeJSON failure here — invalid output
    // after all three of its own passes (router.ts), an upstream error, a
    // timeout — rather than distinguishing by error code: synthesis is
    // DeepInfra-only with no fallback provider (router-lanes.ts's
    // synthesisAttempts()), so whatever went wrong, there's nowhere else for
    // the real call to go. The template below only loses the model's own
    // framing and prose polish, never substance, which is strictly better
    // than halting a fully-reasoned run on its very last, purely cosmetic
    // step and forcing a manual retry through the whole UI.
    log.warn('ai/reasoning/orchestrator-global', 'final composition failed — using deterministic template', {
      error: (err as Error)?.message,
    })
    return buildTemplateFinalAnswer(frame, conclusions, implications, extraCaveats)
  }
}

// Deterministic fallback for runFinalComposition above — no model call, so it
// cannot fail the way the real synthesis call can. Built entirely from
// already-vetted (9-agent-reviewed) conclusions/implications; loses the
// model's own framing and prose polish, never substance.
function buildTemplateFinalAnswer(
  frame: FramePacket,
  conclusions: ConclusionsPacket,
  implications: ImplicationsPacket,
  extraCaveats?: string[]
): FinalAnswer {
  const chain = conclusions.supporting_chain.length
    ? `\n\nReasoning chain: ${conclusions.supporting_chain.join(' → ')}`
    : ''
  const raw = `${conclusions.conclusions.join(' ')}${chain}`
  // Defensive only — conclusions/supporting_chain items are already
  // schema-bounded individually, but FinalAnswerSchema.answer caps the
  // WHOLE joined string at 3000, which several already-valid items joined
  // together could still exceed.
  const answer = raw.length > 3000 ? `${raw.slice(0, 2999)}…` : raw
  // extraCaveats first (2026-09-09, Samir's spec): if FinalAnswerSchema.
  // caveats' own max(8) forces something to drop, keep the newest/most-
  // specific fact (implications' own review just struggled) over an older
  // upstream-degraded note.
  const caveats = [...(extraCaveats ?? []), ...implications.caveats_from_degraded_layers].slice(0, 8)
  return {
    core_question: frame.core_question,
    answer,
    caveats,
  }
}
