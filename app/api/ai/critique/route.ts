// POST /api/ai/critique — the Socratic critic on the Review layer. At Review the
// co-pilot stops suggesting and starts challenging: it grades the whole house
// against the Paul–Elder standards and names the weakest link.
//
// COMMENTARY ONLY (invariant 6): this never feeds computeStrength — the
// deterministic House Strength score is untouched. Pure function: house in →
// critique out, no DB writes. Like /suggest, the response carries both renderings
// (note = Decide, question = Learn) and the client picks.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeJSON, AiError } from '@/lib/ai/router'
import { enforceAiLimit } from '@/lib/ai/limits'
import { getCallerCapabilities, getCallerWorkspaceMode } from '@/lib/auth/account'
import { PERSONA, critiqueBlock } from '@/lib/ai/prompts'
import { serializeHouseForPrompt, type HouseForPrompt } from '@/lib/ai/serialize'
import { normalizeProjectContext } from '@/lib/projects/data'

export const maxDuration = 30

const MAX_BODY_BYTES = 100 * 1024

// Paul–Elder standards, trimmed to the six that map cleanly onto the house.
const STANDARDS = ['clarity', 'accuracy', 'depth', 'breadth', 'logic', 'fairness'] as const

const RequestSchema = z.object({
  house: z.record(z.string(), z.unknown()),
  // Business mode (decision 021, Phase 3): see suggest/route.ts's own comment
  // on this same field.
  projectContext: z.unknown().optional(),
})

const CritiqueSchema = z.object({
  headline: z.string(),
  // Tolerates a near-miss count: models running json_object (no constrained
  // decoding) drop or duplicate a standard often enough that a strict .length(6)
  // costs a full-price chain retry and then a 502. normalizeStandards() below
  // restores the canonical exactly-6 shape the client renders.
  standards: z
    .array(
      z.object({
        standard: z.enum(STANDARDS),
        grade: z.enum(['strong', 'mixed', 'weak']),
        note: z.string(),
        question: z.string(),
      })
    )
    .min(5)
    .max(7),
  weakestLink: z.object({
    layer: z.number().int().min(1).max(7),
    why: z.string(),
    question: z.string(),
  }),
})

type Critique = z.infer<typeof CritiqueSchema>

// Exactly one entry per standard, in canonical order: first returned entry per
// standard wins; an absent standard gets an honest placeholder, never a grade
// the model didn't give.
function normalizeStandards(returned: Critique['standards']): Critique['standards'] {
  return STANDARDS.map((standard) => {
    const found = returned.find((s) => s.standard === standard)
    return (
      found ?? {
        standard,
        grade: 'mixed' as const,
        note: 'The critic did not return this standard — treat it as unexamined.',
        question: `How does the house hold up on ${standard}?`,
      }
    )
  })
}

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

  // Student posture clamp (decision 007 / audit M2): the critic returns both a
  // Socratic `question` and a concrete `note` per standard. Students are pinned
  // to coach posture everywhere, so strip the author-style `note`s server-side —
  // the invariant can't be bypassed by calling this route directly instead of
  // /suggest. Resolved once here (getCallerCapabilities reads the stored role).
  const coachOnly = (await getCallerCapabilities()).aiPosture === 'coach'
  // Business mode (decision 021): read once from the caller's own profile —
  // never from the request body.
  const workspaceMode = await getCallerWorkspaceMode()

  const system = `${PERSONA}\n\n${critiqueBlock(workspaceMode)}`
  const user = serializeHouseForPrompt(
    parsed.data.house as HouseForPrompt,
    undefined,
    normalizeProjectContext(parsed.data.projectContext)
  )

  try {
    const critique = await completeJSON({
      role: 'critic',
      system,
      user,
      schema: CritiqueSchema,
      schemaName: 'house_critique',
      effort: 'high',
      // reasoning_effort:'high' spends tokens on reasoning before any output;
      // this schema's output is large (6 standards × 2 fields + weakest link), so
      // budget generously or Groq returns json_validate_failed with empty output.
      maxTokens: 6000,
    })
    const standards = normalizeStandards(critique.standards)
    if (coachOnly) {
      return NextResponse.json({
        ...critique,
        standards: standards.map((s) => ({ ...s, note: '' })),
        weakestLink: { ...critique.weakestLink, why: '' },
      })
    }
    return NextResponse.json({ ...critique, standards })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }
}
