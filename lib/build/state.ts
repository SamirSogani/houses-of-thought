// Initial seed (03 §2) + reducer for every action (03 §8, 04-INTERACTIONS.md).
// Toast auto-dismiss timing lives in the view; the reducer only sets the string.

import type { Action, ImplicationKind, PersonKey, Perspective, State } from './types'
import { layerKey, framePurpose, frameQuestion, conclusionBullets, reasoningSummary, perspectiveDetails } from './content'

// Seed the demo house's perspectives with their rich detail (stance, sub-questions,
// supporting evidence, counterarguments) from content.ts, so initialState carries
// the same editable detail a user would build by hand.
const perspectiveSeed: { id: number; name: string; summary: string; strength: number; owner: PersonKey }[] = [
  { id: 1, name: 'Students', summary: 'Benefit most when AI tutors rather than answers.', strength: 78, owner: 'maya' },
  { id: 2, name: 'Teachers', summary: 'Gain prep leverage but face new oversight duties.', strength: 64, owner: 'maya' },
  { id: 3, name: 'Parents', summary: 'Supportive when given transparency and opt-outs.', strength: 55, owner: 'devan' },
  { id: 4, name: 'Society', summary: 'Benefits are real but unevenly distributed today.', strength: 60, owner: 'devan' },
  { id: 5, name: 'Employers', summary: 'Value AI-fluent graduates, reshaping entry roles.', strength: 72, owner: 'you' },
  { id: 6, name: 'Administrators', summary: 'Balance cost, liability, and measurable outcomes.', strength: 58, owner: 'you' },
]

const seededPerspectives: Perspective[] = perspectiveSeed.map((p) => {
  const d = perspectiveDetails[p.id]
  return {
    ...p,
    stance: d.stance,
    subQuestions: d.questions,
    supportingEvidence: d.evidence,
    counters: d.counters,
  }
})
import { applyAiAction } from './aiActions'
import type { AiAction } from '@/lib/ai/findings'
import {
  DRAFT_STAGE_STEP,
  emptyDraft,
  nextDraftStage,
  unclaimedDraftStages,
  type DraftStage,
} from '@/lib/ai/draft'

// Which draft stage each AiAction kind counts toward for APPLY_REASONING_RESULT
// below — mirrors lib/ai/draft.ts's DRAFT_STAGE_KINDS (the inverse mapping),
// extended with the two nested-perspective kinds add_perspective_evidence and
// add_counter (also 'perspectives', same as add_perspective/add_subquestion).
// Not exported: this bookkeeping is specific to how APPLY_REASONING_RESULT
// derives DraftState.drafted, not a general-purpose lookup other code needs.
const REASONING_ACTION_STAGE: Partial<Record<AiAction['kind'], DraftStage>> = {
  add_concept: 'concepts',
  add_perspective: 'perspectives',
  add_subquestion: 'perspectives',
  add_perspective_evidence: 'perspectives',
  add_counter: 'perspectives',
  add_evidence: 'evidence',
  add_assumption: 'assumptions',
  add_implication: 'implications',
  add_watchpoint: 'implications',
}

