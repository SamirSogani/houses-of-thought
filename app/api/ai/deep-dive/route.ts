// POST /api/ai/deep-dive — the Project Deep Dive generation engine (decision
// 022, plans/active/project-deep-dives/02-generation-engine.md). Takes
// { deepDiveId }, does exactly ONE unit of work on that row's own persisted
// progress state (lib/projects/deepDives.ts's nextDeepDiveAction), persists
// the result, and returns — it never loops internally across more than one
// gate's worth of AI calls (one generation call, or one 9-reviewer panel
// round, or one master-review call).
//
// Why one call can't do the whole generate->review->regenerate->master-
// review loop: this app is confirmed running on Vercel's Hobby plan with a
// real ~60s hard ceiling per request regardless of the declared maxDuration
// (see lib/ai/router.ts's CHAIN_DEADLINE_MS comment). A Deep Dive run in the
// worst case is 1 generation + up to 4 review rounds (3 regenerations + 1
// master-review attempt) — too much for one request. This route mirrors the
// house pipeline's OWN pattern (app/api/houses/[id]/reasoning/route.ts) at a
// much smaller scale: one route, one unit of work per call, and the client
// (app/projects/[id]/deep-dive/[domain]/page.tsx) fires the next request
// itself as soon as the previous one resolves — no user click needed, which
// is what makes several HTTP round trips read as "one continuous loop."
//
// Unlike the house pipeline, there is no client-resent RunState: everything
// this route needs to resume correctly (attempt/draft/verdict/
// master_guidance) is already sitting on the row itself (migration 0052),
// so the request body is just the row's id.
//
// Only the 'research' domain has a generation engine wired up this phase
// (decision 022 Phase 2's own brief) — Perspectives/Assumptions/Implications
// are Phase 3. A request for any other domain fails clearly and immediately,
// before any AI call, rather than reaching a missing-criteria crash deeper
// in the panel.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AiError } from '@/lib/ai/router'
import { createClient } from '@/lib/supabase/server'
import { getProject, formatProjectContextLines } from '@/lib/projects/data'
import { getDeepDive, nextDeepDiveAction, type DeepDiveRow } from '@/lib/projects/deepDives'
import { criteriaForDeepDiveDomain } from '@/lib/ai/reasoning/deep-dive-standards'
import { runReviewPanelWithCriteria, runMasterReview } from '@/lib/ai/reasoning/orchestrator-panel'
import { runDeepDiveResearchGenerate, type DeepDiveResearchCandidate } from '@/lib/ai/reasoning/deep-dive-research'
import { MASTER_REVIEW_ATTEMPT } from '@/lib/ai/reasoning/budget'
import { log } from '@/lib/log'

export const maxDuration = 60

const MAX_BODY_BYTES = 10 * 1024

const RequestSchema = z.object({ deepDiveId: z.string().uuid() })

type Supa = Awaited<ReturnType<typeof createClient>>

