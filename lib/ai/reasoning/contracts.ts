// Client-safe contracts for the reasoning pipeline (decision 019; architecture:
// plans/active/reasoning-pipeline/02-data-contracts.md). Pure zod + types, no
// server imports — mirrors lib/ai/chat.ts / lib/ai/draft.ts.
//
// Phase 1 (decisions/019 + plans/active/reasoning-pipeline/04, verification
// stage 1): no persistence — every packet here rides in ephemeral client
// state for the length of one run, never the DB. Bounded retries (Phase 1.5,
// 03-orchestration-and-failure-handling.md) DID land within Phase 1 scope —
// see ReviewPanelVerdictSchema.degraded below and
// app/api/admin/reasoning/route.ts's retryStep().

import { z } from 'zod'

// 600 -> 900 (2026-09-09, Claude, real-verified live): core_question
// (FramePacketSchema/FinalAnswerSchema below), cross_perspective_notes, and
// question_level_assumptions items (GlobalAssumptionsPacketSchema below) all
// hit this cap on real DeepSeek-V4-Flash-0731 traffic in the same session —
// same failure shape as scope_notes/rebuttals/notes below, same fix. Paired
// with prompts.ts changes (FRAME_BLOCK, GLOBAL_ASSUMPTIONS_BLOCK,
// REASONING_PERSONA's new anti-meta-commentary rule) addressing the other
// half of that failure: the model wasn't just running long, it was padding
// fields with parenthetical notes about its own compression choices.
const str = z.string().min(1).max(900)
// scope_notes asks for a lot in one field (FRAME_BLOCK, lib/ai/reasoning/
// prompts.ts: practical/social/economic/procedural angles, a spectrum-of-
// options note, an out-of-scope note) — the shared 600-char `str` cap
// rejected well-formed output that genuinely needed the room, surfaced live
// (2026-07-31) on a regeneration attempt: same failure pattern as
// SingleStandardVerdictSchema.notes below, same fix. 1400 -> 2000
// (2026-09-09, Claude, real-verified live): failed again at 1400 on real
// DeepSeek-V4-Flash-0731 traffic — see the `str` comment above for the full
// incident this and the other bumps in this file were part of.
const scopeNotesStr = z.string().min(1).max(2000)
// rebuttals asks for substantive, specific reasoning per targeted claim ("name
// exactly what is wrong or weak"), not a generic complaint — same failure
// shape as SingleStandardVerdictSchema.notes below, surfaced live (2026-07-31)
// on real perspectives-generate-details traffic: the shared 600-char `str`
// cap rejected a well-formed rebuttal that genuinely needed the room.
const rebuttalStr = z.string().min(1).max(1000)
// search_findings holds runSearches()'s (lib/ai/reasoning/search.ts) formatted
// dump of up to 3 queries' real results (title+url+description each) — the
// 600-char `str` cap rejected this immediately on real traffic (2026-08-02):
// even one query's worth of real results routinely exceeds it, let alone 3.
const searchFindingsStr = z.string().min(1).max(4000)
// original_query is a different kind of field from the rest of this file: not
// AI-generated content that needs an output-length cap, but the caller's own
// question passed straight through unchanged (runFrameGenerate,
// orchestrator-setup.ts, returns `{ ...modelOut, original_query: originalQuery
// }` with no re-validation). It must therefore match its actual source's own
// ceiling — RunStateSchema.originalQuery (app/api/admin/reasoning/route-
// schema.ts) is z.string().min(1).max(100_000) — not the generic 600-char
// `str` meant for constrained model output. 2026-08-20, Claude, real-verified
// live on production (housesofthought.org): any question over 600 characters
// (no client-side limit exists on the co-pilot's question textarea) generated
// a frame successfully, then hard-failed on the very next request — frame-
// review — with a 400 on this exact field, every single time; retry re-posted
// the same too-long value and failed identically in well under 100ms (no AI
// call reached), which is also why retry barely appeared to try. Same bug
// shape as the EvidencePopulateSchema/PerspectiveBundleSchema cap mismatch
// fixed earlier the same day, different field. 2000 -> 100_000 (2026-09-09,
// Samir's call): the 2000 ceiling itself turned out to be the same class of
// bug one level up — a genuinely hard, detailed question this app exists to
// reason about routinely runs past 2000 characters, and the co-pilot gave no
// warning at all before silently 400ing with no useful message. 100_000 is
// "for now" (Samir's words) — generous headroom, not a considered ceiling.
const originalQueryStr = z.string().min(1).max(100_000)
const HorizonSchema = z.enum(['Near-term', 'Long-term'])
const ConfidenceSchema = z.enum(['low', 'medium', 'high'])

