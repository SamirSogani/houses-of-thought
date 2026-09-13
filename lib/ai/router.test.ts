// Failover state-machine tests for the multi-LLM router. The most intricate
// logic in the repo previously had no validation other than live paid traffic;
// these cases pin the semantics that decisions 012/013 and the ai-subsystem
// plan (Phase 0) define. A fake client is injected via __setClientFactory, so
// no keys or network are involved; module-global state resets per test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  completeJSON,
  dailyLimitsExhausted,
  drafterLaneStress,
  probeTargets,
  __resetRouterState,
  __setClientFactory,
} from './router'
import { supportsJsonSchema } from './router-shared'
import { TARGETS } from './router-config'

// Every default target must look configured (record()/laneStep read these).
const KEY_ENVS = [
  'MISTRAL_MINISTRAL_8B_API_KEY',
  'DEEP_INFRA_API_KEY',
  'GROQ_QWEN_3_POINT_6_27B_API_KEY',
  'GROQ_OPENAI_GPT_OSS_20B_API_KEY',
  'GEMINI_FLASH_2_POINT_5_API_KEY',
  'CEREBRAS_GPT_OSS_120B_API_KEY',
  'OPENROUTER_API_KEY',
]
for (const k of KEY_ENVS) process.env[k] = 'test-key'

// deepinfra's entry is read live from TARGETS (router-config.ts), not
// hand-typed — a hardcoded duplicate here already went stale once (2026-08-13,
// the DeepSeek-V3 swap broke 4 assertions comparing recorded call.model
// against this fixture) even though the ORIGINAL intent, per the comment this
// replaced, was for this fixture not to need touching on a model swap.
// Importing the real value is what actually delivers that intent going
// forward — every other entry here stays a plain dummy string since nothing
// asserts on their exact value the way deepinfra's does.
const MODELS = {
  mistral: 'ministral-8b-latest',
  deepinfra: TARGETS.deepinfra.model,
  deepinfraLarge: TARGETS.deepinfraLarge.model,
  deepinfraCritic: TARGETS.deepinfraCritic.model,
  groqQwen: 'qwen/qwen3.6-27b',
  groqOss: 'openai/gpt-oss-20b',
  gemini: 'gemini-2.5-flash',
  cerebras: 'gpt-oss-120b',
  openrouter: 'qwen/qwen3-coder:free',
}

interface Call {
  provider: string
  model: string
  params: Record<string, unknown>
}

const OK = '{"ok":true}'
const Schema = z.object({ ok: z.boolean() })

// Per-test behavior: return content, or throw. Keyed off model + provider (and
// call order via the calls array when a test needs "first call fails, second
// succeeds"). provider is threaded through (not just model) so tests stay
// correct even if deepinfra and groq ever serve the same model id again — see
// MODELS comment above.
let script: (model: string, params: Record<string, unknown>, provider: string) => string
const calls: Call[] = []

function makeErr(status: number | undefined, message = 'provider error'): Error {
  const e = new Error(message) as Error & { status?: number }
  if (status !== undefined) e.status = status
  return e
}

function ask(
  role: 'coach' | 'critic' | 'suggestor' | 'drafter' | 'swarm' | 'synthesis',
  overrides: {
    effort?: 'low' | 'high'
    user?: string
    allowHighReasoning?: boolean
    // Auto-repair tests (completeJSON's third pass) need string/array `.max()`
    // constraints Schema doesn't have — everything else keeps using the
    // shared default so those tests stay untouched.
    schema?: z.ZodType<unknown>
    schemaName?: string
    // Per-step DeepInfra tier within role 'swarm' (router-lanes.ts's
    // SwarmTier) — ignored by every other role, same as production.
    swarmTier?: 'draft' | 'large' | 'critic'
  } = {}
) {
  return completeJSON({
    role,
    system: 'sys',
    user: overrides.user ?? 'hi',
    schema: overrides.schema ?? Schema,
    schemaName: overrides.schemaName ?? 'test',
    effort: overrides.effort ?? 'low',
    allowHighReasoning: overrides.allowHighReasoning,
    swarmTier: overrides.swarmTier,
    maxTokens: 100,
  })
}

