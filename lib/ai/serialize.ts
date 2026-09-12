// House → compact prompt text. Turns the persistable house payload (the shape
// serializeContent produces) into a labeled plaintext outline the model reads.
// Layers map 1:1 onto the seven build steps (see lib/build/content.ts):
//   1 Frame · 2 Perspectives · 3 Evidence · 4 Assumptions · 5 Conclusion
//   6 Implications · 7 Review.
//
// Pure function, no server imports. Type-only imports from lib/build/types are
// client-safe. (No direct tests yet; the router/persistence suites cover its
// callers — see lib/ai/router.test.ts and lib/build/persistence.test.ts.)

import type {
  Concept,
  Perspective,
  Evidence,
  Assumption,
  Implication,
  AiContext,
} from '@/lib/build/types'
import { formatProjectContextLines, type ProjectContext } from '@/lib/projects/data'

// The persistable subset of State, as parsed back from serializeContent. Optional
// aiContext / mode are populated by later phases; harmless to render now.
export interface HouseForPrompt {
  title?: string
  purpose?: string
  question?: string
  conclusion?: string
  reasoning?: string
  concepts?: Concept[]
  perspectives?: Perspective[]
  evidence?: Evidence[]
  assumptions?: Assumption[]
  pos?: Implication[]
  neg?: Implication[]
  unc?: Implication[]
  watchpoints?: string[]
  aiContext?: AiContext | null
  mode?: string
}

// Clip bounds (from plans/active/ai/01-foundation.md).
const PROSE = 400
const ITEM = 240
const SOURCE = 80
const MAX_CONCEPTS = 20
const MAX_PERSPECTIVES = 10
const MAX_SUBQS = 4
const MAX_PEVIDENCE = 3
const MAX_COUNTERS = 3
const MAX_EVIDENCE = 20
const MAX_ASSUMPTIONS = 15
const MAX_IMPLICATIONS = 10
const MAX_WATCHPOINTS = 10
const MAX_FACTS = 8
const HARD_CAP_CONTEXT = 800
const HARD_CAP = 14_000

function clip(s: string | undefined, max: number): string {
  const t = (s ?? '').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1).trimEnd() + '…'
}

// A layer with no content renders as "— (empty)" so the model sees the gap.
function section(lines: string[]): string {
  return lines.length > 0 ? lines.join('\n') : '— (empty)'
}

// Business mode (decision 021, Phase 3, plans/active/business-mode/
// 03-accumulating-context.md): an extension of the CONTEXT (from interview)
// mechanism just below, not a new injection point — same section shape, same
// clip/cap discipline, just a second optional source the model reads the
// same way. `projectContext` is caller-supplied (Collab routes have no DB
// access to the house by design — invariant 4); RLS is what actually gates
// which project a caller may ever see, same trust boundary as `content`
// itself, which every one of these routes already accepts wholesale.
export function serializeHouseForPrompt(
  content: HouseForPrompt,
  focusStep?: number,
  projectContext?: ProjectContext | null
): string {
  const out: string[] = []

  const header = (step: number, label: string) => {
    const focus = step === focusStep ? '  >> FOCUS' : ''
    out.push(`\n## Layer ${step} — ${label}${focus}`)
  }

  out.push(`# House: ${clip(content.title, PROSE) || '(untitled)'}`)
  if (content.aiContext && (content.aiContext.summary || content.aiContext.facts?.length)) {
    out.push('\n## CONTEXT (from interview)')
    if (content.aiContext.summary) out.push(clip(content.aiContext.summary, HARD_CAP_CONTEXT))
    for (const f of (content.aiContext.facts ?? []).slice(0, MAX_FACTS)) {
      out.push(`- ${clip(f, ITEM)}`)
    }
  }
  const projectLines = formatProjectContextLines(projectContext, MAX_FACTS)
  if (projectLines.length > 0) {
    out.push('\n## CONTEXT (from project)')
    for (const line of projectLines) out.push(clip(line, ITEM))
  }

  // Layer 1 — Frame: purpose, question, concepts.
  header(1, 'Frame')
  out.push(`Purpose: ${clip(content.purpose, PROSE) || '— (empty)'}`)
  out.push(`Question: ${clip(content.question, PROSE) || '— (empty)'}`)
  const concepts = (content.concepts ?? []).slice(0, MAX_CONCEPTS)
  out.push('Concepts:')
  out.push(
    section(
      concepts.map((c) => {
        const def = clip(c.definition, ITEM)
        return `- ${clip(c.term, ITEM)}${def ? `: ${def}` : ''}`
      })
    )
  )

  // Layer 2 — Perspectives.
  header(2, 'Perspectives')
  const perspectives = (content.perspectives ?? []).slice(0, MAX_PERSPECTIVES)
  if (perspectives.length === 0) {
    out.push('— (empty)')
  } else {
    for (const p of perspectives) {
      out.push(`- ${clip(p.name, ITEM) || '(unnamed)'} [${p.owner ?? 'you'}]`)
      if (p.summary) out.push(`  summary: ${clip(p.summary, ITEM)}`)
      if (p.stance) out.push(`  stance: ${clip(p.stance, ITEM)}`)
      const subs = (p.subQuestions ?? []).slice(0, MAX_SUBQS)
      for (const s of subs) out.push(`  · sub-Q: ${clip(s.q, ITEM)}`)
      const pev = (p.supportingEvidence ?? []).slice(0, MAX_PEVIDENCE)
      for (const e of pev) out.push(`  · evidence: ${clip(e.text, ITEM)} (${clip(e.source, SOURCE)})`)
      const counters = (p.counters ?? []).slice(0, MAX_COUNTERS)
      for (const c of counters) out.push(`  · counter: ${clip(c, ITEM)}`)
    }
  }

  // Layer 3 — Evidence.
  header(3, 'Evidence')
  const evidence = (content.evidence ?? []).slice(0, MAX_EVIDENCE)
  out.push(
    section(
      evidence.map((e) => `- ${clip(e.text, ITEM)} (${clip(e.source, SOURCE) || 'no source'})`)
    )
  )

  // Layer 4 — Assumptions.
  header(4, 'Assumptions')
  const assumptions = (content.assumptions ?? []).slice(0, MAX_ASSUMPTIONS)
  out.push(section(assumptions.map((a) => `- ${clip(a.text, ITEM)}`)))

  // Layer 5 — Conclusion.
  header(5, 'Conclusion')
  out.push(`Conclusion: ${clip(content.conclusion, PROSE) || '— (empty)'}`)
  out.push(`Reasoning: ${clip(content.reasoning, PROSE) || '— (empty)'}`)

  // Layer 6 — Implications (three kinds).
  header(6, 'Implications')
  const implLines = (kind: string, list?: Implication[]) =>
    (list ?? [])
      .slice(0, MAX_IMPLICATIONS)
      .map((x) => `- [${kind}] ${clip(x.text, ITEM)} (${x.horizon}${x.who ? `, ${clip(x.who, SOURCE)}` : ''})`)
  const implications = [
    ...implLines('positive', content.pos),
    ...implLines('negative', content.neg),
    ...implLines('uncertain', content.unc),
  ]
  out.push(section(implications))

  // Layer 7 — Review: watchpoints.
  header(7, 'Review')
  const watchpoints = (content.watchpoints ?? []).slice(0, MAX_WATCHPOINTS)
  out.push('Watchpoints:')
  out.push(section(watchpoints.map((w) => `- ${clip(w, ITEM)}`)))

  const text = out.join('\n')
  if (text.length <= HARD_CAP) return text
  return text.slice(0, HARD_CAP - 20).trimEnd() + '\n…[house truncated]'
}
