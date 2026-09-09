// Bounded-retry logic for the Perspectives layer (decision 019, Phase 1.5 #1)
// — the one layer that regenerates per-bundle instead of hard-blocking. This
// pins the two properties that matter and can't be exercised live today
// (provider capacity is too unstable to reach real perspectives review, see
// plans/active/reasoning-pipeline/05): a settled bundle (passed, or already
// degraded) is never re-asked-for or re-reviewed, and a still-failing bundle
// degrades only once MAX_REGENERATION_ATTEMPTS is actually exhausted.
//
// Evidence generation (2026-08-13, Samir) is its own 3-phase split —
// strategy/populate/confidence, each tested in its own describe block below.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EvidenceItemDraft,
  EvidenceStrategy,
  FramePacket,
  PerspectiveBundle,
  PerspectivePartialBundle,
  PerspectiveStance,
  ReviewPanelVerdict,
} from './contracts'
import { STANDARD_IDS } from './contracts'
import { MAX_REGENERATION_ATTEMPTS } from './budget'

const completeJSONMock = vi.fn()
const runSearchesMock = vi.fn()
vi.mock('@/lib/ai/router', () => ({
  completeJSON: (...args: unknown[]) => completeJSONMock(...args),
}))
vi.mock('./search', () => ({ runSearches: (...args: unknown[]) => runSearchesMock(...args) }))

const runReviewPanelMock = vi.fn()
vi.mock('./orchestrator-panel', () => ({ runReviewPanel: (...args: unknown[]) => runReviewPanelMock(...args) }))

const {
  runPerspectivesGenerateDetails,
  runPerspectivesEvidenceStrategy,
  runPerspectivesEvidencePopulate,
  runPerspectivesEvidenceConfidence,
  runPerspectivesReview,
  collectEvidenceGatherUnits,
  flattenEvidenceGatherAnswers,
  PerspectivesGenerateError,
} = await import('./orchestrator-perspectives')

const frame: FramePacket = {
  original_query: 'Should our school ban homework?',
  core_question: 'Should our school ban homework?',
  definitions: [],
  purpose: 'test',
  scope_notes: 'test',
}

function stance(id: string, label: string): PerspectiveStance {
  return { perspective_id: id, stance_label: label, stance_summary: 'summary', key_claims: ['claim'] }
}

function partial(id: string, label: string): PerspectivePartialBundle {
  return {
    ...stance(id, label),
    sub_questions: ['q'],
    assumptions: ['a'],
    counterargument: { authored_by_perspective_id: 'other', target_claims: ['claim'], rebuttals: ['r'] },
  }
}

function bundle(id: string, label: string): PerspectiveBundle {
  return { ...partial(id, label), evidence: [] }
}

function verdict(overall_pass: boolean, degraded = false): ReviewPanelVerdict {
  const standards = Object.fromEntries(
    STANDARD_IDS.map((id) => [id, { pass: overall_pass, notes: overall_pass ? 'fine' : `${id} failed` }])
  ) as ReviewPanelVerdict['standards']
  return { subject_id: 'p1', standards, overall_pass, degraded }
}