beforeEach(() => {
  __resetRouterState()
  calls.length = 0
  script = () => OK
  __setClientFactory((t) => ({
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          calls.push({ provider: t.provider, model: t.model, params })
          const content = script(t.model, params, t.provider)
          return { choices: [{ message: { content } }] }
        },
      },
    },
  }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('lane order and 429 cascade', () => {
  it('suggestor walks deepinfra → mistral → groq on failures and stops at first success', async () => {
    script = (m) => {
      if (m === MODELS.deepinfra || m === MODELS.mistral) throw makeErr(429, 'rate limit')
      return OK
    }
    await expect(ask('suggestor')).resolves.toEqual({ ok: true })
    // provider, not model — deepinfra and groq can share a model id (see
    // MODELS comment above).
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'mistral', 'groq'])
  })

  it('realtime (coach|critic) tries mistral second, right after deepinfra, before groq', async () => {
    script = (m) => (m === MODELS.deepinfra ? (() => { throw makeErr(429, 'rate limit') })() : OK)
    await expect(ask('critic')).resolves.toEqual({ ok: true })
    // provider, not model — deepinfra and groq now share the same model id.
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'mistral'])
  })
})

describe('swarm and synthesis lanes (reasoning pipeline only)', () => {
  // 2026-08-12, Samir, verbatim: "it should always be using deep infra (no
  // matter what for now)" — Groq/Gemini/Mistral/Cerebras removed from both
  // lanes entirely (not just reordered). Deliberate, temporary loss of
  // resilience — see router-lanes.ts's swarmAttempts()/synthesisAttempts()
  // comment for the full rationale.
  //
  // Later the same day: real production traffic showed DeepInfra's own
  // failures here (timeouts, empty completions) are intermittent, not a
  // network/rate-limit problem (confirmed via DeepInfra's own dashboard —
  // received, billed, no rate limit flagged) — so both lanes now retry the
  // SAME target DEEPINFRA_SAME_TARGET_ATTEMPTS times before giving up. Still
  // zero other providers — these cases assert exactly that: multiple calls,
  // all to deepinfra, never anything else.

  it('swarm succeeds via deepinfra alone on the first attempt', async () => {
    script = () => OK
    await expect(ask('swarm')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra'])
  })

  it('swarm retries deepinfra itself and recovers after a transient failure', async () => {
    let n = 0
    script = () => (n++ === 0 ? (() => { throw makeErr(429, 'rate limit') })() : OK)
    await expect(ask('swarm')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'deepinfra'])
  })

  it('swarm exhausts every deepinfra attempt before failing — no other provider is ever tried', async () => {
    script = () => { throw makeErr(429, 'rate limit') }
    await expect(ask('swarm')).rejects.toThrow()
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'deepinfra', 'deepinfra'])
  })

  it('swarm with allowHighReasoning (repair mode) also retries deepinfra itself, no fallback', async () => {
    script = () => { throw makeErr(429, 'rate limit') }
    await expect(ask('swarm', { allowHighReasoning: true })).rejects.toThrow()
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'deepinfra', 'deepinfra'])
  })

  it('swarm ignores the shared groq penalty box — still deepinfra-only', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'))
    // Open the penalty box via the realtime lane first (mirrors the 'groq
    // penalty box' describe block below) — proves swarm no longer reads
    // that shared, account-level Groq state at all now that Groq isn't in
    // its chain.
    script = (m) =>
      m === MODELS.mistral || m === MODELS.deepinfra || m === MODELS.groqQwen
        ? (() => { throw makeErr(429, 'rate limit') })()
        : OK
    await ask('coach')

    calls.length = 0
    script = () => OK
    await expect(ask('swarm')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra'])
  })

  it('synthesis succeeds via deepinfra alone on the first attempt', async () => {
    script = () => OK
    await expect(ask('synthesis')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra'])
  })

  it('synthesis retries deepinfra itself and recovers after a transient failure', async () => {
    let n = 0
    script = () => (n++ === 0 ? (() => { throw makeErr(429, 'rate limit') })() : OK)
    await expect(ask('synthesis')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'deepinfra'])
  })

  it('synthesis exhausts every deepinfra attempt before failing — no other provider is ever tried', async () => {
    script = () => { throw makeErr(429, 'rate limit') }
    await expect(ask('synthesis')).rejects.toThrow()
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'deepinfra', 'deepinfra'])
  })

  it('synthesis ignores the shared groq penalty box — still deepinfra-only', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'))
    script = (m) =>
      m === MODELS.mistral || m === MODELS.deepinfra || m === MODELS.groqQwen
        ? (() => { throw makeErr(429, 'rate limit') })()
        : OK
    await ask('coach') // opens the shared penalty box

    calls.length = 0
    script = () => OK
    await expect(ask('synthesis')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra'])
  })
})

