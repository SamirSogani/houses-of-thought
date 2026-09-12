// POST /api/ai/research — Research Mode. Evidence comes from live Brave results
// with real URLs, never model memory (invariant 3). Pure function: house in →
// candidate evidence out; the user Adds each one explicitly (invariant 2).
//
// The load-bearing guarantee is step 4: every returned candidate's URL is one of
// the Brave URLs from THIS request. Anything else is dropped — we never backfill.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeJSON, AiError } from '@/lib/ai/router'
import { enforceAiLimit } from '@/lib/ai/limits'
import { braveSearch } from '@/lib/ai/brave'
import { getCallerWorkspaceMode } from '@/lib/auth/account'
import { PERSONA, QUERY_BLOCK, researchBlock } from '@/lib/ai/prompts'
import { serializeHouseForPrompt, type HouseForPrompt } from '@/lib/ai/serialize'
import { normalizeProjectContext } from '@/lib/projects/data'

export const maxDuration = 30

const MAX_BODY_BYTES = 100 * 1024

const RequestSchema = z.object({
  house: z.record(z.string(), z.unknown()),
  query: z.string().optional(),
  // Business mode (decision 021, Phase 3): see suggest/route.ts's own comment
  // on this same field.
  projectContext: z.unknown().optional(),
})

const QuerySchema = z.object({ query: z.string() })

const CandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        claim: z.string(),
        quoteOrParaphrase: z.string(),
        sourceTitle: z.string(),
        url: z.string(),
      })
    )
    .max(5),
})

export async function POST(req: Request): Promise<Response> {
  try {
    await enforceAiLimit(req)
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

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
  const { house, projectContext } = parsed.data
  const houseForPrompt = house as HouseForPrompt
  // Project context folds in here (both the query-derivation and synthesis
  // calls below read houseText) — it's informational, not a rules variant
  // like workspaceMode, so both benefit equally.
  const houseText = serializeHouseForPrompt(houseForPrompt, undefined, normalizeProjectContext(projectContext))
  // Business mode (decision 021): read once from the caller's own profile —
  // never from the request body. Only the synthesis step's evidence framing
  // varies; the query-derivation call below stays on the plain QUERY_BLOCK.
  const workspaceMode = await getCallerWorkspaceMode()

  try {
    // 1. Query: user-typed focus, else derive one from the house.
    let query = parsed.data.query?.trim() ?? ''
    if (!query) {
      // Not the sidebar suggestor — this internal query-derivation stays on the
      // Mistral-first real-time lane (coach), so only the sidebar rides Cerebras.
      const derived = await completeJSON({
        role: 'coach',
        system: `${PERSONA}\n\n${QUERY_BLOCK}`,
        user: houseText,
        schema: QuerySchema,
        schemaName: 'search_query',
        effort: 'low',
        maxTokens: 200,
      })
      query = derived.query.trim()
    }
    if (!query) return NextResponse.json({ candidates: [], query: '' })

    // 2. Search.
    const results = await braveSearch(query, 6)
    if (results.length === 0) return NextResponse.json({ candidates: [], query })

    // 3. Synthesis from the results only.
    const numbered = results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`)
      .join('\n\n')
    const { candidates } = await completeJSON({
      role: 'drafter',
      system: `${PERSONA}\n\n${researchBlock(workspaceMode)}`,
      user: `${houseText}\n\n## Search results (query: "${query}")\n${numbered}`,
      schema: CandidatesSchema,
      schemaName: 'research_candidates',
      effort: 'high',
      // reasoning_effort:'high' spends tokens on reasoning first; 1200 leaves
      // nothing for the JSON output (Groq returns json_validate_failed with an
      // empty generation). Give the output room after the reasoning budget.
      maxTokens: 4000,
    })

    // 4. Hard validation: keep only candidates whose URL is one Brave returned.
    const allowed = new Set(results.map((r) => r.url))
    const validated = candidates.filter((c) => allowed.has(c.url))

    return NextResponse.json({ candidates: validated, query })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }
}