// ── Context-gather (Phase 3 item 1, decision 019: the two fixed checkpoints
// PLUS admin-triggered ad-hoc calls at any point — see AdHocContextGatherSchema
// below) ─────────────────────────────────────────────────────────────────────
// One question + up to 3 quick-pick options, mirroring this app's own
// AskUserQuestion-style UX (Samir's call, 2026-08-04): the admin can pick one
// of the options or answer freely instead ("Other" is always available and is
// never itself one of these — it's the UI's fallback, not a 4th option the
// model writes). options may be empty when the question is too open-ended for
// a short pick-list to make sense (CONTEXT_GATHER_BLOCK, prompts.ts).
export const ContextGatherQuestionSchema = z.object({
  question: str,
  options: z.array(str).max(3),
})
export type ContextGatherQuestion = z.infer<typeof ContextGatherQuestionSchema>

export const ContextGatherVerdictSchema = z.object({
  needs_user_input: z.boolean(),
  questions_for_user: z.array(ContextGatherQuestionSchema).max(3),
  reason: str,
  // Populated by the orchestrator (runContextGather, orchestrator-setup.ts)
  // via real search on questions_for_user when needs_user_input is true — the
  // model can't have real results yet at the point it decides whether to ask,
  // so this is never part of what the model itself returns (see
  // ContextGatherModelSchema below). Null when not needed or not run.
  search_findings: searchFindingsStr.nullable(),
})
export type ContextGatherVerdict = z.infer<typeof ContextGatherVerdictSchema>

// What the model actually produces — search_findings is added after the call.
export const ContextGatherModelSchema = ContextGatherVerdictSchema.omit({ search_findings: true })

// One free-text (or picked-option) answer per entry in a resolved verdict's
// questions_for_user, same index alignment. null means the admin skipped that
// specific question — Phase 3 item 1's confirmed "skippable" call (matches
// the existing "search enriches, never substitutes" philosophy: an unanswered
// question must never deadlock a run). Never empty string — skipping is
// always represented as null, not ''.
export const ContextGatherAnswersSchema = z.array(str.nullable()).max(3)
export type ContextGatherAnswers = z.infer<typeof ContextGatherAnswersSchema>

// An admin-triggered, ad-hoc context-gather call (Phase 3 item 1's larger
// scope, confirmed with Samir 2026-08-04: "any layer can trigger 'ask the
// user something' mid-pipeline," README's target architecture — not just the
// two fixed checkpoints below). Unlike contextGatherPre/Post on RunState
// (app/api/admin/reasoning/route.ts), there can be zero, one, or many of
// these per run, at whatever step the admin happened to be paused on —
// appended to, never mutated except to fill in `answers` once resolved.
export const AdHocContextGatherSchema = z.object({
  atStep: str, // a StepId (lib/ai/reasoning/steps.ts) — kept as a plain string here to avoid coupling this pure-contracts file to the step sequencer.
  verdict: ContextGatherVerdictSchema,
  answers: ContextGatherAnswersSchema.nullable(),
})
export type AdHocContextGather = z.infer<typeof AdHocContextGatherSchema>

// ── Frame ───────────────────────────────────────────────────────────────────
export const FramePacketSchema = z.object({
  original_query: originalQueryStr,
  core_question: str,
  definitions: z.array(z.object({ term: str, definition: str })).max(6),
  purpose: str,
  scope_notes: scopeNotesStr,
})
export type FramePacket = z.infer<typeof FramePacketSchema>