describe('swarm per-step model tiers (2026-09-12)', () => {
  it('defaults to the shared "draft" model when swarmTier is omitted', async () => {
    await expect(ask('swarm')).resolves.toEqual({ ok: true })
    expect(calls[0].model).toBe(MODELS.deepinfra)
  })

  it("'large' tier (perspectives/global-assumptions generation) uses the large model", async () => {
    await expect(ask('swarm', { swarmTier: 'large' })).resolves.toEqual({ ok: true })
    expect(calls[0].model).toBe(MODELS.deepinfraLarge)
  })

  it("'critic' tier (review panels/master review) uses the critic model", async () => {
    await expect(ask('swarm', { swarmTier: 'critic' })).resolves.toEqual({ ok: true })
    expect(calls[0].model).toBe(MODELS.deepinfraCritic)
  })

  it('each tier still retries the SAME target 3x on failure, never cascades to another tier', async () => {
    let n = 0
    script = () => (n++ < 2 ? (() => { throw makeErr(429, 'rate limit') })() : OK)
    await expect(ask('swarm', { swarmTier: 'large' })).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.deepinfraLarge, MODELS.deepinfraLarge, MODELS.deepinfraLarge])
  })

  it('synthesis (final-composition) ignores swarmTier — always the shared draft model', async () => {
    await expect(ask('synthesis', { swarmTier: 'large' })).resolves.toEqual({ ok: true })
    expect(calls[0].model).toBe(MODELS.deepinfra)
  })
})

describe('groq penalty box', () => {
  it('opens on a groq 429, diverts realtime traffic for 30s, then recovers on gpt-oss-20b', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'))

    // Call 1: deepinfra 429 → mistral 429 (fallback also down) → groq qwen
    // 429 (opens penalty) → gemini serves. Checked by PROVIDER throughout this
    // test, not model: deepinfra and groq's post-recovery fallback both serve
    // openai/gpt-oss-20b (see MODELS comment above), which would misfire once
    // groq recovers onto that model in call 3 below if checked by model alone.
    script = (_m, _params, provider) => {
      if (provider === 'mistral' || provider === 'deepinfra' || provider === 'groq') throw makeErr(429, 'rate limit')
      return OK
    }
    await expect(ask('coach')).resolves.toEqual({ ok: true })
    expect(calls.at(-1)?.provider).toBe('google')

    // Call 2, inside the 30s box: groq is skipped entirely (mistral also
    // down this call, so the chain still needs to reach gemini to prove it).
    calls.length = 0
    script = (_m, _params, provider) => {
      if (provider === 'mistral' || provider === 'deepinfra') throw makeErr(429, 'rate limit')
      return OK
    }
    await ask('coach')
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'mistral', 'google'])

    // Call 3, after the box clears: groq returns on the SAFER model until a
    // success clears recovery.
    vi.setSystemTime(new Date('2026-07-16T12:00:31Z'))
    calls.length = 0
    await ask('coach')
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'mistral', 'groq'])
    expect(calls.at(-1)?.model).toBe(MODELS.groqOss) // the safer post-recovery model

    // Call 4: recovery cleared by the success — back on qwen.
    calls.length = 0
    await ask('coach')
    expect(calls.map((c) => c.provider)).toEqual(['deepinfra', 'mistral', 'groq'])
    expect(calls.at(-1)?.model).toBe(MODELS.groqQwen)
  })
})