export const initialState: State = {
  step: 1,
  mode: 'decide',
  aiContext: null,
  draft: null,
  title: 'Should AI be used in schools?',
  purpose: framePurpose,
  question: frameQuestion,
  conclusion: conclusionBullets.join('\n\n'),
  reasoning: reasoningSummary,
  toast: '',

  concepts: [
    { term: 'Academic integrity', definition: '' },
    { term: 'Equity', definition: '' },
    { term: 'Supervision', definition: '' },
    { term: 'Data privacy', definition: '' },
  ],

  perspectives: seededPerspectives,

  evidence: [
    { id: 1, text: 'Intelligent tutoring systems raised test scores by a median of 0.66 standard deviations across 50 controlled evaluations.', source: 'Kulik & Fletcher, Review of Educational Research (2016)', url: 'https://journals.sagepub.com/doi/10.3102/0034654315581420', owner: 'you', byAI: false },
    { id: 2, text: '25 percent of U.S. K-12 teachers used AI tools for instructional planning or teaching in the 2023-24 school year.', source: 'RAND, Uneven Adoption of AI Tools (2025)', url: 'https://www.rand.org/pubs/research_reports/RRA134-25.html', owner: 'you', byAI: false },
    { id: 3, text: 'Fewer than 10 percent of schools and universities surveyed worldwide have formal guidance on using generative AI.', source: 'UNESCO global survey (2023)', url: 'https://www.unesco.org/en/articles/unesco-survey-less-10-schools-and-universities-have-formal-guidance-ai', owner: 'you', byAI: false },
  ],

  assumptions: [
    { id: 1, text: 'AI systems are accurate enough for educational use under teacher supervision.', owner: 'you' },
    { id: 2, text: 'Technology adoption in schools will continue to expand over the next decade.', owner: 'devan' },
    { id: 3, text: 'Districts can fund ongoing teacher training, not just one-time rollouts.', owner: 'maya' },
    { id: 4, text: 'Student-data privacy frameworks will mature alongside the technology.', owner: 'you' },
  ],

  pos: [
    { id: 1, text: 'Personalized tutoring at scale, especially for students with disabilities and ELLs', horizon: 'Near-term', who: 'Students' },
    { id: 2, text: 'Meaningful reduction in teacher prep and feedback time', horizon: 'Near-term', who: 'Teachers' },
    { id: 3, text: 'Stronger workforce readiness for AI-fluent roles', horizon: 'Long-term', who: 'Society' },
  ],
  neg: [
    { id: 1, text: 'Erosion of independent writing and reasoning if unsupervised', horizon: 'Long-term', who: 'Students' },
    { id: 2, text: 'Widening divide between high- and low-funding districts', horizon: 'Long-term', who: 'Society' },
    { id: 3, text: 'Compliance and liability exposure under student-privacy laws', horizon: 'Near-term', who: 'Districts' },
  ],
  unc: [
    { id: 1, text: 'Long-term impact on critical-thinking habits beyond a 1-2 year horizon', horizon: 'Long-term', who: 'Students' },
    { id: 2, text: 'Whether free AI tools will close or widen the access gap', horizon: 'Long-term', who: 'Society' },
  ],

  watchpoints: [
    'Unsupervised assessment use rising faster than teacher training can keep pace.',
    'Vendor pricing climbing sharply once districts are locked in.',
    'Early evidence that heavy AI reliance dampens independent problem-solving.',
  ],

  activePerspective: null,
  projectId: null,
  projectContext: null,
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.id), 0) + 1
}

// Replace the perspective with id `pid` by applying `fn`. Keeps the detail-edit
// cases below terse.
function mapPerspective(state: State, pid: number, fn: (p: Perspective) => Perspective): State {
  return { ...state, perspectives: state.perspectives.map((p) => (p.id === pid ? fn(p) : p)) }
}

