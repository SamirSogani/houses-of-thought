// POST /api/houses/[id]/reasoning — the house-scoped reasoning pipeline's step
// dispatcher (plans/active/reasoning-pipeline/27-house-scoped-pipeline-
// integration.md; decision 019). Mirrors app/api/admin/reasoning/route.ts's
// shape almost exactly on purpose — same step dispatcher, same RequestSchema
// (imported, not duplicated, from the admin route's own route-schema.ts),
// same regenerate-then-re-review loop, same persistRunStep pattern — this file
// must NOT reinvent the step sequencing, only the gating. Do not modify
// app/api/admin/reasoning/route.ts to "share" this logic; the two routes are
// deliberately kept independent so this route's gating can never leak into
// the admin surface.
//
// Gating (the one real difference from the admin route):
//  - Caller must be signed in AND either own the house or be an 'editor'
//    collaborator (house_collaborators, migration 0004) — checked against the
//    CALLER's OWN session first (same authorization style as this branch's
//    app/api/collaborators/route.ts and app/api/share-link/route.ts), never
//    isCallerAdmin/lib/auth/admin.ts.
//  - capabilitiesFor(accountType).canAuthorDraft must be true — excludes
//    students, exactly matching Draft Mode's own restriction
//    (app/api/ai/draft/route.ts).
//
// No rate limit / quota on this route yet — Samir's explicit call, 2026-08-16
// (plan doc 27's "No rate limit" line): a real, known gap, not silently
// accepted. A coarse per-account cap (ai_usage/increment_ai_usage, migration
// 0011) belongs here before this is exposed beyond Samir personally testing
// it — matches this branch's own pattern of flagging deferred work in
// comments (see app/api/collaborators/route.ts's rate-limit comment) rather
// than omitting it silently.
//
// maxDuration/MAX_BODY_BYTES/the whole step switch below: kept in lockstep
// with app/api/admin/reasoning/route.ts — see that file's own header comment
// for the full rationale (Vercel Fluid Compute's real 300s ceiling, why every
// review-gated layer is split into generate+review steps, etc.). Changes
// there that aren't gating-related should be mirrored here too.

import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { AiError } from '@/lib/ai/router'
import { createClient } from '@/lib/supabase/server'
import { getCallerCapabilities, getCallerWorkspaceMode } from '@/lib/auth/account'
import { getProject, formatProjectContextLines } from '@/lib/projects/data'
import { retrieveProjectChunks, formatRagChunksForPrompt } from '@/lib/ai/rag'
import { log } from '@/lib/log'
import { type StepId, type PipelineMode, nextStepForMode, isReviewStep, STEP_FAILURE_MODE } from '@/lib/ai/reasoning/steps'
import { MAX_N_PHASE1 } from '@/lib/ai/reasoning/budget'
import { type ReviewPanelVerdict } from '@/lib/ai/reasoning/contracts'
import {
  PerspectivesGenerateError,
} from '@/lib/ai/reasoning/orchestrator-perspectives'
import { runMasterReview } from '@/lib/ai/reasoning/orchestrator-panel'
import { dispatchStep } from './dispatch'
import {
  persistRunStep,
  runStatusFrom,
  getReasoningRunByHouseId,
  getConflictingRunningRun,
  getLiveCandidateRun,
} from '@/lib/ai/reasoning/persistence'
import { runLockBlocks, candidateBlocksNewSandbox } from '@/lib/ai/console'
import {
  RequestSchema,
  failingStandardIds,
  buildExtraContext,
} from '@/app/api/admin/reasoning/route-schema'

export const maxDuration = 280

const MAX_BODY_BYTES = 300 * 1024

const HouseIdSchema = z.string().uuid()

interface HouseAuthzRow {
  id: string
  owner_id: string
}

