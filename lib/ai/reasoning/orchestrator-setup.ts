// Server-only orchestration for the reasoning pipeline's setup layers:
// context-gather (both fixed checkpoints), frame, and breadth-scoping. None of
// these fan out; frame is the only one of the three with a review panel
// (decisions/019 — scoping agents deliberately have no panel, keeping the
// reviewer count at exactly 9n+45).

import { completeJSON } from '@/lib/ai/router'
import {
  ContextGatherModelSchema,
  type ContextGatherVerdict,
  FramePacketSchema,
  type FramePacket,
  BreadthScopingPacketSchema,
  type BreadthScopingPacket,
  type ReviewPanelVerdict,
  type MasterReviewGuidance,
} from './contracts'
import {
  REASONING_PERSONA,
  CONTEXT_GATHER_BLOCK,
  frameBlock,
  BREADTH_SCOPING_BLOCK,
  serializeFrame,
  appendRegenerationFeedback,
  appendMasterGuidance,
} from './prompts'
import { runReviewPanel } from './orchestrator-panel'
import { runSearches } from './search'
import { clampN } from './budget'
import type { WorkspaceMode } from '@/lib/profile/data'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/reasoning/orchestrator-setup.ts is server-only and must not run in the browser')
}

// forceNeedsInput (Phase 3 item 1, dev-testing only): dryRun's own branch
// otherwise always returns needs_user_input: false, which left no free way to
// exercise the pause/ask/resume UI end-to-end short of an actual real call
// that happens to trigger it. Only ever honored inside the dryRun branch —
// never threaded anywhere near a real completeJSON call.
export async function runContextGather(
  context: string,
  dryRun: boolean,
  forceNeedsInput = false
): Promise<ContextGatherVerdict> {
  if (dryRun) {
    if (forceNeedsInput) {
      return {
        needs_user_input: true,
        questions_for_user: [
          { question: '[dry run] Which age range does this apply to?', options: ['Elementary', 'Middle school', 'High school'] },
          { question: '[dry run] District-wide or per-school?', options: ['District-wide', 'Per-school', 'Not sure'] },
        ],
        reason: '[dry run] simulated clarification need, for UI testing only.',
        search_findings: null,
      }
    }
    return {
      needs_user_input: false,
      questions_for_user: [],
      reason: '[dry run] proceeding without asking.',
      search_findings: null,
    }
  }
  const verdict = await completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${CONTEXT_GATHER_BLOCK}`,
    user: context,
    schema: ContextGatherModelSchema,
    schemaName: 'context_gather_verdict',
    effort: 'low',
    // Blanket bump, every maxTokens in the reasoning pipeline, 2026-09-12
    // (Samir): the per-call tuned values below (this one was 400) were each
    // individually right-sized for their own schema, but the large/critic
    // tiers' "thinking" models (orchestrator-global.ts's global-assumptions-
    // generate, orchestrator-panel.ts's standard_verdict) proved that hidden
    // reasoning tokens can burn a tight budget before any JSON is written —
    // confirmed live this session on two separate calls. Rather than
    // right-size each of the ~19 reasoning-pipeline call sites individually
    // against an unknown per-model reasoning-token appetite, Samir opted for
    // one uniform 8000 everywhere in this lane: generous enough that no call
    // should ever hit this wall again, on any model this lane might run.
    // Real-verified (2026-09-12, full test house) after review-panel calls
    // needed ~7400 tokens against an 800 cap — see orchestrator-panel.ts.
    maxTokens: 8000,
  })
  // Search enriches the question shown to the user — it never substitutes for
  // asking (Samir's call): even a fully-answered questions_for_user still
  // surfaces to the user, just with real findings attached instead of a bare
  // question.
  if (!verdict.needs_user_input || verdict.questions_for_user.length === 0) {
    return { ...verdict, search_findings: null }
  }
  const search_findings = await runSearches(verdict.questions_for_user.map((q) => q.question))
  return { ...verdict, search_findings }
}

const FrameModelSchema = FramePacketSchema.omit({ original_query: true })

export async function runFrameGenerate(
  originalQuery: string,
  dryRun: boolean,
  repair?: { priorFrame: FramePacket; priorVerdict: ReviewPanelVerdict },
  // context-gather-pre's answers (Phase 3 item 1), already formatted by
  // formatContextGatherAnswers (prompts.ts) — the ONE place pre-checkpoint
  // answers get threaded in; everything downstream picks them up for free via
  // the resulting frame, so they're never re-threaded again via extraContext.
  userAnswers?: string | null,
  // Present only on the ONE extra attempt frame-review's master-review
  // escalation earns after exhausting MAX_REGENERATION_ATTEMPTS (route.ts) —
  // takes priority over repair's raw per-standard notes when present (the two
  // are never both set: masterGuidance only exists once repair's own attempts
  // are exhausted).
  masterGuidance?: { priorFrame: FramePacket; guidance: MasterReviewGuidance },
  // Business mode (decision 021): defaults to 'general' so the admin-only
  // pipeline (no per-caller workspace concept, and not to be touched —
  // plan doc 27) keeps calling this unchanged; the house-scoped route passes
  // the caller's real value through.
  workspaceMode: WorkspaceMode = 'general'
): Promise<FramePacket> {
  if (dryRun) {
    return {
      original_query: originalQuery,
      core_question: originalQuery,
      definitions: [{ term: '[dry run] term', definition: '[dry run] definition' }],
      purpose: '[dry run] purpose',
      scope_notes: '[dry run] scope notes',
    }
  }
  const baseContext = userAnswers
    ? `Original question: ${originalQuery}\n\n${userAnswers}`
    : `Original question: ${originalQuery}`
  const isRepair = !!repair || !!masterGuidance
  const modelOut = await completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${frameBlock(workspaceMode)}`,
    user: masterGuidance
      ? appendMasterGuidance(baseContext, masterGuidance.priorFrame, masterGuidance.guidance)
      : appendRegenerationFeedback(
          baseContext,
          repair && { priorArtifact: repair.priorFrame, priorVerdict: repair.priorVerdict }
        ),
    schema: FrameModelSchema,
    schemaName: 'frame_packet',
    // medium(first pass)/high(repair or master-guided) — 2026-08-11, Samir:
    // revision-under-feedback needs real deliberation more than first-pass
    // generation does; see reasoningEffortFor's allowHighReasoning
    // (router-shared.ts) for why 'high' specifically needs the opt-in.
    effort: isRepair ? 'high' : 'medium',
    allowHighReasoning: isRepair,
    // 1200 truncated mid-JSON on a real regeneration round (2026-07-31, log:
    // "response was not valid JSON" on BOTH the raw attempt and completeJSON's
    // own retry) — up to 6 definitions plus the 1400-char scope_notes
    // (contracts.ts) can outgrow 1200 output tokens, especially when the
    // model is also addressing repair feedback. Raised again, 2000 → 8000,
    // 2026-09-12 — blanket bump, see runContextGather above for why.
    maxTokens: 8000,
  })
  return { ...modelOut, original_query: originalQuery }
}