describe('daily airbag (per provider)', () => {
  const DAILY = 'You exceeded your requests per day quota'

  it('one provider daily-exhausted does NOT reach OpenRouter while others merely rate-limit', async () => {
    script = (m) => {
      if (m === MODELS.gemini) throw makeErr(429, DAILY)
      throw makeErr(429, 'per-minute rate limit') // cerebras, groq: transient only
    }
    await expect(ask('drafter')).rejects.toMatchObject({ status: 429, message: 'ai-rate-limited' })
    expect(calls.some((c) => c.model === MODELS.openrouter)).toBe(false)
    expect(dailyLimitsExhausted()).toBe(true) // gemini marked, monitor signal
  })

  it('fires OpenRouter only when the whole lane is daily-exhausted, and skips marked providers', async () => {
    script = (m) => {
      if ([MODELS.gemini, MODELS.cerebras, MODELS.groqOss].includes(m)) {
        throw makeErr(429, DAILY)
      }
      return OK
    }
    await expect(ask('drafter')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([
      MODELS.groqOss,
      MODELS.gemini,
      MODELS.cerebras,
      MODELS.openrouter,
    ])

    // Next drafter request: all four marked providers are skipped without a call.
    calls.length = 0
    await expect(ask('drafter')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.openrouter])
  })
})

describe('drafter lane stress signal', () => {
  const DAILY = 'You exceeded your requests per day quota'

  it('is none with no daily exhaustion', () => {
    expect(drafterLaneStress()).toBe('none')
  })

  it('is degraded once groq is daily-exhausted but fallbacks stay healthy', async () => {
    script = (m) => (m === MODELS.groqOss ? (() => { throw makeErr(429, DAILY) })() : OK)
    await ask('drafter')
    expect(drafterLaneStress()).toBe('degraded')
  })

  it('is critical once groq is out and a fallback also shows elevated recent failures', async () => {
    // Call 1: groq daily-exhausts, gemini serves.
    script = (m) => (m === MODELS.groqOss ? (() => { throw makeErr(429, DAILY) })() : OK)
    await ask('drafter')
    expect(drafterLaneStress()).toBe('degraded')

    // Call 2: groq now skipped (daily-exhausted); gemini rate-limits, cerebras serves —
    // gemini's recent event ratio (1 rate-limited of 2) crosses the stress threshold.
    script = (m) => (m === MODELS.gemini ? (() => { throw makeErr(429, 'rate limit') })() : OK)
    await ask('drafter')
    expect(drafterLaneStress()).toBe('critical')
  })
})

describe('transient vs terminal errors', () => {
  it('5xx cascades to the next target', async () => {
    script = (m) => {
      if (m === MODELS.deepinfra) throw makeErr(500)
      return OK
    }
    await expect(ask('coach')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.deepinfra, MODELS.mistral])
  })

  it('timeout/network (no status) cascades', async () => {
    script = (m) => {
      if (m === MODELS.deepinfra) throw makeErr(undefined, 'Request timed out.')
      return OK
    }
    await expect(ask('coach')).resolves.toEqual({ ok: true })
    expect(calls.length).toBe(2)
  })

  it('a sunset model id (404) cascades instead of killing the lane', async () => {
    script = (m) => {
      if (m === MODELS.deepinfra) throw makeErr(404, 'model not found')
      return OK
    }
    await expect(ask('coach')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.deepinfra, MODELS.mistral])
  })

  it('empty generation cascades', async () => {
    script = (m) => (m === MODELS.deepinfra ? '' : OK)
    await expect(ask('coach')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.deepinfra, MODELS.mistral])
  })

  it("Groq's json_validate_failed (its own generation failing strict-schema validation) cascades, not thrown as a terminal 400", async () => {
    script = (m) => {
      if (m === MODELS.groqOss) {
        throw makeErr(400, 'Failed to generate JSON. json_validate_failed invalid_request_error')
      }
      return OK
    }
    await expect(ask('drafter')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.groqOss, MODELS.gemini])
  })

  it('401 is terminal (misconfiguration must surface)', async () => {
    script = () => {
      throw makeErr(401)
    }
    await expect(ask('coach')).rejects.toMatchObject({ status: 401, message: 'ai-unauthorized' })
    expect(calls.length).toBe(1)
  })

  it('400 is terminal', async () => {
    script = () => {
      throw makeErr(400, 'invalid request')
    }
    await expect(ask('coach')).rejects.toMatchObject({ status: 400, message: 'ai-bad-request' })
    expect(calls.length).toBe(1)
  })

  it('5xx on every target surfaces ai-upstream-error after the full walk', async () => {
    script = () => {
      throw makeErr(503)
    }
    await expect(ask('coach')).rejects.toMatchObject({ status: 502, message: 'ai-upstream-error' })
    expect(calls.length).toBe(5) // whole realtime lane tried (now incl. deepinfra), no airbag
  })
})