// ── Breadth-scoping ──────────────────────────────────────────────────────────
export const BreadthScopingPacketSchema = z.object({
  n: z.number().int().min(2).max(12),
  rationale: str,
  candidate_viewpoint_labels: z.array(str).min(2).max(12),
})
export type BreadthScopingPacket = z.infer<typeof BreadthScopingPacketSchema>

// ── Evidence generation (2026-08-13, Samir) — split from one call into
// strategy → [optional pause to ask the user] → populate → confidence, on
// Samir's explicit design: the strategy call stays simple (decide whether to
// search and/or ask the user, nothing else); the populate call works from
// REAL search results/the user's answer, so it never has to reason about
// "is this citation real or hypothetical" the old single-call version did;
// confidence is scored by a call that's seen nothing but the finished
// items, not asked to juggle sourcing and judgment in the same breath.
// Shared shapes for BOTH per-perspective evidence (n units, one per
// perspective) and global/question-level evidence (1 unit, unitId
// 'global') — the task is structurally identical, just scoped differently
// (ONE stance vs. ALL vetted perspectives — see prompts.ts). The FINAL
// merged shape (PerspectiveEvidenceItemSchema / GlobalEvidencePacketSchema's
// question_level_evidence, both below) is unchanged from before this split —
// only how it gets populated changed, so perspectives-review/
// global-evidence-review and everything downstream never has to know this
// split happened.
export const EvidenceStrategySchema = z.object({
  search_queries: z.array(str).max(3),
  needs_user_input: z.boolean(),
  questions_for_user: z.array(ContextGatherQuestionSchema).max(3),
  reason: str,
})
export type EvidenceStrategy = z.infer<typeof EvidenceStrategySchema>

// One paused unit's worth of questions, aggregated (1 entry for global-
// evidence, up to n for perspectives — only the units that actually asked
// something) into ONE combined pause the admin resolves in one screen —
// mirrors ContextGatherVerdict's pause/resume UX (Phase 3 item 1, decision
// 019) but per-unit, so an admin's answer can route back to the right
// unit's populate call afterward.
export const EvidenceGatherUnitSchema = z.object({
  unitId: str, // perspective_id, or the literal 'global'
  unitLabel: str, // stance_label, or a fixed label for global-evidence
  reason: str,
  questions: z.array(ContextGatherQuestionSchema).max(3),
})
export type EvidenceGatherUnit = z.infer<typeof EvidenceGatherUnitSchema>

// One answer per entry in ONE unit's `questions`, same index alignment as
// ContextGatherAnswersSchema — null means skipped, never ''.
export const EvidenceGatherUnitAnswersSchema = z.array(str.nullable()).max(3)
export type EvidenceGatherUnitAnswers = z.infer<typeof EvidenceGatherUnitAnswersSchema>

// The populate call's own output — claim_id/source_ref/caveats only, no
// confidence (that's the NEXT call's entire job, ConfidenceSchema below).
// Two variants, matching the pre-existing (unchanged) asymmetry between the
// two FINAL shapes below: PerspectiveEvidenceItemSchema carries caveats,
// GlobalEvidencePacketSchema's items never have — not something this split
// introduces, just preserved.
export const EvidenceItemDraftSchema = z.object({
  claim_id: str,
  source_ref: str,
  caveats: str.nullable(),
})
export type EvidenceItemDraft = z.infer<typeof EvidenceItemDraftSchema>
// max(8) → max(6) (2026-08-20, Claude, real-verified live): this cap must
// match PerspectiveBundleSchema.evidence's own max(6) below — nothing
// between populate and the final assembled PerspectiveBundle truncates the
// array, so a populate call that used the old max(8) headroom (which
// DeepSeek-V4-Flash-0731 did, live, on its first real off-nonprofit test
// question) produced a bundle that was already invalid the moment
// runPerspectivesEvidenceConfidence assembled it — surfacing only later, as
// a generic 400 'invalid-request' with zero detail when the client posted
// that bundle back on perspectives-review. GlobalEvidencePopulateSchema
// just below is NOT part of this bug — its own final shape
// (GlobalEvidencePacketSchema.question_level_evidence) is also max(8), so
// that pair was already consistent; only the per-perspective path had the
// mismatch.
export const EvidencePopulateSchema = z.object({ evidence: z.array(EvidenceItemDraftSchema).max(6) })