beforeEach(() => {
  completeJSONMock.mockReset()
  runSearchesMock.mockReset()
  runReviewPanelMock.mockReset()
  completeJSONMock.mockResolvedValue({})
  runSearchesMock.mockResolvedValue('(search findings)')
  // The perspectives fan-out steps stagger their calls via real setTimeout
  // (SWARM_STAGGER_MS, a small fixed spacing — see orchestrator-perspectives.ts).
  // Fake timers keep these tests fast regardless of that constant's value;
  // vi.runAllTimersAsync() below flushes every pending stagger delay instead
  // of a test actually waiting on it.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('runPerspectivesGenerateDetails', () => {
  it('generates every bundle fresh when there is no prior verdict', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    completeJSONMock.mockResolvedValue({ sub_questions: ['q'], assumptions: ['a'], target_claims: ['c'], rebuttals: ['r'] })
    const resultPromise = runPerspectivesGenerateDetails(frame, stances, false)
    await vi.runAllTimersAsync()
    const partials = await resultPromise
    expect(partials).toHaveLength(2)
    // 3 sub-elements (sub_questions/assumptions/counterargument) x 2 bundles
    // — evidence moved out to its own 3 steps, no longer part of this call.
    expect(completeJSONMock).toHaveBeenCalledTimes(6)
  })

  it('regenerates only the failing bundle, leaving a settled one untouched', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    const priorPartials = [partial('p1', 'A'), partial('p2', 'B')]
    const priorVerdicts = [verdict(false), verdict(true)] // p1 failed, p2 already passed
    const priorAttempts = [1, 1]

    completeJSONMock.mockResolvedValue({ sub_questions: ['regenerated'], assumptions: ['a'], target_claims: ['c'], rebuttals: ['r'] })
    const resultPromise = runPerspectivesGenerateDetails(frame, stances, false, {
      priorPartials,
      priorVerdicts,
      priorAttempts,
    })
    await vi.runAllTimersAsync()
    const partials = await resultPromise

    // p2 (settled) is the exact same object back — never regenerated.
    expect(partials[1]).toBe(priorPartials[1])
    // p1 (failing) went through completeJSON again.
    expect(completeJSONMock).toHaveBeenCalledTimes(3) // only p1's 3 sub-elements

    // The regeneration prompt actually carries the prior artifact + failing notes.
    const userPrompts = completeJSONMock.mock.calls.map((c) => (c[0] as { user: string }).user)
    expect(userPrompts.every((u) => u.includes('Your previous attempt'))).toBe(true)
    expect(userPrompts.every((u) => u.includes('clarity failed'))).toBe(true)
  })

  it('never regenerates a bundle that already exhausted its attempts and degraded', async () => {
    const stances = [stance('p1', 'A')]
    const priorPartials = [partial('p1', 'A')]
    const priorVerdicts = [verdict(false, true)] // failed AND degraded — settled, gave up
    const priorAttempts = [MAX_REGENERATION_ATTEMPTS]

    const partials = await runPerspectivesGenerateDetails(frame, stances, false, {
      priorPartials,
      priorVerdicts,
      priorAttempts,
    })

    expect(partials[0]).toBe(priorPartials[0])
    expect(completeJSONMock).not.toHaveBeenCalled()
  })

  // 2026-08-12, Samir: the old stress-scaled DRAFTER_STAGGER_MS (up to 20s,
  // 4x under detected stress) was retired — it existed to protect Groq's TPM
  // budget, which no longer applies now that this lane is DeepInfra-only (see
  // SWARM_STAGGER_MS in orchestrator-perspectives.ts). It's now a small fixed
  // spacing regardless of drafter-lane health, purely to avoid firing every
  // call in the same instant.
  it('staggers each of the 3n calls by a small fixed spacing, not a stress-scaled one', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    completeJSONMock.mockResolvedValue({ sub_questions: ['q'], assumptions: ['a'], target_claims: ['c'], rebuttals: ['r'] })

    const spy = vi.spyOn(global, 'setTimeout')
    const resultPromise = runPerspectivesGenerateDetails(frame, stances, false)
    await vi.runAllTimersAsync()
    await resultPromise
    // Flattened across bundles AND sub-elements (i*3+j) * 150ms — indices 0-5 for n=2.
    expect(spy.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining([0, 150, 300, 450, 600, 750]))
    spy.mockRestore()
  })

  // 2026-08-13, Samir: track WHICH sub-element(s), for WHICH perspective(s),
  // actually failed — motivated by chasing an opaque "the step failed" through
  // Vercel logs that had already expired (doc 23's whole 1-hour-retention
  // saga). Promise.allSettled (not Promise.all) means every sub-element that
  // failed is captured, not just whichever one happened to reject first.
  it('throws PerspectivesGenerateError naming every failed sub-element, for every affected perspective', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    completeJSONMock.mockImplementation((opts: unknown) => {
      const schemaName = (opts as { schemaName: string }).schemaName
      if (schemaName === 'perspective_subquestions') return Promise.reject(new Error('ai-empty-output'))
      return Promise.resolve({ assumptions: ['a'], target_claims: ['c'], rebuttals: ['r'] })
    })
    const resultPromise = runPerspectivesGenerateDetails(frame, stances, false)
    // Catch handler attached in the SAME expression that advances the fake
    // timers (not a separate `await vi.runAllTimersAsync()` statement first)
    // — otherwise the promise can reject in the gap before anything is
    // listening, which vitest reports as an unhandled rejection even though
    // it's caught a tick later.
    let caught: InstanceType<typeof PerspectivesGenerateError> | null = null
    try {
      await Promise.all([resultPromise, vi.runAllTimersAsync()])
    } catch (err) {
      caught = err as InstanceType<typeof PerspectivesGenerateError>
    }
    expect(caught).toBeInstanceOf(PerspectivesGenerateError)
    const failures = caught!.failures
    expect(failures).toHaveLength(2)
    expect(failures.every((f) => f.subElement === 'sub_questions')).toBe(true)
    expect(failures.map((f) => f.perspectiveId).sort()).toEqual(['p1', 'p2'])
    expect(failures.every((f) => f.errorMessage === 'ai-empty-output')).toBe(true)
  })

  it('captures multiple distinct sub-element failures on the SAME bundle, not just one', async () => {
    const stances = [stance('p1', 'A')]
    completeJSONMock.mockImplementation((opts: unknown) => {
      const schemaName = (opts as { schemaName: string }).schemaName
      if (schemaName === 'perspective_subquestions') return Promise.reject(new Error('ai-upstream-error'))
      if (schemaName === 'perspective_assumptions') return Promise.reject(new Error('ai-empty-output'))
      return Promise.resolve({ target_claims: ['c'], rebuttals: ['r'] })
    })
    const resultPromise = runPerspectivesGenerateDetails(frame, stances, false)
    let caught: InstanceType<typeof PerspectivesGenerateError> | null = null
    try {
      await Promise.all([resultPromise, vi.runAllTimersAsync()])
    } catch (err) {
      caught = err as InstanceType<typeof PerspectivesGenerateError>
    }
    expect(caught).toBeInstanceOf(PerspectivesGenerateError)
    expect(caught!.failures).toHaveLength(2)
    expect(caught!.failures.map((f) => f.subElement).sort()).toEqual(['assumptions', 'sub_questions'])
  })
})