export async function runFrameReview(frame: FramePacket, dryRun: boolean, panelsOff = false): Promise<ReviewPanelVerdict> {
  return runReviewPanel(
    frame.core_question,
    'frame-review',
    frame,
    `Original question: ${frame.original_query}`,
    dryRun,
    panelsOff
  )
}

function fitLabelsToN(labels: string[], n: number): string[] {
  if (labels.length >= n) return labels.slice(0, n)
  const padded = [...labels]
  while (padded.length < n) padded.push(`Additional perspective ${padded.length + 1}`)
  return padded
}

// capN is the admin's pre-run cost cap (clamped to MAX_N_PHASE1) — a ceiling,
// not a target. The model may still propose fewer if it thinks fewer suffice.
export async function runBreadthScoping(
  frame: FramePacket,
  capN: number,
  dryRun: boolean,
  // context-gather-post's (and any ad-hoc so far) answers, pre-formatted by
  // route.ts's buildExtraContext — Phase 3 item 1's confirmed
  // re-contextualization mechanism.
  extraContext?: string | null
): Promise<BreadthScopingPacket> {
  if (dryRun) {
    const n = clampN(Math.min(2, capN))
    return {
      n,
      rationale: '[dry run] fixed perspective count.',
      candidate_viewpoint_labels: fitLabelsToN(['[dry run] Perspective A', '[dry run] Perspective B'], n),
    }
  }
  const modelOut = await completeJSON({
    role: 'swarm',
    system: `${REASONING_PERSONA}\n\n${BREADTH_SCOPING_BLOCK}`,
    user: serializeFrame(frame, extraContext),
    schema: BreadthScopingPacketSchema,
    schemaName: 'breadth_scoping_packet',
    effort: 'low',
    maxTokens: 8000, // blanket bump, 2026-09-12 — see runContextGather above
  })
  const n = clampN(Math.min(modelOut.n, capN))
  return { ...modelOut, n, candidate_viewpoint_labels: fitLabelsToN(modelOut.candidate_viewpoint_labels, n) }
}