// Shared by GET and POST (factored out 2026-08-19 for the new GET, plan doc
// 28 — POST's own behavior is unchanged, this is a pure extraction). Caller's
// OWN session, not service role (style matches app/api/collaborators/route.ts
// / app/api/share-link/route.ts).
async function authorize(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated', status: 401 }

  const { data: houseRow, error: houseError } = await supabase
    .from('houses')
    .select('id, owner_id')
    .eq('id', houseId)
    .maybeSingle()
  if (houseError) {
    log.error('houses/reasoning', 'house lookup failed', { error: houseError.message })
    return { ok: false, error: 'server-error', status: 500 }
  }
  if (!houseRow) return { ok: false, error: 'not-found', status: 404 }
  const house = houseRow as HouseAuthzRow

  let canEdit = house.owner_id === user.id
  if (!canEdit) {
    const { data: collabRow, error: collabError } = await supabase
      .from('house_collaborators')
      .select('role')
      .eq('house_id', houseId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (collabError) {
      log.error('houses/reasoning', 'collaborator lookup failed', { error: collabError.message })
      return { ok: false, error: 'server-error', status: 500 }
    }
    canEdit = (collabRow as { role: string } | null)?.role === 'editor'
  }
  if (!canEdit) return { ok: false, error: 'forbidden', status: 403 }

  // Draft Mode's own restriction, applied identically here (plan doc 27 §2):
  // excludes students. Checked after ownership/editor status so a stranger
  // gets 'forbidden' rather than leaking whether they'd otherwise qualify.
  const caps = await getCallerCapabilities()
  if (!caps.canAuthorDraft) return { ok: false, error: 'draft-not-available', status: 403 }

  return { ok: true }
}

// Post-pipeline console (plan doc 28) — loads this house's most recent
// finished reasoning run so /build/[id]/console has something to resume a
// rerun from after a real navigation (no in-memory pipeline state survives
// that the way it does inside BuildHousePage). Read-only; never advances the
// step dispatcher itself.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: houseIdParam } = await params
  const houseIdParsed = HouseIdSchema.safeParse(houseIdParam)
  if (!houseIdParsed.success) return NextResponse.json({ error: 'invalid-request' }, { status: 400 })
  const houseId = houseIdParsed.data

  const supabase = await createClient()
  const authz = await authorize(supabase, houseId)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const run = await getReasoningRunByHouseId(houseId)
  if (!run) return NextResponse.json({ run: null })
  return NextResponse.json({
    run: {
      runId: run.id,
      originalQuery: run.originalQuery,
      status: run.status,
      lastStep: run.lastStep,
      runState: run.runState,
    },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: houseIdParam } = await params
  const houseIdParsed = HouseIdSchema.safeParse(houseIdParam)
  if (!houseIdParsed.success) {
    return NextResponse.json({ error: 'invalid-request' }, { status: 400 })
  }
  const houseId = houseIdParsed.data

  // Loop C, sandbox reruns with a diff (plan doc
  // plans/active/reasoning-pipeline/31-console-sandbox-reruns.md). A query
  // param, not a body field: RequestSchema is shared verbatim with
  // app/api/admin/reasoning/route.ts (route-schema.ts's own header comment:
  // "must NOT reinvent the step sequencing"), and candidate-ness is a
  // house-route-only, gating-adjacent concern, not a pipeline-step field —
  // exactly the kind of thing that file's own contract shouldn't have to
  // carry. useReasoningPipelineRunner's rerunSandbox() sets this on every
  // step of a sandbox run.
  const isCandidate = new URL(req.url).searchParams.get('candidate') === 'true'

  // ── Authorization: caller's OWN session, not service role ─────────────────
  const supabase = await createClient()
  const authz = await authorize(supabase, houseId)
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status })
  }

  // Business mode (decision 021): the CALLER's own workspace_mode, read once
  // from their profile — never from the request body. This is the one real
  // end-user-driven pipeline surface (the admin route has no per-caller
  // concept and is deliberately left untouched — plan doc 27).
  const workspaceMode = await getCallerWorkspaceMode()

  // ── From here down: same step dispatcher as app/api/admin/reasoning/
  // route.ts, gating already done above. ─────────────────────────────────
  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload-too-large' }, { status: 413 })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(json)
  if (!parsed.success) {
    // Mirrors app/api/admin/reasoning/route.ts's own 2026-08-20 fix — see
    // that file's comment on this same branch for why (real-verified live:
    // a genuine RunState shape bug surfaced as this exact response with zero
    // field-level info). Not gating-related, so mirrored here per this
    // file's own header comment.
    return NextResponse.json(
      {
        error: 'invalid-request',
        detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 }
    )
  }
  const { step, run, runId, atStep } = parsed.data
  const dryRun = parsed.data.dryRun ?? false
  const panelsOff = parsed.data.panelsOff ?? false
  const capN = parsed.data.capN ?? MAX_N_PHASE1
  const attempt = parsed.data.attempt ?? 1
  const devForceNeedsInput = parsed.data.devForceNeedsInput ?? false
  // Pipeline mode (plan doc 32): 'thorough' is the default for both
  // the public hook and the admin surface; 'express' is admin-only.
  const mode: PipelineMode = parsed.data.mode ?? 'thorough'

  // Single-flight per house (doc 30's Loop B item 1a,
  // plans/active/reasoning-pipeline/30-console-subagent-loops.md). This is
  // THE SAME route every step of an in-flight run resends to
  // (useReasoningPipelineRunner's effect, one POST per step) — a naive
  // "refuse if a run is running for this house" check would block the
  // running pipeline's own next step and break the normal build flow. The
  // guard against that: getConflictingRunningRun already excludes the
  // incoming runId from its query, and runLockBlocks re-checks that same
  // rule as a pure function — so a continuation step of THIS SAME run (same
  // runId on every step, minted once by start()/rerunFrom()) can never find
  // itself here and always passes straight through. Only a DIFFERENT,
  // still-fresh running row for this house — a genuine second run/rerun
  // starting concurrently — blocks. Skipped for dryRun, matching persist()
  // below: a dry run never becomes a real 'running' row, so it has nothing
  // to gate and nothing to protect against.
  if (!dryRun) {
    const conflicting = await getConflictingRunningRun(houseId, runId)
    if (runLockBlocks(conflicting, runId)) {
      return NextResponse.json({ error: 'reasoning-run-in-progress' }, { status: 409 })
    }
  }

  // Loop C's own guard, on top of the one above (plan doc
  // plans/active/reasoning-pipeline/31-console-sandbox-reruns.md, Trap 2's
  // second half): a candidate that already FINISHED (status: 'done', so the
  // 'running'-only lock above never sees it) but hasn't been promoted or
  // discarded yet still blocks starting ANOTHER sandbox run for this house —
  // "one candidate at a time." Gated on isCandidate so a normal fresh
  // pipeline run or a normal (non-sandbox) rerun never pays this extra
  // query. Runs BEFORE any orchestrator call, unlike the migration's own
  // partial unique index (belt-and-suspenders on the data, not the cost) —
  // this is the check that actually saves the wasted AI spend.
  if (!dryRun && isCandidate) {
    const liveCandidate = await getLiveCandidateRun(houseId)
    if (candidateBlocksNewSandbox(liveCandidate, runId)) {
      return NextResponse.json({ error: 'candidate-exists' }, { status: 409 })
    }
  }

  // Business mode (decision 021, Phases 3/5, plans/active/business-mode/
  // 03-accumulating-context.md / 05-rag-retrieval.md): fold the owning
  // project's accumulated context AND RAG-retrieved chunks into extraContext
  // — the SAME mechanism every layer below already reads (frame-generate
  // through final-composition all take extraContext), so this needs no new
  // plumbing through dispatch.ts's StepDispatchContext.
  //
  // Computed ONCE per run, not once per step. This route gets one POST per
  // pipeline step (~20 for a thorough run) and the client resends the whole
  // `run` object each time, so `run.businessContext` already being set means
  // a prior step computed it — reuse it outright instead of repeating a
  // project lookup and (when gated on) an embedding-API round trip on every
  // single step. Latency and cost both mattered here: this was previously
  // recomputed unconditionally on every step. The cache is carried forward
  // to the client via ok()/retryStep()/halted() below, which merge it into
  // whichever patch they return exactly once — from then on the client's own
  // resent `run` already has it, same mechanism as `frame`/`breadthScoping`/
  // every other field a specific step computes once and everything after
  // just reads.
  // .nullish() admits both null and undefined (zod, route-schema.ts) — this
  // route only ever writes a concrete object once computed, so either means
  // "not computed yet" here.
  let businessContext = run.businessContext
  // True only on the one request that actually computed it — ok()/
  // retryStep()/halted() below check this to know whether to fold it into
  // the outgoing patch (once) or leave it out (the client already has it).
  const businessContextFresh = businessContext == null
  if (businessContext == null) {
    let projectContextText: string | null = null
    const { data: houseProjectRow } = await supabase.from('houses').select('project_id').eq('id', houseId).maybeSingle()
    const projectId = houseProjectRow?.project_id ?? null
    if (projectId) {
      try {
        const project = await getProject(supabase, projectId)
        const lines = formatProjectContextLines(project?.context)
        if (lines.length > 0) projectContextText = `## CONTEXT (from project)\n${lines.join('\n')}`
      } catch {
        // Best-effort — a lookup failure (archived project, RLS denies it)
        // just means no project context this run, same as a house with none.
        projectContextText = null
      }
    }

    // RAG retrieval: its own distinctly-labeled section
    // (formatRagChunksForPrompt), never merged into projectContextText.
    // Gated on business mode ONLY: a general-mode caller incurs ZERO
    // embedding-generation cost here, full stop, regardless of whether the
    // house has a project (the plan doc's own explicit manual-verification
    // bullet) — checked before the projectId branch even runs a query
    // embedding.
    let ragText: string | null = null
    if (workspaceMode === 'business' && projectId && run.originalQuery.trim()) {
      try {
        const chunks = await retrieveProjectChunks(supabase, projectId, run.originalQuery, 5)
        const formatted = formatRagChunksForPrompt(chunks)
        if (formatted) ragText = formatted
      } catch (err) {
        log.error('houses/reasoning', 'RAG retrieval failed', { error: (err as Error)?.message })
      }
    }

    businessContext = { projectContextText, ragText }
  }

  const extraContext =
    [buildExtraContext(run), businessContext.projectContextText, businessContext.ragText]
      .filter((s): s is string => !!s)
      .join('\n\n') || null

  // Same persistence pattern as the admin route (see its own header comment
  // for the after()/Vercel-timing rationale) — the only difference is the
  // trailing houseId/isCandidate arguments (persistence.ts's optional
  // params, 0038 and 0043).
  function persist(patchStep: StepId, patch: Record<string, unknown>, nextStep: StepId | null, isHalted: boolean, haltReason?: string): void {
    if (dryRun) return
    after(() =>
      persistRunStep(
        runId,
        run.originalQuery,
        { ...run, ...patch },
        patchStep,
        runStatusFrom(nextStep, isHalted),
        haltReason,
        panelsOff,
        houseId,
        isCandidate,
        mode
      )
    )
  }

  // Folds the freshly-computed businessContext into a patch exactly once —
  // on whichever step's response happens to go out first. Every function
  // below that can carry a run forward (ok/retryStep/halted) routes its
  // patch through this, so the client's own resent `run` picks it up
  // regardless of which step got there first, and every step after that
  // finds run.businessContext already set and skips recomputing it.
  function withBusinessContext(patch: Record<string, unknown>): Record<string, unknown> {
    return businessContextFresh ? { ...patch, businessContext } : patch
  }

  function ok(step: StepId, patch: Record<string, unknown>): Response {
    const finalPatch = withBusinessContext(patch)
    const nextStep = nextStepForMode(step, mode)
    persist(step, finalPatch, nextStep, false)
    return NextResponse.json({ step, patch: finalPatch, nextStep, halted: false })
  }

  function perspectivesFanOutFailure(step: StepId, err: PerspectivesGenerateError): Response {
    log.error('houses/reasoning', `${step} sub-element failure`, { failures: err.failures })
    persist(step, { lastSubElementFailures: err.failures }, step, false)
    return NextResponse.json({ error: 'ai-upstream-error', subElementFailures: err.failures }, { status: 502 })
  }

  // Express mode has no review panels (steps.ts's EXPRESS_STEP_ORDER omits
  // every *-review step), so nothing in this route should ever call
  // retryStep() for an express run. Defensive guard, same as admin route.
  function retryStep(step: StepId, generateStep: StepId, patch: Record<string, unknown>): Response {
    if (mode === 'express' && isReviewStep(step)) {
      log.error('houses/reasoning', 'retryStep called for a review step in express mode', { step })
      return NextResponse.json(
        { error: 'invalid-request', detail: `${step} has no review panel in express mode` },
        { status: 400 }
      )
    }
    const finalPatch = withBusinessContext(patch)
    persist(step, finalPatch, generateStep, false)
    return NextResponse.json({ step, patch: finalPatch, nextStep: generateStep, halted: false, retry: true })
  }

  function halted(step: StepId, verdict: ReviewPanelVerdict, patch: Record<string, unknown>): Response {
    if (STEP_FAILURE_MODE[step] !== 'hard-block') {
      log.error('houses/reasoning', 'halted() called on a non-hard-block step', { step })
    }
    const failing = failingStandardIds(verdict)
    const haltReason = `${step} failed review after ${attempt} attempt${attempt === 1 ? '' : 's'}${run.masterReview?.forStep === step ? ' (including one master-reviewer-guided attempt)' : ''} — ${failing.length}/9 standards still failing (${failing.join(', ')}).`
    const finalPatch = withBusinessContext(patch)
    persist(step, finalPatch, null, true, haltReason)
    return NextResponse.json({ step, patch: finalPatch, nextStep: null, halted: true, haltReason })
  }

  // verdictField (was `patch: Record<string, unknown>`, 2026-09-09, Samir's
  // spec) — mirrors app/api/admin/reasoning/route.ts's own
  // tryMasterReviewOrHalt: the 5 hard-block layers now degrade-and-continue
  // instead of halting the whole run when their one master-guided attempt
  // also fails, matching perspectives-review's existing per-bundle degrade
  // pattern (orchestrator-perspectives.ts's runPerspectivesReview). halted()
  // itself is left in place (still reachable in theory) but nothing in the
  // normal course calls it anymore for these 5 steps.
  async function tryMasterReviewOrHalt(
    step: StepId,
    generateStep: StepId,
    artifact: unknown,
    verdict: ReviewPanelVerdict,
    context: string,
    verdictField: string
  ): Promise<Response> {
    if (run.masterReview?.forStep === step) {
      return ok(step, { [verdictField]: { ...verdict, degraded: true } })
    }
    const guidance = await runMasterReview(verdict, artifact, context, dryRun)
    return retryStep(step, generateStep, { [verdictField]: verdict, masterReview: { forStep: step, guidance } })
  }

  try {
    return await dispatchStep({
      step,
      run,
      runId,
      atStep,
      dryRun,
      panelsOff,
      capN,
      attempt,
      devForceNeedsInput,
      extraContext,
      mode,
      workspaceMode,
      ok,
      persist,
      retryStep,
      perspectivesFanOutFailure,
      tryMasterReviewOrHalt,
    })
  } catch (err) {
    const patchStep = step === 'context-gather-adhoc' ? atStep : step
    const message = err instanceof AiError ? err.message : (err as Error)?.message || 'unknown error'
    if (patchStep) persist(patchStep, {}, patchStep, false, `${patchStep} threw: ${message}`)
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    log.error('houses/reasoning', 'unhandled error', { step, error: message })
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }
}