describe('runPerspectivesEvidenceStrategy', () => {
  it('returns one strategy per stance, fresh when there is no prior verdict', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    completeJSONMock.mockResolvedValue({ search_queries: [], needs_user_input: false, questions_for_user: [], reason: 'fine' })
    const strategies = await runPerspectivesEvidenceStrategy(frame, stances, false)
    expect(strategies).toHaveLength(2)
    expect(completeJSONMock).toHaveBeenCalledTimes(2)
  })

  it('carries forward a settled unit\'s prior strategy unchanged', async () => {
    const stances = [stance('p1', 'A')]
    const priorStrategies: EvidenceStrategy[] = [{ search_queries: ['x'], needs_user_input: false, questions_for_user: [], reason: 'prior' }]
    const priorPartials = [partial('p1', 'A')]
    const priorVerdicts = [verdict(true)] // already passed — settled
    const strategies = await runPerspectivesEvidenceStrategy(frame, stances, false, false, null, { priorStrategies, priorPartials, priorVerdicts })
    expect(strategies[0]).toBe(priorStrategies[0])
    expect(completeJSONMock).not.toHaveBeenCalled()
  })

  it('dry run forces every stance to ask when forceNeedsInput is set (devForceNeedsInput UI testing)', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    const strategies = await runPerspectivesEvidenceStrategy(frame, stances, true, true)
    expect(strategies).toHaveLength(2)
    expect(strategies.every((s) => s.needs_user_input && s.questions_for_user.length > 0)).toBe(true)
    expect(completeJSONMock).not.toHaveBeenCalled()
  })
})

describe('collectEvidenceGatherUnits / flattenEvidenceGatherAnswers', () => {
  it('collects only the units that asked something, tagged with perspective id/label', () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    const strategies: EvidenceStrategy[] = [
      { search_queries: [], needs_user_input: true, questions_for_user: [{ question: 'q1', options: [] }], reason: 'need input' },
      { search_queries: ['x'], needs_user_input: false, questions_for_user: [], reason: 'search is enough' },
    ]
    const units = collectEvidenceGatherUnits(stances, strategies)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ unitId: 'p1', unitLabel: 'A' })
  })

  it('routes each unit\'s first answered question back to the right perspective, null for the rest', () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    const units = [{ unitId: 'p1', unitLabel: 'A', reason: 'need input', questions: [{ question: 'q1', options: [] }] }]
    const answered = flattenEvidenceGatherAnswers(stances, units, [['the answer']])
    expect(answered).toEqual(['the answer', null])
    const skipped = flattenEvidenceGatherAnswers(stances, units, [[null]])
    expect(skipped).toEqual([null, null])
  })
})

describe('runPerspectivesEvidencePopulate', () => {
  it('runs search only for units that requested it, and threads the results into the prompt', async () => {
    const stances = [stance('p1', 'A'), stance('p2', 'B')]
    const strategies: EvidenceStrategy[] = [
      { search_queries: ['q1'], needs_user_input: false, questions_for_user: [], reason: 'r' },
      { search_queries: [], needs_user_input: false, questions_for_user: [], reason: 'r' },
    ]
    completeJSONMock.mockResolvedValue({ evidence: [{ claim_id: 'c1', source_ref: 's1', caveats: null }] })
    const resultPromise = runPerspectivesEvidencePopulate(frame, stances, strategies, null, false)
    await vi.runAllTimersAsync()
    await resultPromise
    expect(runSearchesMock).toHaveBeenCalledTimes(1)
    expect(runSearchesMock).toHaveBeenCalledWith(['q1'])
    // Two calls run concurrently (no stagger in populate — only p1's has a
    // real search to await), so don't assume array order matches call
    // order; find p1's own call by its stance label instead.
    const userPrompts = completeJSONMock.mock.calls.map((c) => (c[0] as { user: string }).user)
    const p1Prompt = userPrompts.find((u) => u.includes('A: summary'))
    expect(p1Prompt).toContain('(search findings)')
    const p2Prompt = userPrompts.find((u) => u.includes('B: summary'))
    expect(p2Prompt).not.toContain('(search findings)')
  })

  it('threads the user\'s answer into the prompt when one was given', async () => {
    const stances = [stance('p1', 'A')]
    const strategies: EvidenceStrategy[] = [{ search_queries: [], needs_user_input: true, questions_for_user: [], reason: 'r' }]
    completeJSONMock.mockResolvedValue({ evidence: [] })
    const resultPromise = runPerspectivesEvidencePopulate(frame, stances, strategies, ['the answer'], false)
    await vi.runAllTimersAsync()
    await resultPromise
    const userPrompt = (completeJSONMock.mock.calls[0][0] as { user: string }).user
    expect(userPrompt).toContain('the answer')
  })
})

