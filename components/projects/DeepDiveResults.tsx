'use client'

// Phase 4 (plans/active/project-deep-dives/04-save-to-project.md): renders a
// 'done' Deep Dive row's own `result` and the per-item "Save to project"
// action, one component per domain plus the dispatcher
// (DeepDiveResultView) that app/projects/[id]/deep-dive/[domain]/page.tsx
// renders for each history entry. Split out of that page (rather than left
// inline) once adding this pushed the page past this repo's ~600 LOC
// guideline (CLAUDE.md) — purely a size split, no behavior difference from
// having it inline.
//
// "One fact per item" choice per domain (see each renderer's own comment for
// the reasoning): Research folds in source (title + URL) so a saved claim
// stays traceable; Perspectives saves label + summary as one coherent
// standpoint rather than fragmenting into per-key_claim facts; Assumptions
// folds in risk_if_false since it reads naturally as one clause; Implications
// folds in horizon + who since a bare `text` reads as unmoored once lifted
// out of its card.

import { SaveFactsToProjectButton } from '@/components/build/SaveToProjectButton'
import { safeHttpUrl } from '@/lib/safeUrl'
import type { DeepDiveDomain } from '@/lib/projects/deepDives'
// Type-only: erased at compile time (same discipline as lib/ai/reasoning/
// budget.ts's own import of DrafterLaneStress), so this never pulls any of
// these four modules' server-only runtime guard (each throws if it ever
// evaluates with `window` defined) into this client component's bundle —
// only the shape of each domain's result array, needed to render it, comes
// along.
import type { DeepDiveResearchCandidate } from '@/lib/ai/reasoning/deep-dive-research'
import type { DeepDiveStandpoint } from '@/lib/ai/reasoning/deep-dive-perspectives'
import type { DeepDiveAssumption } from '@/lib/ai/reasoning/deep-dive-assumptions'
import type { DeepDiveImplicationItem } from '@/lib/ai/reasoning/deep-dive-implications'

const resultCardStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 9,
  padding: 12,
  background: 'var(--parchment)',
}
const resultRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginTop: 10,
  gap: 8,
  flexWrap: 'wrap',
}
const resultListStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }

// One `<a>` domain-of-URL chip — same "no bare unsafe href" discipline as
// components/build/layers/ResearchResults.tsx's own domainOf/safeHttpUrl
// pairing (Add-to-house's own evidence rendering), reused here rather than
// re-derived since a Deep Dive research candidate's url is the same
// Brave-validated shape.
function SourceLink({ url, label }: { url: string; label: string }) {
  const href = safeHttpUrl(url)
  if (!href) return <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)' }}>{label}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mono"
      style={{ fontSize: 9, color: 'var(--blueprint)', background: 'rgba(62,92,138,0.09)', borderRadius: 4, padding: '3px 7px', textDecoration: 'none' }}
    >
      {label}
    </a>
  )
}