export async function POST(req: Request): Promise<Response> {
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
    return NextResponse.json({ error: 'invalid-request' }, { status: 400 })
  }
  const { deepDiveId } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // RLS (owner_id = auth.uid()) already makes another owner's row invisible
  // here, same "doesn't exist or isn't yours" shape as every other
  // project-scoped read in this app.
  let row: DeepDiveRow | null
  try {
    row = await getDeepDive(supabase, deepDiveId)
  } catch (err) {
    log.error('ai/deep-dive', 'deep dive lookup failed', { error: (err as Error)?.message })
    return NextResponse.json({ error: 'server-error' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'not-found' }, { status: 404 })

  // Only 'research' has a generation engine wired up this phase — see this
  // file's header comment. Phase 3 turns this into a per-domain dispatch;
  // one hardcoded check is all a single implemented domain warrants today.
  if (row.domain !== 'research') {
    return NextResponse.json(
      { error: 'domain-not-implemented', message: `Deep Dive generation for "${row.domain}" isn't implemented yet.` },
      { status: 400 }
    )
  }

  const action = nextDeepDiveAction(row)

  // Already resolved (a client polling one extra time after 'done'/'error',
  // or this file's own defensive fallback for a state the machine says
  // should be unreachable — see nextDeepDiveAction's own comment) — nothing
  // to do, return the row as-is rather than repeating or erroring.
  if (action === 'idle') {
    return NextResponse.json({ deepDive: row })
  }
  if (action === 'error') {
    log.error('ai/deep-dive', 'reached defensive fallback state — marking error', { deepDiveId, attempt: row.attempt })
    row = await patch(supabase, deepDiveId, { status: 'error' })
    return NextResponse.json({ deepDive: row })
  }

  // Project context: same "CONTEXT (from project)" material every other
  // project-scoped AI surface reads, via formatProjectContextLines
  // (lib/projects/data.ts) — recomputed fresh each call, not cached, same
  // reasoning as app/api/houses/[id]/reasoning/route.ts's own comment on
  // this: one cheap row read, and staying live means an edit to
  // /projects/[id] mid-run shows up in the very next call.
  let contextText = ''
  try {
    const project = await getProject(supabase, row.project_id)
    contextText = formatProjectContextLines(project?.context).join('\n')
  } catch (err) {
    // Best-effort, same as the house route: a lookup failure just means no
    // project context this call, not a hard failure of the whole request.
    log.error('ai/deep-dive', 'project context lookup failed', { error: (err as Error)?.message })
  }

  // Shared "what is this artifact for" text for both the reviewer panel and
  // the master reviewer — the prompt, since that's the actual subject being
  // graded, plus the same project context the generator saw.
  const reviewContext = contextText
    ? `Research prompt: ${row.prompt}\n\nProject context:\n${contextText}`
    : `Research prompt: ${row.prompt}`

  try {
    switch (action) {
      case 'generate': {
        const draft = await runDeepDiveResearchGenerate(row.prompt, contextText)
        row = await patch(supabase, deepDiveId, { draft, verdict: null })
        break
      }
      case 'regenerate': {
        const draft = await runDeepDiveResearchGenerate(row.prompt, contextText, {
          priorArtifact: row.draft as DeepDiveResearchCandidate[],
          priorVerdict: row.verdict!,
        })
        row = await patch(supabase, deepDiveId, { draft, verdict: null, attempt: row.attempt + 1 })
        break
      }
      case 'master-regenerate': {
        const draft = await runDeepDiveResearchGenerate(row.prompt, contextText, undefined, {
          priorArtifact: row.draft as DeepDiveResearchCandidate[],
          guidance: row.master_guidance!,
        })
        row = await patch(supabase, deepDiveId, { draft, verdict: null, attempt: MASTER_REVIEW_ATTEMPT })
        break
      }
      case 'master-review': {
        const guidance = await runMasterReview(row.verdict!, row.draft, reviewContext)
        row = await patch(supabase, deepDiveId, { master_guidance: guidance })
        break
      }
      case 'review': {
        const verdict = await runReviewPanelWithCriteria(
          deepDiveId,
          criteriaForDeepDiveDomain(row.domain),
          row.draft,
          reviewContext
        )
        if (verdict.overall_pass) {
          row = await patch(supabase, deepDiveId, { verdict, status: 'done', result: row.draft })
        } else if (row.attempt >= MASTER_REVIEW_ATTEMPT) {
          // Exhausted the one master-guided attempt too — same "write
          // result + status: 'done', or status: 'error' if the panel loop
          // still fails after the master-review attempt" as decision 022
          // Phase 2's own brief; unlike the house pipeline's own hard-block
          // layers (which now degrade-and-continue, 2026-09-09), a Deep Dive
          // result has no downstream layer depending on it to degrade
          // gracefully into — it just fails outright.
          row = await patch(supabase, deepDiveId, { verdict, status: 'error' })
        } else {
          row = await patch(supabase, deepDiveId, { verdict })
        }
        break
      }
    }
  } catch (err) {
    // Transient upstream failure (rate limit, timeout, malformed output after
    // retries) — deliberately does NOT touch the row's status. The row is
    // left exactly as it was, so the client's own poll loop can simply POST
    // again to retry the identical action; MAX_REGENERATION_ATTEMPTS/
    // MASTER_REVIEW_ATTEMPT are reserved for the review panel genuinely
    // judging the content unfit, not for a network hiccup talking to
    // DeepInfra/Brave.
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    log.error('ai/deep-dive', 'unhandled error', { deepDiveId, action, error: (err as Error)?.message })
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }

  return NextResponse.json({ deepDive: row })
}

// Only MAX_REGENERATION_ATTEMPTS/MASTER_REVIEW_ATTEMPT actually vary the
// shape of what gets written per action above; this just centralizes the
// supabase update + re-select so every branch returns the same fresh row.
async function patch(
  supabase: Supa,
  id: string,
  fields: Partial<Pick<DeepDiveRow, 'status' | 'attempt' | 'draft' | 'verdict' | 'master_guidance' | 'result'>>
): Promise<DeepDiveRow> {
  const { error } = await supabase.from('project_deep_dives').update(fields).eq('id', id)
  if (error) throw error
  const row = await getDeepDive(supabase, id)
  if (!row) throw new Error(`project_deep_dives row ${id} disappeared mid-update`)
  return row
}