export const GlobalEvidenceItemDraftSchema = z.object({ claim_id: str, source_ref: str })
export type GlobalEvidenceItemDraft = z.infer<typeof GlobalEvidenceItemDraftSchema>
export const GlobalEvidencePopulateSchema = z.object({ evidence: z.array(GlobalEvidenceItemDraftSchema).max(8) })

// Matched back to the populate step's items by claim_id (not array
// position) — the orchestrator does the matching, not the model; a
// confidence entry with no matching claim_id is dropped, and an item with
// no matching confidence entry falls back to 'medium' with a logged
// warning, rather than either side needing to stay positionally in sync.
// max(8) → max(6) alongside EvidencePopulateSchema above, same reason: this
// call only ever scores confidence for what populate actually drafted
// (drafts[i], orchestrator-perspectives.ts), so it can never legitimately
// need more room than populate's own cap.
export const EvidenceConfidenceSchema = z.object({
  confidence: z.array(z.object({ claim_id: str, confidence: ConfidenceSchema })).max(6),
})

// Global's own variant (2026-09-09, Claude, real-verified live): the
// perspective-level EvidenceConfidenceSchema above was capped max(8) -> max(6)
// to match EvidencePopulateSchema's own max(6) — correct for perspectives,
// but runGlobalEvidenceConfidence (orchestrator-global.ts) was reusing that
// SAME max(6) schema for GLOBAL evidence, which is drafted by
// GlobalEvidencePopulateSchema's own max(8) above — a real, structural cap
// mismatch this codebase already has a name for (see EvidencePopulateSchema's
// own comment for the near-identical bug it fixed one level up): a
// global-evidence-populate call that legitimately drafted 7-8 items could
// NEVER validate its own confidence-scoring step, every single time, not
// intermittently. Split out so each path's confidence cap matches its own
// populate step's cap — the same discipline EvidencePopulateSchema /
// GlobalEvidencePopulateSchema already follow for the step before this one.
export const GlobalEvidenceConfidenceSchema = z.object({
  confidence: z.array(z.object({ claim_id: str, confidence: ConfidenceSchema })).max(8),
})

// ── Perspectives (the one fan-out layer) ────────────────────────────────────
export const PerspectiveEvidenceItemSchema = z.object({
  claim_id: str,
  source_ref: str,
  confidence: ConfidenceSchema,
  caveats: str.nullable(),
})

export const PerspectiveBundleSchema = z.object({
  perspective_id: str,
  stance_label: str,
  stance_summary: str,
  key_claims: z.array(str).min(1).max(8),
  sub_questions: z.array(str).min(1).max(6),
  assumptions: z.array(str).min(1).max(6),
  evidence: z.array(PerspectiveEvidenceItemSchema).max(6),
  counterargument: z.object({
    // Which perspective's session actually wrote it — the independence check
    // (01-layers-and-standards.md): must not be this bundle's own perspective_id.
    authored_by_perspective_id: str,
    // max 8, matching key_claims above (2026-08-01: real traffic showed the
    // model routinely ignoring the prompt's own "1-6" ask and rebutting more
    // than 6 of the stance's key_claims — target_claims is drawn FROM
    // key_claims, so it shouldn't be capped tighter than its own source).
    target_claims: z.array(str).min(1).max(8),
    rebuttals: z.array(rebuttalStr).min(1).max(8),
  }),
})
export type PerspectiveBundle = z.infer<typeof PerspectiveBundleSchema>

// perspectives-generate-details' own output (2026-08-13: evidence moved out
// to its own 3 steps — runPerspectivesEvidenceConfidence,
// orchestrator-perspectives.ts, merges this back with the assembled evidence
// into a full PerspectiveBundle). Persisted under RunState's
// `perspectivePartials` field.
export const PerspectivePartialBundleSchema = PerspectiveBundleSchema.omit({ evidence: true })
export type PerspectivePartialBundle = z.infer<typeof PerspectivePartialBundleSchema>

