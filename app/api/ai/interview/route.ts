// POST /api/ai/interview — the context-intake interviewer. Asks one question at
// a time; when it has enough, returns a distilled `context` (summary + facts)
// that every other AI call then reads (invariant 4: pure, no DB writes). Only the
// distilled context persists — the transcript is ephemeral (privacy surface).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeJSON, AiError } from '@/lib/ai/router'
import { enforceAiLimit } from '@/lib/ai/limits'
import { getCallerWorkspaceMode } from '@/lib/auth/account'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/log'
import { PERSONA, interviewBlock } from '@/lib/ai/prompts'
import { serializeHouseForPrompt, type HouseForPrompt } from '@/lib/ai/serialize'
import { normalizeProjectContext } from '@/lib/projects/data'
import { retrieveProjectChunks, formatRagChunksForPrompt, type RagSourceType } from '@/lib/ai/rag'

export const maxDuration = 30

// Body cap is now generous: an oversized prompt routes to Gemini's ~1M window
// (size-aware routing in lib/ai/router.ts), so we no longer need a tight 100 KB
// ceiling — only an abuse guard.
const MAX_BODY_BYTES = 512 * 1024
// At/above SOFT we conclude the interview gracefully (force the summary) rather
// than erroring, so a long conversation never loses the context gathered so far.
// HARD is a true abuse ceiling that still rejects.
const SOFT_TRANSCRIPT = 14
const HARD_TRANSCRIPT = 60
// Recent turns kept verbatim in the prompt; older ones are condensed so prompt
// size (and cost) stays bounded regardless of conversation length.
const PROMPT_KEEP_RECENT = 10

type Turn = { role: 'user' | 'assistant'; content: string }

// Fold a long transcript to its opening turn + the most recent PROMPT_KEEP_RECENT,
// eliding the middle. Keeps the prompt bounded; the intake still concludes from
// what was said (the model is told to summarise from the conversation so far).
function buildConvo(transcript: Turn[]): string {
  if (transcript.length === 0) return '(no conversation yet — ask your first question)'
  const fmt = (t: Turn) => `${t.role === 'user' ? 'Person' : 'Co-pilot'}: ${t.content}`
  if (transcript.length <= PROMPT_KEEP_RECENT + 1) return transcript.map(fmt).join('\n')
  const head = fmt(transcript[0])
  const recent = transcript.slice(-PROMPT_KEEP_RECENT).map(fmt).join('\n')
  return `${head}\n(…earlier turns condensed for length…)\n${recent}`
}

const RequestSchema = z.object({
  house: z.record(z.string(), z.unknown()),
  transcript: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      // Bounds one pasted turn: without this, a single turn under the 512 KB
      // body cap could push ~125k input tokens onto the large-window lane.
      content: z.string().max(4000),
    })
  ),
  forceSummary: z.boolean().optional(),
  // Business mode (decision 021, Phase 3): see suggest/route.ts's own comment
  // on this same field — client-supplied, normalized rather than schema-
  // validated, same trust boundary as `house`.
  projectContext: z.unknown().optional(),
  // Business mode (decision 021, Phase 5): the house's project, for RAG
  // retrieval below. Client-supplied but RLS-safe — retrieveProjectChunks
  // can only ever return rows the caller's own owner_id already covers, same
  // trust boundary as projectContext just above.
  projectId: z.string().uuid().optional(),
})