describe('size-aware routing and overflow', () => {
  it('a large request skips small-window targets and lands on gemini', async () => {
    await expect(ask('suggestor', { user: 'x'.repeat(600_000) })).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.gemini])
  })

  it('a request too large for every window is 413 ai-context-overflow without any call', async () => {
    await expect(ask('drafter', { user: 'x'.repeat(4_200_000) })).rejects.toMatchObject({
      status: 413,
      message: 'ai-context-overflow',
    })
    expect(calls.length).toBe(0)
  })

  it('a provider-reported context overflow escalates to the next target', async () => {
    script = (m) => {
      if (m === MODELS.deepinfra) throw makeErr(400, 'maximum context length exceeded')
      return OK
    }
    await expect(ask('coach')).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.model)).toEqual([MODELS.deepinfra, MODELS.mistral])
  })
})

describe('chain deadline', () => {
  it('stops attempting once the deadline passes and throws the last transient error', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'))
    script = (m) => {
      if (m === MODELS.deepinfra) {
        // Simulate an attempt that consumed the whole budget before failing.
        vi.setSystemTime(new Date('2026-07-16T12:00:27Z'))
        throw makeErr(500)
      }
      return OK
    }
    await expect(ask('coach')).rejects.toMatchObject({ status: 502, message: 'ai-upstream-error' })
    expect(calls.length).toBe(1) // no further attempts after the deadline
  })
})

describe('completeJSON self-correction', () => {
  it('retries once with a truncated schema error and succeeds', async () => {
    let first = true
    script = () => {
      if (first) {
        first = false
        return '{"ok":"not-a-boolean"}'
      }
      return OK
    }
    await expect(ask('suggestor')).resolves.toEqual({ ok: true })
    expect(calls.length).toBe(2)
    const retryUser = (calls[1].params.messages as { content: string }[])[1].content
    expect(retryUser).toContain('did not match the required schema')
    // Compact single-issue feedback, not zod's full stringified issue array.
    expect(retryUser).toContain('ok:')
    expect(retryUser.length).toBeLessThan(600)
  })

  it('two schema failures surface as 502 ai-invalid-output', async () => {
    script = () => '{"ok":"still-wrong"}'
    await expect(ask('suggestor')).rejects.toMatchObject({
      status: 502,
      message: 'ai-invalid-output',
    })
    expect(calls.length).toBe(2)
  })
})

describe('completeJSON auto-repair (third pass, no extra call)', () => {
  // Fires only after BOTH the first attempt and the schema-error retry fail
  // — script below returns the same oversized shape both times, so these
  // exercise the real "two real failures, then a local code-only repair"
  // path, not a mocked shortcut.

  it('repairs an oversized string field to its schema cap and succeeds', async () => {
    const schema = z.object({ note: z.string().max(10) })
    script = () => '{"note":"1234567890AB"}' // 12 chars, no spaces — hard cut, no word boundary
    await expect(ask('suggestor', { schema, schemaName: 'repair-test' })).resolves.toEqual({
      note: '1234567890',
    })
    expect(calls.length).toBe(2) // no third HTTP call — repair is local
  })

  it('repairs an oversized array field to its schema cap by dropping the excess tail', async () => {
    const schema = z.object({ options: z.array(z.string()).max(3) })
    script = () => '{"options":["a","b","c","d"]}'
    await expect(ask('suggestor', { schema, schemaName: 'repair-test' })).resolves.toEqual({
      options: ['a', 'b', 'c'],
    })
    expect(calls.length).toBe(2)
  })

  it('repairs a mix of oversized string and array fields in one pass', async () => {
    const schema = z.object({ note: z.string().max(5), options: z.array(z.string()).max(2) })
    script = () => '{"note":"toolong","options":["a","b","c"]}'
    await expect(ask('suggestor', { schema, schemaName: 'repair-test' })).resolves.toEqual({
      note: 'toolo',
      options: ['a', 'b'],
    })
    expect(calls.length).toBe(2)
  })

  it('does not repair when a non-oversized issue is also present — still 502s', async () => {
    // note is oversized (repairable) but count is missing entirely (not a
    // too_big issue at all) — isRepairableIssue must reject the WHOLE set,
    // not repair what it can and ignore the rest.
    const schema = z.object({ note: z.string().max(5), count: z.number() })
    script = () => '{"note":"toolong"}'
    await expect(ask('suggestor', { schema, schemaName: 'repair-test' })).rejects.toMatchObject({
      status: 502,
      message: 'ai-invalid-output',
    })
    expect(calls.length).toBe(2)
  })
})