// Research: one fact per candidate, the claim with its source folded in
// parenthetically (title + URL) so a fact saved out of this list still
// traces back to what supports it — the same reason ResearchResults.tsx
// never lets a claim travel without its source chip alongside it.
function ResearchResultList({ candidates, projectId, onSaved }: { candidates: DeepDiveResearchCandidate[]; projectId: string; onSaved: () => void }) {
  return (
    <div style={resultListStyle}>
      {candidates.map((c, i) => (
        <div key={i} style={resultCardStyle}>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{c.claim}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-subtle)', lineHeight: 1.45, marginTop: 5 }}>{c.quoteOrParaphrase}</div>
          <div style={resultRowStyle}>
            <SourceLink url={c.url} label={c.sourceTitle} />
            <SaveFactsToProjectButton projectId={projectId} facts={[`${c.claim} (source: ${c.sourceTitle}, ${c.url})`]} onSaved={onSaved} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Perspectives: one fact per standpoint, label + summary — not one fact per
// key_claim. A standpoint's whole point is that it's argued as a single
// coherent position (deep-dive-perspectives.ts's own system prompt: "argue
// each one as if held with conviction"); splitting it into its 1-6 key_claims
// would turn one considered viewpoint into several bare assertions that read
// as generic once separated from the standpoint that argues for them, and
// would multiply save buttons per card for little benefit. key_claims still
// render below the summary so nothing is hidden, just not separately savable.
function PerspectivesResultList({ standpoints, projectId, onSaved }: { standpoints: DeepDiveStandpoint[]; projectId: string; onSaved: () => void }) {
  return (
    <div style={resultListStyle}>
      {standpoints.map((s, i) => (
        <div key={i} style={resultCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.45 }}>{s.label}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, marginTop: 5 }}>{s.summary}</div>
          {s.key_claims.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {s.key_claims.map((claim, j) => (
                <li key={j} style={{ fontSize: 12, color: 'var(--ink-subtle)', lineHeight: 1.5, marginTop: j === 0 ? 0 : 3 }}>{claim}</li>
              ))}
            </ul>
          )}
          <div style={resultRowStyle}>
            <span />
            <SaveFactsToProjectButton projectId={projectId} facts={[`${s.label}: ${s.summary}`]} onSaved={onSaved} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Assumptions: one fact per assumption, its text with risk_if_false folded
// in — a bare assumption reads as an open question once it's sitting in the
// project's key facts list with no surrounding card; naming how damaging it
// would be if false keeps it a load-bearing note rather than a vague one.
// why_it_matters stays a display-only elaboration, not folded into the fact,
// to keep the saved string a single specific claim rather than a paragraph.
function AssumptionsResultList({ assumptions, projectId, onSaved }: { assumptions: DeepDiveAssumption[]; projectId: string; onSaved: () => void }) {
  return (
    <div style={resultListStyle}>
      {assumptions.map((a, i) => (
        <div key={i} style={resultCardStyle}>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{a.assumption}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-subtle)', lineHeight: 1.45, marginTop: 5 }}>{a.why_it_matters}</div>
          <div style={resultRowStyle}>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)', textTransform: 'uppercase' }}>Risk if false: {a.risk_if_false}</span>
            <SaveFactsToProjectButton
              projectId={projectId}
              facts={[`${a.assumption} (risk if false: ${a.risk_if_false})`]}
              onSaved={onSaved}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// Implications: one fact per item, its `text` (the field name in
// DeepDiveImplicationItemSchema, lib/ai/reasoning/deep-dive-implications.ts —
// not the packet-level shape's other fields) with horizon + who folded in,
// same reasoning as Research folding in its source: an implication lifted
// alone into the project's key facts reads as unmoored without knowing who
// bears it and over what timeframe, both of which the model is required to
// name but doesn't repeat inside `text` itself.
function ImplicationsResultList({ items, projectId, onSaved }: { items: DeepDiveImplicationItem[]; projectId: string; onSaved: () => void }) {
  const ikindLabel: Record<DeepDiveImplicationItem['ikind'], string> = { pos: 'Positive', neg: 'Negative', unc: 'Uncertain' }
  return (
    <div style={resultListStyle}>
      {items.map((item, i) => (
        <div key={i} style={resultCardStyle}>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{item.text}</div>
          <div style={resultRowStyle}>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-subtle)', textTransform: 'uppercase' }}>
              {ikindLabel[item.ikind]} · {item.horizon} · {item.who}
            </span>
            <SaveFactsToProjectButton
              projectId={projectId}
              facts={[`${item.text} (${item.horizon.toLowerCase()}, affecting ${item.who})`]}
              onSaved={onSaved}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// Dispatches a 'done' row's own `result` (untyped jsonb, DeepDiveRow's
// `unknown | null`) to the one renderer actually wired for `domain` — a
// plain switch on the same domain enum the generation engine itself
// dispatches on (app/api/ai/deep-dive/route.ts's runDeepDiveGenerate), each
// case casting to that domain's own result-array type before rendering. No
// runtime schema-detection: the page already knows which domain it's on.
export function DeepDiveResultView({ domain, result, projectId, onSaved }: { domain: DeepDiveDomain; result: unknown; projectId: string; onSaved: () => void }) {
  switch (domain) {
    case 'research':
      return <ResearchResultList candidates={result as DeepDiveResearchCandidate[]} projectId={projectId} onSaved={onSaved} />
    case 'perspectives':
      return <PerspectivesResultList standpoints={result as DeepDiveStandpoint[]} projectId={projectId} onSaved={onSaved} />
    case 'assumptions':
      return <AssumptionsResultList assumptions={result as DeepDiveAssumption[]} projectId={projectId} onSaved={onSaved} />
    case 'implications':
      return <ImplicationsResultList items={result as DeepDiveImplicationItem[]} projectId={projectId} onSaved={onSaved} />
  }
}
