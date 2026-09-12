// POST /api/ai/suggest — the co-pilot's live suggestions for one layer.
//
// Pure function: house JSON in → findings out (invariant 4). It never writes the
// DB; persistence rides the existing autosave path. Works for both builder routes
// (/build/[id] and anonymous /house) — neither auth nor identity is read here.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeJSON, AiError } from '@/lib/ai/router'
import { enforceAiLimit } from '@/lib/ai/limits'
import { getCallerCapabilities, getCallerWorkspaceMode } from '@/lib/auth/account'
import { PERSONA, suggestBlock } from '@/lib/ai/prompts'
import { serializeHouseForPrompt, type HouseForPrompt } from '@/lib/ai/serialize'
import { FindingsResponseSchema } from '@/lib/ai/findings'
import { normalizeProjectContext } from '@/lib/projects/data'

// 30 → 60 (2026-08-18, alongside the suggestor lane's Cerebras→DeepInfra
// swap and its ATTEMPT_TIMEOUT_MS/CHAIN_DEADLINE_MS bump, router-lanes.ts /
// router.ts): DeepInfra's own attempt real-verified live needing more than
// 20s for this route's actual prompt size (SUGGEST_BLOCK's fuller ask).
// Vercel Hobby + Fluid Compute's real ceiling is confirmed elsewhere in this
// codebase (router-lanes.ts's DEEPINFRA_SWARM_TIMEOUT_MS history) to be
// 300s, so 60s has real margin left.
export const maxDuration = 60

const MAX_BODY_BYTES = 100 * 1024

const AiContextSchema = z.object({
  summary: z.string(),
  facts: z.array(z.string()),
})

const RequestSchema = z.object({
  // House shape is validated defensively by serialize; accept any object here.
  house: z.record(z.string(), z.unknown()),
  step: z.number().int().min(1).max(7),
  mode: z.enum(['learn', 'decide']),
  // Optional; the house payload already carries aiContext, but a caller may send
  // it separately — the serializer picks up whichever is present.
  aiContext: AiContextSchema.nullish(),
  // Business mode (decision 021, Phase 3): the owning project's accumulated
  // context, if any — client-supplied because this route has no DB access to
  // the house by design (invariant 4). Loosely typed and normalized below
  // (normalizeProjectContext) rather than schema-validated: this is the
  // caller's own data, same trust boundary as `house` itself.
  projectContext: z.unknown().optional(),
})

export async function POST(req: Request): Promise<Response> {
  // Rate-limit gate first (pooled across all AI routes).
  try {
    await enforceAiLimit(req)
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  // Guard body size before parsing (protects tokens and memory).
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
  const { house, step, mode, aiContext, projectContext } = parsed.data

  // Authoritative posture gate (plan phase 1): a student is pinned to Learn
  // regardless of the mode the client sent, so the co-pilot can never be coaxed
  // into Decide-mode answers. Non-students keep the requested mode.
  const caps = await getCallerCapabilities()
  const effectiveMode = caps.forcedMode ?? mode
  // Business mode (decision 021): read once from the caller's own profile —
  // never from the request body.
  const workspaceMode = await getCallerWorkspaceMode()

  const houseForPrompt: HouseForPrompt = {
    ...(house as HouseForPrompt),
    aiContext: aiContext ?? (house as HouseForPrompt).aiContext ?? null,
  }
  const system = `${PERSONA}\n\n${suggestBlock(workspaceMode)}`
  const user = `Mode: ${effectiveMode}\n\n${serializeHouseForPrompt(houseForPrompt, step, normalizeProjectContext(projectContext))}`

  try {
    const { findings } = await completeJSON({
      role: 'suggestor',
      system,
      user,
      schema: FindingsResponseSchema,
      schemaName: 'copilot_findings',
      effort: 'low',
      maxTokens: 1400,
    })

    // Belt to the schema's braces (invariants 1 & 3): evidence enters only via
    // Research Mode, and a finding must target the focused layer.
    const filtered = findings.filter(
      (f) => f.layer === step && f.action?.kind !== 'add_evidence'
    )

    return NextResponse.json({ findings: filtered })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }
}