describe('json shape guardrail and defensive unwrap', () => {
  it('appends the shape guardrail to the system prompt for json_schema-mode models', async () => {
    await ask('drafter') // groq gpt-oss-20b primary — supportsJsonSchema() = true
    const systemContent = (calls[0].params.messages as { content: string }[])[0].content
    expect(systemContent).toContain('do not wrap it in an array')
  })

  it('json_object-mode models get the schema described in-prompt instead (no guardrail line needed)', async () => {
    // deepinfra is coach's primary and now schema-granted (Qwen3.8-2.4T-A95B)
    // — fail it so mistral (never schema-granted) is the model actually
    // inspected here.
    script = (m) => (m === MODELS.deepinfra ? (() => { throw makeErr(429, 'rate limit') })() : OK)
    await ask('coach')
    const systemContent = (calls[1].params.messages as { content: string }[])[0].content
    expect(systemContent).toContain('Respond with a single JSON object and nothing else')
    expect(systemContent).not.toContain('do not wrap it in an array')
  })

  it('unwraps a single-element array around an otherwise-valid object, no retry needed', async () => {
    script = () => '[{"ok":true}]'
    await expect(ask('suggestor')).resolves.toEqual({ ok: true })
    expect(calls.length).toBe(1) // accepted on the first attempt
  })

  it('does not unwrap a multi-element array — still fails through the normal retry path', async () => {
    script = () => '[{"ok":true},{"ok":false}]'
    await expect(ask('suggestor')).rejects.toMatchObject({ status: 502, message: 'ai-invalid-output' })
    expect(calls.length).toBe(2)
  })

  it('does not unwrap a single-element array whose contents also fail the schema', async () => {
    script = () => '[{"ok":"not-a-boolean"}]'
    await expect(ask('suggestor')).rejects.toMatchObject({ status: 502, message: 'ai-invalid-output' })
    expect(calls.length).toBe(2)
  })
})

describe('markdown code fence stripping', () => {
  // Defensive fix (2026-08-13) for the failure real-verified on DeepInfra's
  // meta-llama/Llama-3.3-70B-Instruct-Turbo (see TARGETS.deepinfra's comment,
  // router-config.ts): the model wrapped otherwise-valid JSON in a markdown
  // code fence on 4/4 real attempts. Runs unconditionally in tryParse
  // (router.ts, stripMarkdownFence), not gated to json_object-mode models.

  it('parses JSON wrapped in a bare ``` fence, no retry needed', async () => {
    script = () => '```\n{"ok":true}\n```'
    await expect(ask('suggestor')).resolves.toEqual({ ok: true })
    expect(calls.length).toBe(1) // accepted on the first attempt
  })

  it('parses JSON wrapped in a ```json language-tagged fence, no retry needed', async () => {
    script = () => '```json\n{"ok":true}\n```'
    await expect(ask('suggestor')).resolves.toEqual({ ok: true })
    expect(calls.length).toBe(1)
  })

  it('tolerates surrounding whitespace/newlines around a fenced response', async () => {
    script = () => '\n\n  ```json\n{"ok":true}\n```  \n\n'
    await expect(ask('suggestor')).resolves.toEqual({ ok: true })
    expect(calls.length).toBe(1)
  })

  it('a fenced response that still fails the schema goes through the normal retry path, not a silent pass', async () => {
    script = () => '```json\n{"ok":"not-a-boolean"}\n```'
    await expect(ask('suggestor')).rejects.toMatchObject({ status: 502, message: 'ai-invalid-output' })
    expect(calls.length).toBe(2)
  })
})