// context is non-null iff done — enforced by the refine, not just the prompt:
// a done+null reply fails the parse and rides completeJSON's self-correction
// retry instead of reaching the client, which would treat it as "another turn"
// and loop paid wrap-up calls. (The refine is parse-only; z.toJSONSchema skips
// it, so the schema sent to providers is unchanged.)
const InterviewResponseSchema = z
  .object({
    reply: z.string(),
    done: z.boolean(),
    context: z
      .object({ summary: z.string(), facts: z.array(z.string()) })
      .nullable(),
  })
  .refine((r) => !r.done || r.context !== null, {
    message: 'context must be non-null when done is true',
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
  const { house, transcript, forceSummary, projectContext, projectId } = parsed.data

  // Only reject on genuine abuse. A merely-long interview wraps up gracefully
  // below instead of 413-ing, so the intake work is never lost.
  if (transcript.length > HARD_TRANSCRIPT) {
    return NextResponse.json({ error: 'transcript-too-long' }, { status: 413 })
  }
  const mustWrapUp = forceSummary || transcript.length >= SOFT_TRANSCRIPT

  // completeJSON takes a single user message, so the running conversation is
  // folded (and, when long, condensed) into the prompt rather than sent as turns.
  const convo = buildConvo(transcript as Turn[])

  // Business mode (decision 021): read once from the caller's own profile —
  // never from the request body. Both modes get the interviewer either way.
  const workspaceMode = await getCallerWorkspaceMode()
  const block = interviewBlock(workspaceMode)
  const system = mustWrapUp
    ? `${PERSONA}\n\n${block}\n\nYou must finish NOW: set done=true and produce the context.`
    : `${PERSONA}\n\n${block}`

  // The closing directive goes LAST in the user message (most recent instruction)
  // so a low-effort model reliably wraps up instead of asking another question.
  const closing = mustWrapUp
    ? 'STOP INTERVIEWING. Do NOT ask another question. Set done=true and output context (summary + facts) now, using only what has already been said.'
    : 'Produce the next interview step as JSON.'

  // RAG retrieval (Phase 5, decision 021): only when business mode AND the
  // client actually named a project — a general-mode caller incurs ZERO
  // embedding-generation cost, full stop, regardless of whether they have
  // projects (the plan doc's own explicit manual-verification bullet).
  // Query text: the house's own typed question if set, else the most recent
  // thing the person said — there's often no question yet this early in an
  // interview. ragSources (label per retrieved chunk) rides back to the
  // client so InterviewCard can show, in the UI, that this used the
  // person's own project material — never presented as Research Mode's
  // Brave-sourced evidence (decision 021 §5's UI-distinction requirement).
  const houseForPrompt = house as HouseForPrompt
  const lastUserTurn = [...(transcript as Turn[])].reverse().find((t) => t.role === 'user')?.content ?? ''
  const retrievalQuery = (houseForPrompt.question || lastUserTurn).trim()
  let ragBlock = ''
  const ragSources: { sourceType: RagSourceType; label: string }[] = []
  if (workspaceMode === 'business' && projectId && retrievalQuery) {
    try {
      const supabase = await createClient()
      const chunks = await retrieveProjectChunks(supabase, projectId, retrievalQuery, 5)
      ragBlock = formatRagChunksForPrompt(chunks)
      const docIds = [...new Set(chunks.filter((c) => c.sourceType === 'document' && c.sourceId).map((c) => c.sourceId as string))]
      const filenameById = new Map<string, string>()
      if (docIds.length > 0) {
        const { data: docs } = await supabase.from('project_documents').select('id, filename').in('id', docIds)
        for (const d of (docs ?? []) as { id: string; filename: string }[]) filenameById.set(d.id, d.filename)
      }
      for (const c of chunks) {
        ragSources.push({
          sourceType: c.sourceType,
          label: c.sourceType === 'document' && c.sourceId ? (filenameById.get(c.sourceId) ?? 'a document') : 'your project notes',
        })
      }
    } catch (err) {
      // Retrieval failing must never break the interview itself — the
      // interview still works exactly as it did before Phase 5.
      log.error('ai/interview', 'RAG retrieval failed', { error: (err as Error)?.message })
    }
  }

  const user = `${serializeHouseForPrompt(houseForPrompt, undefined, normalizeProjectContext(projectContext))}${ragBlock ? `\n\n${ragBlock}` : ''}\n\n## Conversation so far\n${convo}\n\n${closing}`

  try {
    // Context-intake can accumulate a large prompt (house + transcript). The
    // router is size-aware: if this exceeds the fast model's window it routes to
    // Gemini's ~1M window automatically, and a genuine overflow escalates rather
    // than erroring — so no special handling is needed here.
    const result = await completeJSON({
      role: 'coach',
      system,
      user,
      schema: InterviewResponseSchema,
      schemaName: 'interview_step',
      effort: 'low',
      maxTokens: 600,
    })
    // ragSources: [] on every general-mode / no-project / nothing-retrieved
    // call — always present so the client never has to special-case its
    // absence, but empty means exactly what it says (decision 021 §5).
    return NextResponse.json({ ...result, ragSources })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'ai-upstream-error' }, { status: 502 })
  }
}