const implicationHorizon: Record<ImplicationKind, 'Near-term' | 'Long-term'> = {
  pos: 'Near-term',
  neg: 'Near-term',
  unc: 'Long-term',
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'GO_STEP':
      return { ...state, step: Math.max(1, Math.min(7, action.n)), activePerspective: null }

    case 'SET_TITLE':
      return { ...state, title: action.value }

    case 'SET_PURPOSE':
      return { ...state, purpose: action.value }

    case 'SET_QUESTION':
      return { ...state, question: action.value }

    case 'SET_CONCLUSION':
      return { ...state, conclusion: action.value }

    case 'SET_REASONING':
      return { ...state, reasoning: action.value }

    case 'SET_MODE':
      if (action.mode === state.mode) return state
      return {
        ...state,
        mode: action.mode,
        toast:
          action.mode === 'learn'
            ? 'Co-pilot will ask questions, not give answers.'
            : 'Co-pilot will make concrete suggestions.',
      }

    case 'SET_AI_CONTEXT':
      return { ...state, aiContext: action.context }

    case 'ADD_CONCEPT':
      return { ...state, concepts: [...state.concepts, { term: '', definition: '' }] }

    case 'EDIT_CONCEPT':
      return {
        ...state,
        concepts: state.concepts.map((c, i) =>
          i === action.idx ? { ...c, [action.field]: action.value } : c
        ),
      }

    case 'REMOVE_CONCEPT':
      return { ...state, concepts: state.concepts.filter((_, i) => i !== action.idx) }

    case 'ADD_PERSPECTIVE':
      return {
        ...state,
        perspectives: [
          ...state.perspectives,
          {
            id: nextId(state.perspectives),
            name: '',
            summary: '',
            stance: '',
            subQuestions: [],
            supportingEvidence: [],
            counters: [],
            strength: 0,
            owner: 'you',
          },
        ],
        toast: 'Perspective added',
      }

    case 'EDIT_PERSPECTIVE':
      return {
        ...state,
        perspectives: state.perspectives.map((p) =>
          p.id === action.id ? { ...p, [action.field]: action.value } : p
        ),
      }

    case 'REMOVE_PERSPECTIVE':
      return {
        ...state,
        perspectives: state.perspectives.filter((p) => p.id !== action.id),
        activePerspective: state.activePerspective === action.id ? null : state.activePerspective,
      }

    case 'ADD_SUBQUESTION':
      return mapPerspective(state, action.pid, (p) => ({ ...p, subQuestions: [...p.subQuestions, { q: '', note: '' }] }))

    case 'EDIT_SUBQUESTION':
      return mapPerspective(state, action.pid, (p) => ({
        ...p,
        subQuestions: p.subQuestions.map((sq, i) => (i === action.idx ? { ...sq, [action.field]: action.value } : sq)),
      }))

    case 'REMOVE_SUBQUESTION':
      return mapPerspective(state, action.pid, (p) => ({ ...p, subQuestions: p.subQuestions.filter((_, i) => i !== action.idx) }))

    case 'ADD_PERSPECTIVE_EVIDENCE':
      return mapPerspective(state, action.pid, (p) => ({ ...p, supportingEvidence: [...p.supportingEvidence, { text: '', source: '' }] }))

    case 'EDIT_PERSPECTIVE_EVIDENCE':
      return mapPerspective(state, action.pid, (p) => ({
        ...p,
        supportingEvidence: p.supportingEvidence.map((e, i) => (i === action.idx ? { ...e, [action.field]: action.value } : e)),
      }))

    case 'REMOVE_PERSPECTIVE_EVIDENCE':
      return mapPerspective(state, action.pid, (p) => ({ ...p, supportingEvidence: p.supportingEvidence.filter((_, i) => i !== action.idx) }))

    case 'ADD_COUNTER':
      return mapPerspective(state, action.pid, (p) => ({ ...p, counters: [...p.counters, ''] }))

    case 'EDIT_COUNTER':
      return mapPerspective(state, action.pid, (p) => ({ ...p, counters: p.counters.map((c, i) => (i === action.idx ? action.value : c)) }))

    case 'REMOVE_COUNTER':
      return mapPerspective(state, action.pid, (p) => ({ ...p, counters: p.counters.filter((_, i) => i !== action.idx) }))

    case 'OPEN_PERSPECTIVE':
      return { ...state, activePerspective: action.id }

    case 'CLOSE_PERSPECTIVE':
      return { ...state, activePerspective: null }

    case 'ADD_EVIDENCE':
      return {
        ...state,
        evidence: [
          ...state.evidence,
          {
            id: nextId(state.evidence),
            text: '',
            source: '',
            owner: 'you',
            byAI: false,
          },
        ],
        toast: 'Evidence added',
      }

    case 'EDIT_EVIDENCE':
      return {
        ...state,
        evidence: state.evidence.map((e) =>
          e.id === action.id ? { ...e, [action.field]: action.value } : e
        ),
      }

    case 'REMOVE_EVIDENCE':
      return { ...state, evidence: state.evidence.filter((e) => e.id !== action.id) }

    case 'ADD_ASSUMPTION':
      return {
        ...state,
        assumptions: [
          ...state.assumptions,
          {
            id: nextId(state.assumptions),
            text: '',
            owner: 'you',
          },
        ],
        toast: 'Assumption added',
      }

    case 'EDIT_ASSUMPTION':
      return {
        ...state,
        assumptions: state.assumptions.map((a) =>
          a.id === action.id ? { ...a, text: action.value } : a
        ),
      }

    case 'REMOVE_ASSUMPTION':
      return { ...state, assumptions: state.assumptions.filter((a) => a.id !== action.id) }

    case 'ADD_IMPLICATION': {
      const { kind } = action
      const list = state[kind]
      const item = { id: nextId(list), text: '', horizon: implicationHorizon[kind], who: '' }
      return { ...state, [kind]: [...list, item] }
    }

    case 'EDIT_IMPLICATION': {
      const { kind, id, field, value } = action
      return {
        ...state,
        [kind]: state[kind].map((it) => (it.id === id ? { ...it, [field]: value } : it)),
      }
    }

    case 'TOGGLE_IMPLICATION_HORIZON': {
      const { kind, id } = action
      return {
        ...state,
        [kind]: state[kind].map((it) =>
          it.id === id
            ? { ...it, horizon: it.horizon === 'Near-term' ? 'Long-term' : 'Near-term' }
            : it
        ),
      }
    }

    case 'REMOVE_IMPLICATION': {
      const { kind, id } = action
      return { ...state, [kind]: state[kind].filter((it) => it.id !== id) }
    }

    case 'ADD_WATCHPOINT':
      return { ...state, watchpoints: [...state.watchpoints, ''] }

    case 'EDIT_WATCHPOINT':
      return {
        ...state,
        watchpoints: state.watchpoints.map((w, i) => (i === action.idx ? action.value : w)),
      }

    case 'REMOVE_WATCHPOINT':
      return { ...state, watchpoints: state.watchpoints.filter((_, i) => i !== action.idx) }

    case 'APPLY_AI_ACTION': {
      const next: State = { ...state }
      const toast = applyAiAction(next, action.action)
      if (toast === null) return state
      next.toast = toast
      return next
    }

    case 'RESTORE_CONTENT':
      // Undo (bounded history in BuildHousePage): replace only the persistable
      // content; view state (step, tabs, overlays) stays where the user is.
      return { ...state, ...action.content, toast: 'Restored' }

    case 'START_DRAFT':
      // Idempotent: a house that already has a draft record is never re-seeded.
      if (state.draft) return state
      return { ...state, draft: emptyDraft() }

    case 'APPLY_DRAFT_STAGE': {
      // Only the stage the runner is actually on may apply, so a stale or
      // duplicated response no-ops instead of double-inserting.
      if (!state.draft || state.draft.stage !== action.stage) return state
      const next: State = { ...state }
      let applied = 0
      // Perspectives land before their sub-questions: the model may emit an
      // add_subquestion ahead of the add_perspective it targets, which would
      // silently no-op (bl-L5). Stable sort, so order is otherwise preserved.
      const ordered = [...action.actions].sort(
        (a, b) =>
          Number(a.kind !== 'add_perspective') - Number(b.kind !== 'add_perspective')
      )
      for (const a of ordered) {
        if (applyAiAction(next, a) !== null) applied += 1
      }
      next.draft = {
        ...state.draft,
        stage: nextDraftStage(action.stage),
        drafted: { ...state.draft.drafted, [action.stage]: applied > 0 },
      }
      if (applied > 0) {
        // The canvas follows the build — the point of Draft Mode is watching
        // the house assemble for real, layer by layer.
        next.step = DRAFT_STAGE_STEP[action.stage]
        next.activePerspective = null
        next.toast = `Drafted ${layerKey(DRAFT_STAGE_STEP[action.stage])}`
      }
      return next
    }

    case 'APPLY_REASONING_RESULT': {
      // Only ever seeds a FRESH draft — the caller (useReasoningPipelineRunner)
      // only fires this once, on a house that was blank going in (the same
      // houseIsBlank gate that shows the "Enter reasoning pipeline" entry
      // point at all); a pre-existing draft here would mean this landed twice
      // for one run, which must no-op rather than double-insert.
      if (state.draft) return state
      const next: State = { ...state }
      // Perspectives land before anything that targets them by name
      // (sub-questions, nested evidence, counters) — same ordering fix as
      // APPLY_DRAFT_STAGE below, generalized to every perspective-targeting
      // kind now that there are four instead of two.
      const targetsPerspectiveByName = new Set<AiAction['kind']>([
        'add_subquestion',
        'add_perspective_evidence',
        'add_counter',
      ])
      const ordered = [...action.actions].sort(
        (a, b) => Number(targetsPerspectiveByName.has(a.kind)) - Number(targetsPerspectiveByName.has(b.kind))
      )
      const drafted = { ...emptyDraft().drafted }
      for (const a of ordered) {
        if (applyAiAction(next, a) === null) continue
        const stage = REASONING_ACTION_STAGE[a.kind]
        if (stage) drafted[stage] = true
      }
      next.draft = {
        via: 'reasoning-pipeline',
        stage: 'done',
        drafted,
        claimed: emptyDraft().claimed,
      }
      const anyDrafted = Object.values(drafted).some(Boolean)
      next.toast = anyDrafted ? 'Reasoning pipeline finished — review the draft' : 'Reasoning pipeline finished'
      return next
    }

    case 'APPLY_RERUN_RESULT': {
      // Unlike APPLY_REASONING_RESULT, a rerun only ever fires on a house
      // that already HAS a draft (the console is only reachable once a
      // pipeline run finished) — so there is no "must be blank" guard here;
      // instead every stage in the cascade gets its existing items cleared
      // first, so the regenerated batch replaces rather than piles on top of
      // whatever a person already claimed or hand-edited there.
      if (!state.draft) return state
      const next: State = { ...state }
      for (const stage of action.stages) {
        if (stage === 'concepts') next.concepts = []
        else if (stage === 'perspectives') {
          next.perspectives = []
          next.activePerspective = null
        } else if (stage === 'evidence') next.evidence = []
        else if (stage === 'assumptions') next.assumptions = []
        else if (stage === 'implications') {
          next.pos = []
          next.neg = []
          next.unc = []
          next.watchpoints = []
        }
      }
      // action.actions is the FULL finished run mapped to actions (every
      // packet, not just the cascade's) — deliberately not pre-filtered to
      // just the cascaded stages. Upstream stages outside the cascade are
      // untouched above, so their actions here name items already present
      // and simply no-op via applyAiAction's own dedup check (aiActions.ts)
      // — same safety net every other AI-actions surface already relies on,
      // not a new mechanism. Same perspective-before-its-sub-elements
      // ordering fix as APPLY_REASONING_RESULT above.
      const targetsPerspectiveByName = new Set<AiAction['kind']>([
        'add_subquestion',
        'add_perspective_evidence',
        'add_counter',
      ])
      const ordered = [...action.actions].sort(
        (a, b) => Number(targetsPerspectiveByName.has(a.kind)) - Number(targetsPerspectiveByName.has(b.kind))
      )
      for (const a of ordered) applyAiAction(next, a)
      next.draft = {
        ...state.draft,
        drafted: { ...state.draft.drafted, ...Object.fromEntries(action.stages.map((s) => [s, true])) },
        claimed: { ...state.draft.claimed, ...Object.fromEntries(action.stages.map((s) => [s, false])) },
      }
      next.toast = `Rerun finished — review ${action.stages.map((s) => layerKey(DRAFT_STAGE_STEP[s])).join(', ')}`
      return next
    }

    case 'STOP_DRAFT':
      if (!state.draft || state.draft.stage === 'done') return state
      return {
        ...state,
        draft: { ...state.draft, stage: 'done' },
        toast: 'Draft stopped — review what is here',
      }

    case 'CLAIM_DRAFT_LAYER': {
      // The deferred accept (decision 016 §2): only drafted, unclaimed layers
      // can be claimed.
      if (!state.draft || !state.draft.drafted[action.stage] || state.draft.claimed[action.stage])
        return state
      const claimed = {
        ...state.draft,
        claimed: { ...state.draft.claimed, [action.stage]: true },
      }
      const settled = claimed.stage === 'done' && unclaimedDraftStages(claimed).length === 0
      return {
        ...state,
        draft: claimed,
        toast: settled
          ? 'All layers claimed — the conclusion is yours to write'
          : `${layerKey(DRAFT_STAGE_STEP[action.stage])} claimed`,
      }
    }

    case 'SET_TOAST':
      return { ...state, toast: action.value }

    default:
      return state
  }
}