describe('reasoning_effort mapping', () => {
  it('gemini gets low (not passthrough high) and none (not undefined); mistral omits', async () => {
    // drafter now leads with Groq (gpt-oss-20b) — fail it so the chain reaches Gemini.
    script = (m) => {
      if (m === MODELS.groqOss) throw makeErr(429, 'rate limit')
      return OK
    }
    await ask('drafter', { effort: 'high' })
    expect(calls.at(-1)?.params.reasoning_effort).toBe('low')

    calls.length = 0
    await ask('drafter', { effort: 'low' })
    expect(calls.at(-1)?.params.reasoning_effort).toBe('none')

    calls.length = 0
    script = () => OK
    await ask('coach', { effort: 'high' }) // mistral primary
    expect(calls.at(-1)?.params).not.toHaveProperty('reasoning_effort')
  })

  // gpt-oss/qwen used to both be reachable as the 'suggestor' role's primary
  // (Cerebras gpt-oss-120b) or its tail (Groq qwen), which is what these two
  // assertions rode before 2026-08-18's Cerebras→DeepInfra swap
  // (router-lanes.ts's suggestorAttempts()) moved suggestor's primary off
  // gpt-oss entirely. Split out here, each reached directly via its own
  // role/lane rather than piggybacking on suggestor's now-unrelated chain.
  it('gpt-oss capped at its floor (low) regardless of requested effort', async () => {
    // drafter's own real primary is Groq gpt-oss-20b — no need to force a
    // fallback the way the gemini case above does.
    script = () => OK
    await ask('drafter', { effort: 'high' })
    // 'high' was confirmed live to starve the actual JSON output of its
    // token budget (reasoningEffortFor, router-shared.ts) — capped to 'low'.
    expect(calls.at(-1)?.model).toBe(MODELS.groqOss)
    expect(calls.at(-1)?.params.reasoning_effort).toBe('low')
  })

  it('qwen capped at its floor (none, not passthrough high) without allowHighReasoning', async () => {
    // Force suggestor's new DeepInfra primary and Mistral both to fail so
    // the chain reaches Groq's qwen fallback (same lane-order this file's
    // 'suggestor walks deepinfra → mistral → groq' test already pins).
    script = (m) => {
      if (m === MODELS.deepinfra || m === MODELS.mistral) throw makeErr(429, 'rate limit')
      return OK
    }
    await ask('suggestor', { effort: 'high' })
    expect(calls.at(-1)?.model).toBe(MODELS.groqQwen)
    expect(calls.at(-1)?.params.reasoning_effort).toBe('none')
  })

  // DeepInfra's current model (deepseek-ai/DeepSeek-V4-Flash-0731,
  // TARGETS.deepinfra) matches neither the gpt-oss nor qwen branch of
  // reasoningEffortFor — same "omits the param" behavior as Mistral, not a
  // capped value. Documents this explicitly so a future DeepInfra model swap
  // that lands on a gpt-oss/qwen-family model is a visible, deliberate
  // decision (this test starts failing) rather than a silent behavior change.
  it('deepinfra (suggestor primary) omits reasoning_effort — current model matches neither capped family', async () => {
    script = () => OK
    await ask('suggestor', { effort: 'high' })
    expect(calls.at(-1)?.model).toBe(MODELS.deepinfra)
    expect(calls.at(-1)?.params).not.toHaveProperty('reasoning_effort')
  })
})

describe('probes', () => {
  it('sends the same structured-output shape as live traffic', async () => {
    const results = await probeTargets()
    expect(results.every((r) => r.up)).toBe(true)
    for (const call of calls) {
      const rf = call.params.response_format as { type: string }
      expect(rf).toBeDefined()
      // Real supportsJsonSchema() (router-shared.ts), not a re-derived guess
      // here — this exact assertion went stale once already (2026-08-13, the
      // DeepSeek-V3 swap) when it hardcoded 'gpt-oss' instead of importing
      // the real classifier.
      expect(rf.type).toBe(supportsJsonSchema(call.model) ? 'json_schema' : 'json_object')
    }
  })

  it('an AiError never leaks from a failing probe', async () => {
    script = () => {
      throw makeErr(400, 'response_format not supported')
    }
    const results = await probeTargets()
    expect(results.every((r) => !r.up && r.status === 'error')).toBe(true)
  })
})