// The round-1 output of perspectives-generate-stances — just enough for round
// 2 (sub-questions/assumptions/counterargument, and evidence's own 3 steps)
// to build on. Split out because the client resends this between generate
// steps (see lib/ai/reasoning/steps.ts for why perspectives-generate is
// itself several steps).
export const PerspectiveStanceSchema = PerspectiveBundleSchema.pick({
  perspective_id: true,
  stance_label: true,
  stance_summary: true,
  key_claims: true,
})
export type PerspectiveStance = z.infer<typeof PerspectiveStanceSchema>

// ── Perspectives sub-element failure tracking (2026-08-13, Samir) ──────────
// perspectives-generate-details (and, after the evidence split above, the
// three perspectives-evidence-* steps too) fan out n-ways in parallel — when
// one of these steps fails, this is what actually tells you WHICH sub-
// element, for WHICH perspective, failed, instead of one opaque "the step
// failed." Motivated directly by having to chase this down through Vercel
// logs that had already expired (Hobby's 1-hour retention —
// plans/active/reasoning-pipeline/23-deepinfra-intermittent-reliability-and-same-target-retry.md)
// — this makes the failure durable (persisted to RunState, not just logged)
// and visible in both the live run and Past Runs. Built in
// orchestrator-perspectives.ts's PerspectivesGenerateError (reused by all
// four fan-out steps, not just perspectives-generate-details); read by
// app/api/admin/reasoning/route.ts and the client.
export const PERSPECTIVE_SUB_ELEMENTS = [
  'sub_questions',
  'assumptions',
  'counterargument',
  'evidence_strategy',
  'evidence_populate',
  'evidence_confidence',
] as const
export type PerspectiveSubElement = (typeof PERSPECTIVE_SUB_ELEMENTS)[number]

export const SubElementFailureSchema = z.object({
  perspectiveId: str,
  stanceLabel: str,
  subElement: z.enum(PERSPECTIVE_SUB_ELEMENTS),
  // The underlying error's message (e.g. 'ai-empty-output', 'ai-upstream-error')
  // — not the full detail Vercel's own logs carry (finishReason, maxTokens,
  // etc.), just enough to say what kind of failure it was without needing
  // those logs to still exist.
  errorMessage: z.string().min(1).max(500),
})
export type SubElementFailure = z.infer<typeof SubElementFailureSchema>

// ── Review panel — the generic shape reused at every 9-standard gate ───────
// (decisions/019 §3: called "review panel" / "standard reviewer" throughout,
// deliberately not "critic" — see that decision for why.)
export const STANDARD_IDS = [
  'clarity',
  'accuracy',
  'precision',
  'relevance',
  'depth',
  'breadth',
  'logic',
  'significance',
  'fairness',
] as const
export type StandardId = (typeof STANDARD_IDS)[number]

// What ONE standard reviewer's completeJSON call returns. notes' cap (400 ->
// 700 on 2026-07-30, -> 1000 on 2026-08-01) keeps climbing because the prompt
// keeps genuinely needing the room: quoting a fragment of the artifact plus
// the specific reason, and for a densely-argued perspective bundle (the
// densest artifact any reviewer sees), that routinely runs past 700 too —
// confirmed live on perspectives-review's accuracy standard, failing
// completeJSON's self-correction retry both attempts at 700.
export const SingleStandardVerdictSchema = z.object({
  pass: z.boolean(),
  notes: z.string().min(1).max(1000),
})
export type SingleStandardVerdict = z.infer<typeof SingleStandardVerdictSchema>

const ReviewPanelStandardsSchema = z.object({
  clarity: SingleStandardVerdictSchema,
  accuracy: SingleStandardVerdictSchema,
  precision: SingleStandardVerdictSchema,
  relevance: SingleStandardVerdictSchema,
  depth: SingleStandardVerdictSchema,
  breadth: SingleStandardVerdictSchema,
  logic: SingleStandardVerdictSchema,
  significance: SingleStandardVerdictSchema,
  fairness: SingleStandardVerdictSchema,
})