describe('runPerspectivesEvidenceConfidence', () => {
  it('matches confidence entries back to drafts by claim_id and assembles the final bundle', async () => {
    const stances = [stance('p1', 'A')]
    const partials = [partial('p1', 'A')]
    const drafts: EvidenceItemDraft[][] = [[{ claim_id: 'c1', source_ref: 's1', caveats: null }]]
    completeJSONMock.mockResolvedValue({ confidence: [{ claim_id: 'c1', confidence: 'high' }] })
    const { bundles, attempts } = await runPerspectivesEvidenceConfidence(frame, stances, partials, drafts, false)
    expect(bundles[0].evidence).toEqual([{ claim_id: 'c1', source_ref: 's1', caveats: null, confidence: 'high' }])
    expect(attempts).toEqual([1])
  })

  it('falls back to medium confidence for an item with no matching claim_id in the response', async () => {
    const stances = [stance('p1', 'A')]
    const partials = [partial('p1', 'A')]
    const drafts: EvidenceItemDraft[][] = [[{ claim_id: 'c1', source_ref: 's1', caveats: null }]]
    completeJSONMock.mockResolvedValue({ confidence: [{ claim_id: 'no-match', confidence: 'high' }] })
    const { bundles } = await runPerspectivesEvidenceConfidence(frame, stances, partials, drafts, false)
    expect(bundles[0].evidence[0].confidence).toBe('medium')
  })

  it('skips the call entirely when a bundle has no evidence items to score', async () => {
    const stances = [stance('p1', 'A')]
    const partials = [partial('p1', 'A')]
    const drafts: EvidenceItemDraft[][] = [[]]
    const { bundles } = await runPerspectivesEvidenceConfidence(frame, stances, partials, drafts, false)
    expect(bundles[0].evidence).toEqual([])
    expect(completeJSONMock).not.toHaveBeenCalled()
  })
})

describe('runPerspectivesReview', () => {
  it('reviews every bundle fresh when there is no prior verdict', async () => {
    const bundles = [bundle('p1', 'A'), bundle('p2', 'B')]
    runReviewPanelMock.mockResolvedValue(verdict(true))
    const verdicts = await runPerspectivesReview(frame, bundles, null, null, false)
    expect(verdicts).toHaveLength(2)
    expect(runReviewPanelMock).toHaveBeenCalledTimes(2)
  })

  it('does not re-review a settled bundle (passed, or already degraded)', async () => {
    const bundles = [bundle('p1', 'A'), bundle('p2', 'B')]
    const priorVerdicts = [verdict(true), verdict(false, true)]
    const verdicts = await runPerspectivesReview(frame, bundles, priorVerdicts, [1, MAX_REGENERATION_ATTEMPTS], false)
    expect(runReviewPanelMock).not.toHaveBeenCalled()
    expect(verdicts).toEqual(priorVerdicts)
  })

  it('keeps a still-failing bundle retryable below the attempt cap', async () => {
    const bundles = [bundle('p1', 'A')]
    const priorVerdicts = [verdict(false)]
    runReviewPanelMock.mockResolvedValue(verdict(false))
    const verdicts = await runPerspectivesReview(frame, bundles, priorVerdicts, [1], false)
    expect(verdicts[0].overall_pass).toBe(false)
    expect(verdicts[0].degraded).toBe(false)
  })

  it('degrades a bundle only once it fails at the final attempt', async () => {
    const bundles = [bundle('p1', 'A')]
    const priorVerdicts = [verdict(false)]
    runReviewPanelMock.mockResolvedValue(verdict(false))
    const verdicts = await runPerspectivesReview(frame, bundles, priorVerdicts, [MAX_REGENERATION_ATTEMPTS], false)
    expect(verdicts[0].overall_pass).toBe(false)
    expect(verdicts[0].degraded).toBe(true)
  })
})