// Server-aggregated from 9 SingleStandardVerdict calls (lib/ai/reasoning/
// orchestrator-panel.ts) — never itself a completeJSON schema.
export const ReviewPanelVerdictSchema = z.object({
  subject_id: str,
  standards: ReviewPanelStandardsSchema,
  overall_pass: z.boolean(),
  // true only for a perspective bundle that exhausted MAX_REGENERATION_ATTEMPTS
  // (lib/ai/reasoning/budget.ts) and was passed forward anyway — the one layer
  // with real redundancy (the other bundles), per
  // 03-orchestration-and-failure-handling.md. Every other reviewed layer
  // hard-blocks-and-halts instead of ever setting this true (steps.ts
  // STEP_FAILURE_MODE) — see app/api/admin/reasoning/route.ts for the
  // regenerate-then-re-review loop this field is part of.
  degraded: z.boolean(),
})
export type ReviewPanelVerdict = z.infer<typeof ReviewPanelVerdictSchema>

// ── Global layers (question-level, informed by all perspectives, scoped to none) ─
export const GlobalAssumptionsPacketSchema = z.object({
  question_level_assumptions: z.array(str).min(1).max(8),
  cross_perspective_notes: str,
})
export type GlobalAssumptionsPacket = z.infer<typeof GlobalAssumptionsPacketSchema>

export const GlobalEvidencePacketSchema = z.object({
  question_level_evidence: z
    .array(z.object({ claim_id: str, source_ref: str, confidence: ConfidenceSchema }))
    .max(8),
})
export type GlobalEvidencePacket = z.infer<typeof GlobalEvidencePacketSchema>

// ── Conclusions and implications ────────────────────────────────────────────
export const ConclusionsPacketSchema = z.object({
  conclusions: z.array(str).min(1).max(4),
  supporting_chain: z.array(str).min(1).max(8),
})
export type ConclusionsPacket = z.infer<typeof ConclusionsPacketSchema>

const ImplicationItemSchema = z.object({
  ikind: z.enum(['pos', 'neg', 'unc']),
  text: str,
  horizon: HorizonSchema,
  who: str,
})

export const ImplicationsPacketSchema = z.object({
  implications: z.array(ImplicationItemSchema).min(2).max(8),
  confidence: ConfidenceSchema,
  caveats_from_degraded_layers: z.array(str).max(6),
})
export type ImplicationsPacket = z.infer<typeof ImplicationsPacketSchema>

// ── Master review (arbitration after MAX_REGENERATION_ATTEMPTS, 2026-08-11,
// Samir) — one more call examining all 9 standard verdicts from a layer's
// final failed attempt TOGETHER, something no single standard-reviewer ever
// does (each grades blind to the other 8, orchestrator-panel.ts). Looks for
// genuine contradictions between the 9 notes and synthesizes one clear,
// prioritized set of instructions for exactly one more regeneration attempt
// before the layer truly halts. Only the 5 hard-block layers get this (frame,
// global-assumptions, global-evidence, conclusions, implications) — the one
// layer with real redundancy (perspectives, degrade-and-continue per bundle)
// doesn't need a last-resort save the same way. See app/api/admin/reasoning/
// route.ts for the halt-vs-escalate decision this feeds.
export const MasterReviewGuidanceSchema = z.object({
  // "none identified" (or equivalent) is a valid, EXPECTED answer — most
  // failures are independent notes on genuinely separate problems, not
  // reviewers actively disagreeing with each other. Don't invent tension that
  // isn't there just to have something to report here.
  contradictions: z.string().min(1).max(800),
  guidance: z.string().min(1).max(1500),
})
export type MasterReviewGuidance = z.infer<typeof MasterReviewGuidanceSchema>

// ── Final composition (packaging only, no review panel) ─────────────────────
export const FinalAnswerSchema = z.object({
  core_question: str,
  answer: z.string().min(1).max(3000),
  caveats: z.array(str).max(8),
})
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>
