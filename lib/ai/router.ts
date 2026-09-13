// Multi-LLM API Routing Engine (server-only) — the execution core and public
// facade. One controller owns structured-output plumbing, the daily-blackout
// airbag, and error mapping. Every AI route calls `completeJSON` with a
// `role`; the role decides which failover lane the request rides — see
// router-lanes.ts for the five lanes and why each is ordered the way it is
// (decisions/006 model choice, 012 failover, 013 multi-provider, and 013's
// 2026-08-10 addendum for swarm/synthesis, the reasoning pipeline's own
// DeepInfra-led lanes).
//
// The module is split to honor the repo's 600-LOC rule; this file re-exports
// the whole public API so callers import only '@/lib/ai/router':
//   router-shared.ts  — AiError/AiRole, error classification, model quirks
//   router-config.ts  — providers, targets, client construction (+ test seam)
//   router-state.ts   — penalty box, per-provider daily map, health/event log
//   router-monitor.ts — admin snapshot, probes, per-model detail
//   router-lanes.ts   — per-role failover order + the reasoning behind it
//
// Groq is special. A Groq 429 is read as an *org-wide* block, so we do NOT
// immediately hop to gpt-oss-20b on the same account. Instead we open a strict
// 30s penalty box: while it is open, real-time traffic skips Groq entirely and
// diverts to Google (then Cerebras). Once the window clears, Groq is allowed
// again but on the safer fallback model gpt-oss-20b until one call succeeds.
//
// Airbag: OpenRouter / GitHub Models stay completely isolated. A per-second or
// per-minute 429 NEVER reaches them. Daily-quota exhaustion is tracked PER
// PROVIDER (UTC day): an exhausted provider is skipped for the rest of the day,
// and only when EVERY configured, size-adequate target in the attempted lane is
// daily-exhausted does OpenRouter's free model catch the request.
//
// Context window: each target declares one. We estimate a call's need (input +
// output + headroom) and SKIP any target too small for it, so a large request
// (e.g. a long context-intake interview) automatically lands on Gemini's ~1M
// window instead of 400-ing on an 8-128k model. A genuine overflow error is also
// caught and escalated to the next larger-window target rather than surfaced.
//
// Cascade discipline: 429s, context overflows, 5xx, timeouts / network errors,
// sunset-model 404s, empty generations, and Groq's json_validate_failed (its
// own strict-schema generation failing, not our request being malformed) all
// advance to the next target — provider incidents are exactly what a
// multi-target lane exists to survive. Only a genuine misconfiguration-shaped
// error (400 / 401 / 403, everything else) is thrown immediately so a real bug
// surfaces instead of being retried at full price four times.
// Latency: every attempt carries a per-role timeout and the chain a shared,
// per-role deadline (ATTEMPT_TIMEOUT_MS / CHAIN_DEADLINE_MS) so one slow-but-
// alive provider cannot eat that role's route's entire serverless budget
// (30s for most AI routes; 60s for the reasoning pipeline's swarm/synthesis,
// see CHAIN_DEADLINE_MS below). Enforced two ways: the OpenAI SDK's own
// `{ timeout }` option per callProvider() call, and — since real traffic
// (2026-09-12) showed that alone can fail to tear down a stalled connection
// — raceTimeout() as a backstop that abandons a hung attempt on schedule
// regardless of whether the underlying request ever actually gets killed.

import type OpenAI from 'openai'
import { z } from 'zod'
import { log } from '@/lib/log'
import {
  AiError,
  errorText,
  estimateTokens,
  isContextOverflow,
  isDailyQuota,
  isGroqJsonValidateFailed,
  isGroqTokenLimitExceeded,
  mapUpstream,
  reasoningEffortFor,
  statusOf,
  supportsJsonSchema,
  TOKEN_SAFETY_MARGIN,
  type AiRole,
  type AiEffort,
} from './router-shared'
import { clientFor, TARGETS, targetName, __resetClients, type Target } from './router-config'
import {
  clearGroqRecovering,
  markDailyExhausted,
  openGroqPenalty,
  providerDailyExhausted,
  record,
  __resetRoutingState,
} from './router-state'
import { ATTEMPT_TIMEOUT_MS, attemptsForRole, type Attempt, type SwarmTier } from './router-lanes'

// Fail loudly if this module is ever pulled into a client bundle — the API keys
// must never ship to the browser.
if (typeof window !== 'undefined') {
  throw new Error('lib/ai/router.ts is server-only and must not run in the browser')
}

// ── Public facade re-exports ──────────────────────────────────────────────────

export { AiError, type AiRole, type AiEffort } from './router-shared'
export { __setClientFactory } from './router-config'
export {
  dailyLimitsExhausted,
  dailyExhaustedProviders,
  drafterLaneStress,
  type DrafterLaneStress,
  type TargetStatus,
  type TargetHealth,
  type LogEvent,
} from './router-state'
export {
  getRouterSnapshot,
  probeTargets,
  probeOne,
  getTargetDetail,
  type RouterSnapshot,
  type LaneStep,
  type ProbeResult,
  type LanePosition,
  type TargetDetail,
} from './router-monitor'

// ── Latency budgets ───────────────────────────────────────────────────────────
// One slow-but-alive target must not eat the whole serverless budget. A
// timed-out attempt surfaces as a no-status error and cascades like any
// transient failure — so the penalty box and health log still see it, unlike
// a platform kill. The chain-wide deadline is shared across completeJSON's
// parse-retry too. Per-role attempt budgets (ATTEMPT_TIMEOUT_MS) and the
// failover order itself (attemptsForRole/Attempt) live in router-lanes.ts.
//
// Keyed per-role, not one flat number (2026-08-10, Samir) — because each
// role's ROUTE has its own maxDuration, and this deadline must stay under
// whatever that specific route can actually honor. Raising it for one role
// without raising THAT role's route's maxDuration to match just trades a
// graceful self-cutoff (still returns a clean error) for a hard platform
// kill mid-response (no error, connection just dies). swarm/synthesis are
// the reasoning pipeline's roles, both served ONLY by
// app/api/admin/reasoning/route.ts. Every other role's route is still
// maxDuration=30, so they keep the original ~4s headroom under that.
//
// swarm/synthesis raised 55s → 260s (2026-08-12, Samir, root-causing "the
// pipeline consistently stops on perspectives-generate or global-
// assumptions" on real Vercel Hobby traffic): the route's own maxDuration
// went 60 → 280 the same session (confirmed live: Fluid Compute is enabled
// on this Hobby project, raising the real platform ceiling to 300s — the old
// 60s was this codebase's own self-imposed number, not a true Hobby limit).
// 260s keeps the same ~20s headroom under 280 that 55s had under 60. This
// budget matters most for generateWithOptionalSearch's multi-round evidence
// chains (search.ts) — up to 3 sequential completeJSON rounds sharing ONE
// deadline — which is exactly what was observed failing live at ~95-100s
// under the old 55s ceiling (a round finishing just past its own share of a
// too-small shared budget). Full real-verified diagnosis:
// plans/active/reasoning-pipeline/20-deepinfra-tuning-real-verification.md's
// addendum.
const CHAIN_DEADLINE_MS: Record<AiRole, number> = {
  // 26s → 55s (2026-08-18, alongside ATTEMPT_TIMEOUT_MS.suggestor's same
  // bump, router-lanes.ts) — must exceed the new 45s attempt timeout with
  // real room left for a fallback attempt if DeepInfra genuinely fails
  // rather than just running long; matches app/api/ai/suggest/route.ts's
  // own maxDuration bump (30s → 60s) below. Only this role's budget moves —
  // coach/critic/drafter/feedback are untouched, and no other route reads
  // CHAIN_DEADLINE_MS.suggestor.
  suggestor: 55_000,
  coach: 26_000,
  critic: 26_000,
  drafter: 26_000,
  swarm: 260_000,
  synthesis: 260_000,
  // Same 26s as suggestor/coach/critic/drafter — app/api/houses/[id]/
  // layer-feedback/route.ts's own maxDuration is 30s, same convention as
  // those four routes (~4s headroom).
  feedback: 26_000,
  // Same 55s as suggestor, not feedback's smaller 26s — see
  // ATTEMPT_TIMEOUT_MS.console's comment (router-lanes.ts) for why this
  // lane is sized like suggestor's post-real-verification budget from the
  // start. app/api/houses/[id]/console/route.ts's own maxDuration is 60s,
  // same ~5s headroom convention.
  console: 55_000,
}

// Lets a caller that itself makes several sequential completeJSON calls
// (generateWithOptionalSearch's search rounds, search.ts) compute ONE
// deadline up front and pass it to every round via completeJSON's own
// deadlineAt option — see that option's comment for why this matters.
export function chainDeadlineFor(role: AiRole): number {
  return Date.now() + CHAIN_DEADLINE_MS[role]
}

// ── Execution ─────────────────────────────────────────────────────────────────

interface ExecuteOpts {
  system: string
  user: string
  jsonSchema: Record<string, unknown>
  schemaName: string
  effort: AiEffort
  // Opt-in past gpt-oss/qwen's 'high' floor — see reasoningEffortFor
  // (router-shared.ts) for what this actually does and why it's gated.
  allowHighReasoning?: boolean
  // Only meaningful for role 'swarm' (router-lanes.ts's SwarmTier /
  // attemptsForRole) — every other role ignores it. Undefined defaults to
  // 'draft' inside attemptsForRole/swarmAttempts.
  swarmTier?: SwarmTier
  maxTokens: number
  neededTokens: number // estimated input + output; drives size-aware routing
  deadlineAt: number //  epoch ms; shared across the parse-retry (see completeJSON)
}

// Send one prompt down the role's failover chain. Returns raw content from the
// first provider that answers.
//   - Size: a target whose context window is smaller than the estimated need is
//     skipped, so a large request automatically lands on the 1M-token Gemini.
//   - 429: advances to the next target; a daily 429 marks THAT provider
//     exhausted for the day, a Groq 429 opens the penalty box.
//   - Context overflow (400/413/422 "too long"): escalates to the next
//     larger-window target instead of surfacing as a bug.
//   - 5xx / timeout / network / sunset-model 404 / empty generation: transient
//     provider incidents — advance the chain.
//   - 400 / 401 / 403: misconfiguration-shaped — thrown immediately.
//   - Deadline: attempts stop once opts.deadlineAt passes, throwing the most
//     actionable error seen, so a slow chain degrades instead of platform-killing.
async function execute(role: AiRole, opts: ExecuteOpts): Promise<{ content: string; target: Target }> {
  const attempts = attemptsForRole(role, opts.allowHighReasoning, opts.swarmTier)
  let last429: AiError | null = null
  let lastTransient: AiError | null = null
  let anyProviderTried = false
  let skippedForSize = false
  let skippedForDaily = false
  let overflowSeen = false
  let deadlineHit = false
  // Falsified by any non-daily failure; while true (and something was relevant),
  // the whole lane is verified daily-exhausted and the airbag may fire.
  let laneAllDaily = true

  for (const attempt of attempts) {
    if (Date.now() >= opts.deadlineAt) {
      deadlineHit = true
      break
    }
    if (opts.neededTokens > attempt.contextWindow) {
      skippedForSize = true // input too big for this model — try a larger window
      continue
    }
    if (providerDailyExhausted(attempt.provider)) {
      skippedForDaily = true // known-exhausted today; don't burn latency on it
      continue
    }
    const client = clientFor(attempt)
    if (!client) continue // no key → skip, don't abort
    anyProviderTried = true
    const started = Date.now()
    // attempt.timeoutMs overrides the role's default when a specific target
    // needs more (or less) room — see Attempt.timeoutMs (router-lanes.ts).
    const timeoutMs = Math.max(
      1_000,
      Math.min(attempt.timeoutMs ?? ATTEMPT_TIMEOUT_MS[role], opts.deadlineAt - Date.now())
    )
    try {
      const content = await callProvider(client, attempt, opts, timeoutMs)
      if (attempt.provider === 'groq') clearGroqRecovering() // healthy again
      record(attempt, 'ok', undefined, Date.now() - started)
      return { content, target: attempt }
    } catch (err) {
      const latencyMs = Date.now() - started
      // An empty generation is provider flakiness, not caller error — cascade past it.
      if (err instanceof AiError && err.message === 'ai-empty-output') {
        laneAllDaily = false
        lastTransient = err
        record(attempt, 'error', 'empty-output', latencyMs)
        continue
      }
      if (err instanceof AiError) throw err // defensive; none expected here
      const s = statusOf(err)
      if (s === 429) {
        last429 = new AiError(429, 'ai-rate-limited')
        const daily = isDailyQuota(err)
        record(attempt, daily ? 'daily' : 'rate_limited', 'HTTP 429', latencyMs)
        if (daily) {
          markDailyExhausted(attempt.provider)
        } else {
          laneAllDaily = false
          if (attempt.penaltyOnRateLimit) openGroqPenalty()
        }
        continue
      }
      if (isContextOverflow(err)) {
        overflowSeen = true
        laneAllDaily = false
        record(attempt, 'error', 'context-overflow', latencyMs)
        continue // escalate to the next larger-window target
      }
      // Groq's json_validate_failed (see isGroqJsonValidateFailed, router-shared.ts):
      // a 400, but the model's OWN generation failing Groq's strict json_schema
      // validation — not a bad request from us. Confirmed live producing fully
      // coherent, on-topic content that just missed a closing quote or a required
      // field — worth another attempt, not a hard stop. Check BEFORE the generic
      // 400 = terminal rule below.
      if (isGroqJsonValidateFailed(err)) {
        laneAllDaily = false
        lastTransient = mapUpstream(err, attempt.provider)
        record(attempt, 'error', 'json-validate-failed', latencyMs)
        continue
      }
      // Groq's per-request TPM ceiling rejecting this request outright (see
      // isGroqTokenLimitExceeded, router-shared.ts) — deliberately NOT routed
      // through the 429 branch above: no penalty box, since waiting doesn't
      // fix a single request being structurally too big.
      if (isGroqTokenLimitExceeded(err)) {
        laneAllDaily = false
        lastTransient = mapUpstream(err, attempt.provider)
        record(attempt, 'error', 'token-limit-exceeded', latencyMs)
        continue
      }
      // Transient provider incidents: 5xx, no-status (SDK timeout / network),
      // and 404 (a sunset model id must degrade, not kill the lane).
      if (s === undefined || s >= 500 || s === 404) {
        laneAllDaily = false
        lastTransient = mapUpstream(err, attempt.provider)
        record(attempt, 'error', s ? `HTTP ${s}` : 'timeout/network', latencyMs)
        continue
      }
      record(attempt, 'error', `HTTP ${s}`, latencyMs)
      throw mapUpstream(err, attempt.provider) // 400 / 401 / 403
    }
  }

  // Terminal airbag: fires only on a VERIFIED whole-lane daily blackout — every
  // configured, size-adequate target in this lane either 429'd on a daily quota
  // just now or was already marked exhausted today. A single provider's daily
  // limit (with the rest merely rate-limited or erroring) never reaches here.
  const laneDailyBlackout = laneAllDaily && (anyProviderTried || skippedForDaily)
  if (
    laneDailyBlackout &&
    !deadlineHit &&
    opts.neededTokens <= TARGETS.openrouterFree.contextWindow
  ) {
    const client = clientFor(TARGETS.openrouterFree)
    if (client) {
      const timeoutMs = Math.max(1_000, Math.min(ATTEMPT_TIMEOUT_MS[role], opts.deadlineAt - Date.now()))
      try {
        const content = await callProvider(client, { ...TARGETS.openrouterFree }, opts, timeoutMs)
        record(TARGETS.openrouterFree, 'ok')
        return { content, target: TARGETS.openrouterFree }
      } catch (err) {
        if (err instanceof AiError) throw err
        if (statusOf(err) === 429) {
          record(TARGETS.openrouterFree, 'rate_limited', 'HTTP 429')
          throw new AiError(429, 'ai-rate-limited')
        }
        record(TARGETS.openrouterFree, 'error', statusOf(err) ? `HTTP ${statusOf(err)}` : 'network')
        throw mapUpstream(err, 'openrouter')
      }
    }
  }

  // Nothing succeeded. Prefer the most actionable reason.
  if (overflowSeen) throw new AiError(413, 'ai-context-overflow')
  if (!anyProviderTried && !skippedForDaily && skippedForSize) {
    throw new AiError(413, 'ai-context-overflow')
  }
  if (last429) throw last429
  if (skippedForDaily && !anyProviderTried) throw new AiError(429, 'ai-rate-limited')
  if (lastTransient) throw lastTransient
  if (deadlineHit) throw new AiError(504, 'ai-timeout')
  if (!anyProviderTried) throw new AiError(500, 'ai-not-configured')
  throw new AiError(429, 'ai-rate-limited')
}

// supportsJsonSchema() matches on model name ('gpt-oss' or 'deepseek-v3' as
// of 2026-08-13), not provider — Groq's and Cerebras's gpt-oss targets, and
// now DeepInfra's DeepSeek-V3 target, all get strict response_format:
// json_schema. Confirmed live (2026-08-02, plans/active/reasoning-pipeline/14):
// Cerebras's enforcement of that shape is weaker than Groq's — Groq 400s as
// json_validate_failed when its own generation doesn't conform (cascades
// cleanly, see isGroqJsonValidateFailed above); Cerebras returned a 200 with
// the correct object wrapped in a one-element array, which only our own zod
// parse below catches. This costs nothing on providers that already enforce
// the shape strictly, so it's unconditional rather than gated per-provider.
// DeepInfra's own enforcement quality for DeepSeek-V3 is NOT yet
// real-verified against either failure shape — isGroqJsonValidateFailed only
// recognizes Groq's specific error text, so if DeepInfra's constrained
// decoding fails in some other shape, it may not cascade as cleanly as
// Groq's does today. Watch early real traffic on this target for it.
//
// A different DeepInfra failure shape WAS real-verified, on
// meta-llama/Llama-3.3-70B-Instruct-Turbo (2026-08-13, TARGETS.deepinfra's
// swap history, router-config.ts): running the json_object fallback (not
// this guardrail's json_schema path — Llama was never granted
// supportsJsonSchema()), it wrapped its JSON output in a markdown code fence
// on 4/4 real attempts, which broke JSON.parse outright before zod ever got
// a chance to validate anything. completeJSON's tryParse (below) now strips
// a leading/trailing code fence unconditionally, on every completion
// regardless of which json mode served it — see stripMarkdownFence's own
// comment for why unconditional rather than gated to json_object mode.
const JSON_SHAPE_GUARDRAIL =
  'Respond with exactly one JSON object matching the schema — do not wrap it in an array or add any extra nesting.'

// Defense in depth alongside the SDK's own `{ timeout }` option (passed into
// client.chat.completions.create below), which is an AbortController +
// setTimeout implementation that looks correct on paper but real traffic
// (2026-09-12, Mistral, role 'coach', ATTEMPT_TIMEOUT_MS.coach=8000) showed a
// stalled upstream connection can survive it: that call ran 7.9 MINUTES
// before the SDK finally surfaced "Request timed out." — the abort signal
// evidently never tore down whatever was holding the socket open (a known
// class of fetch/undici issue with a response that has started streaming
// but stalls). This does not try to kill the connection any harder than the
// SDK's own signal already does; it just refuses to let the CALLER (and
// therefore the whole failover cascade in execute()) keep waiting on it —
// whichever settles first wins, and a request that loses the race is left to
// resolve/reject in the background, unawaited, rather than blocking the next
// attempt in the chain. HARD_TIMEOUT_GRACE_MS gives the SDK's own timeout
// (which produces a properly-classified error — see errorText/statusOf) a
// head start to fire first in the normal case; this is a backstop for when
// it doesn't, not a replacement for it.
const HARD_TIMEOUT_GRACE_MS = 3_000

function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`client-side hard timeout after ${timeoutMs}ms (${label}) — upstream did not honor its own abort signal in time`))
    }, timeoutMs + HARD_TIMEOUT_GRACE_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function callProvider(
  client: OpenAI,
  attempt: Attempt,
  opts: ExecuteOpts,
  timeoutMs: number
): Promise<string> {
  const useJsonSchema = supportsJsonSchema(attempt.model)
  const systemContent = useJsonSchema
    ? `${opts.system}\n\n${JSON_SHAPE_GUARDRAIL}`
    : `${opts.system}\n\nRespond with a single JSON object and nothing else. It must conform to this JSON Schema:\n${JSON.stringify(opts.jsonSchema)}`
  const response_format = useJsonSchema
    ? ({
        type: 'json_schema' as const,
        json_schema: { name: opts.schemaName, schema: opts.jsonSchema },
      })
    : ({ type: 'json_object' as const })
  const reasoning_effort = reasoningEffortFor(attempt.model, opts.effort, opts.allowHighReasoning)

  let completion: OpenAI.Chat.Completions.ChatCompletion
  try {
    completion = (await raceTimeout(
      client.chat.completions.create(
        {
          model: attempt.model,
          max_tokens: opts.maxTokens,
          response_format,
          // reasoning_effort is only accepted by some models; omit it elsewhere.
          ...(reasoning_effort ? { reasoning_effort } : {}),
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: opts.user },
          ],
        } as Parameters<typeof client.chat.completions.create>[0],
        // Per-attempt budget (overrides the client-level 25s backstop) so a slow
        // target times out into the cascade instead of eating the whole chain.
        // raceTimeout() above is the backstop for when this doesn't fire.
        { timeout: timeoutMs }
      ),
      timeoutMs,
      `${attempt.provider}/${attempt.model}`
    )) as OpenAI.Chat.Completions.ChatCompletion
  } catch (err) {
    // Full request-context diagnostic on ANY upstream failure (2026-07-31):
    // mapUpstream's downstream log has provider+status but not WHICH call this
    // was or the request params that shaped it — the exact fields needed to
    // root-cause a reproducible failure (e.g. Groq's json_validate_failed
    // recurring across models). Logs once here with everything in scope, then
    // re-throws untouched so execute()'s cascade/classification is unchanged.
    log.error('ai/router', 'upstream call failed', {
      provider: attempt.provider,
      model: attempt.model,
      status: statusOf(err) ?? 'unknown',
      schemaName: opts.schemaName,
      effort: opts.effort,
      reasoningEffort: reasoning_effort ?? '(omitted)',
      useJsonSchema,
      maxTokens: opts.maxTokens,
      neededTokens: opts.neededTokens,
      detail: errorText(err),
    })
    throw err
  }

  const content = completion.choices[0]?.message?.content
  if (!content) {
    // An empty 200 (distinct from the thrown errors above) — log the request
    // context here too, since ai-empty-output otherwise cascades silently.
    log.error('ai/router', 'upstream empty output', {
      provider: attempt.provider,
      model: attempt.model,
      schemaName: opts.schemaName,
      effort: opts.effort,
      reasoningEffort: reasoning_effort ?? '(omitted)',
      useJsonSchema,
      maxTokens: opts.maxTokens,
      finishReason: completion.choices[0]?.finish_reason ?? '(none)',
    })
    throw new AiError(502, 'ai-empty-output')
  }
  return content
}

// Strips a leading/trailing markdown code fence (``` or ```json, or any other
// language tag) from a completion's raw content before JSON.parse ever sees
// it. Real-world motivation (2026-08-13): DeepInfra's
// meta-llama/Llama-3.3-70B-Instruct-Turbo — running the json_object fallback
// path because its strict json_schema support isn't confirmed (see
// supportsJsonSchema, router-shared.ts, and TARGETS.deepinfra's comment,
// router-config.ts) — wrapped otherwise-valid JSON in a ```json ... ``` fence
// on 4/4 real attempts, which JSON.parse rejected outright ("response was not
// valid JSON") even though the content inside the fence was fine every time.
// Runs unconditionally on EVERY completion in tryParse below, not gated to
// json_object-mode models — a strict-schema model could theoretically do the
// same thing, and there's no reason to leave that door open. Cheap either
// way: a response that's already raw JSON simply doesn't match the fence
// regex, and the original string is returned untouched.
function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/)
  return match ? match[1].trim() : raw
}

// ── Truncation repair (completeJSON's third pass, see its own comment) ──────

// Narrows a zod issue to the exact shape a plain `z.string().max(N)`
// violation produces. Deliberately strict (checks code, origin, AND that
// maximum is a plain number) — anything else (a missing required field, a
// wrong type) must NOT be treated as mechanically repairable, so it falls
// through to the real ai-invalid-output error instead of being silently
// mishandled.
function isStringTooBig(
  issue: unknown
): issue is { code: 'too_big'; origin: 'string'; maximum: number; path: PropertyKey[] } {
  const i = issue as { code?: unknown; origin?: unknown; maximum?: unknown; path?: unknown }
  return i.code === 'too_big' && i.origin === 'string' && typeof i.maximum === 'number' && Array.isArray(i.path)
}

// Same idea, for a plain `z.array(x).max(N)` violation (2026-09-12,
// real-verified: global_evidence_strategy's questions_for_user[].options
// cap — contracts.ts's own `.max(3)`, mirroring this app's quick-pick UI —
// got a genuinely reasonable 4-option answer from the model, which failed
// validation and burned both of completeJSON's attempts for a shape this
// codebase can safely fix in code). Dropping the excess TAIL items (not
// picking "the best" N) is deliberate: it's a lossless, deterministic rule
// with no judgment call embedded in it, same posture as
// truncateAtWordBoundary below — inventing which items to keep would be
// exactly the kind of silent fabrication this repair pass exists to avoid.
function isArrayTooBig(
  issue: unknown
): issue is { code: 'too_big'; origin: 'array'; maximum: number; path: PropertyKey[] } {
  const i = issue as { code?: unknown; origin?: unknown; maximum?: unknown; path?: unknown }
  return i.code === 'too_big' && i.origin === 'array' && typeof i.maximum === 'number' && Array.isArray(i.path)
}

function isRepairableIssue(issue: unknown): issue is { code: 'too_big'; origin: 'string' | 'array'; maximum: number; path: PropertyKey[] } {
  return isStringTooBig(issue) || isArrayTooBig(issue)
}

// Cuts at the last space at or before maxLength, so a truncated field reads
// as a shortened sentence rather than a word sheared in half — falls back to
// a hard cut only when there's no good boundary in the first half (a single
// very long token), rather than returning a near-empty string.
function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const cut = value.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut
}

function getAtPath(obj: unknown, path: readonly PropertyKey[]): unknown {
  let cur = obj
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<PropertyKey, unknown>)[key]
  }
  return cur
}

function setAtPath(obj: Record<PropertyKey, unknown>, path: readonly PropertyKey[], value: unknown): boolean {
  if (path.length === 0) return false
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]]
    if (next === null || typeof next !== 'object') return false
    cur = next as Record<PropertyKey, unknown>
  }
  cur[path[path.length - 1]] = value
  return true
}

// completeJSON's third pass: only reachable after the first attempt AND the
// schema-error retry have both already failed. Repairs every offending
// field to its own schema cap (from the issue itself, not re-derived) —
// shortening an oversized string, or dropping an oversized array's excess
// tail items — and re-validates. Returns { ok: false } — never throws — for
// anything outside its narrow scope (issues aren't ALL string/array
// too-big, the repaired object still doesn't validate, etc.) so the
// caller's existing ai-invalid-output path is the only way those cases can
// fail. Deliberately narrow: a missing field or wrong type has no safe,
// judgment-free fix, and must keep surfacing as a real error.
function repairOversizedFields<T>(
  parsed: unknown,
  issues: readonly unknown[],
  schema: z.ZodType<T>
): { ok: true; value: T; repaired: { path: string; kind: 'string' | 'array'; from: number; to: number }[] } | { ok: false } {
  if (issues.length === 0 || !issues.every(isRepairableIssue) || parsed === null || typeof parsed !== 'object') {
    return { ok: false }
  }
  // Deep clone so a repair attempt that ultimately fails never mutates
  // anything the caller (or the diagnostic log right after it) still reads.
  const working = JSON.parse(JSON.stringify(parsed)) as Record<PropertyKey, unknown>
  const repaired: { path: string; kind: 'string' | 'array'; from: number; to: number }[] = []
  for (const issue of issues) {
    if (!isRepairableIssue(issue)) return { ok: false } // defensive; .every above already guarantees this
    const value = getAtPath(working, issue.path)
    const pathLabel = issue.path.join('.') || '(root)'
    if (isStringTooBig(issue)) {
      if (typeof value !== 'string') return { ok: false }
      const shortened = truncateAtWordBoundary(value, issue.maximum)
      if (!setAtPath(working, issue.path, shortened)) return { ok: false }
      repaired.push({ path: pathLabel, kind: 'string', from: value.length, to: shortened.length })
    } else {
      // isArrayTooBig — drop the excess tail items (see that function's own
      // comment for why tail, not "the best" N).
      if (!Array.isArray(value)) return { ok: false }
      const shortened = value.slice(0, issue.maximum)
      if (!setAtPath(working, issue.path, shortened)) return { ok: false }
      repaired.push({ path: pathLabel, kind: 'array', from: value.length, to: shortened.length })
    }
  }
  const result = schema.safeParse(working)
  if (!result.success) return { ok: false }
  return { ok: true, value: result.data, repaired }
}

// ── Public facade ─────────────────────────────────────────────────────────────

export async function completeJSON<T>(opts: {
  role: AiRole // decides the failover lane
  system: string
  user: string
  schema: z.ZodType<T> // zod schema; also converted to JSON Schema below
  schemaName: string // response_format json_schema name (a-z, 0-9, _, -)
  effort: AiEffort // maps to reasoning_effort where the model accepts it
  // Opt-in past gpt-oss/qwen's 'high' floor — see reasoningEffortFor
  // (router-shared.ts). Only meaningful when effort: 'high'; ignored otherwise.
  allowHighReasoning?: boolean
  // Per-step DeepInfra model tier within role 'swarm' only (router-lanes.ts's
  // SwarmTier) — ignored by every other role. Omitted (the default) is
  // 'draft'; only orchestrator-perspectives.ts's stance/detail generation
  // and orchestrator-global.ts's global-assumptions-generate pass 'large',
  // only orchestrator-panel.ts's runReviewPanel/runMasterReview pass
  // 'critic'. See TARGETS.deepinfraLarge/deepinfraCritic (router-config.ts)
  // for why these two specific steps get a different model.
  swarmTier?: SwarmTier
  maxTokens: number
  // Shared deadline (epoch ms) for a caller that itself makes several
  // sequential completeJSON calls — generateWithOptionalSearch's search
  // rounds (search.ts) being the one case today (2026-08-12). Without this,
  // each call claims its own fresh CHAIN_DEADLINE_MS[role], so a 3-round
  // sequence could legitimately run up to 3x that role's deadline — well
  // past what the route's own maxDuration can actually honor (confirmed
  // Hobby plan, ~60s hard ceiling regardless of Fluid Compute), so the
  // platform kills the function outright instead of any of this file's own
  // clean, classified timeout handling ever getting to run. Pass
  // chainDeadlineFor(role)'s result, computed ONCE up front, into every
  // round so the whole sequence shares one real budget and a late round
  // fails fast (ai-timeout) rather than hanging for its own fresh window.
  // Omitted (the default) preserves today's behavior for every other caller.
  deadlineAt?: number
}): Promise<T> {
  const jsonSchema = z.toJSONSchema(opts.schema, { target: 'draft-7' }) as Record<
    string,
    unknown
  >
  // Estimate the window this call needs: input (system + user + embedded schema)
  // plus the output budget plus headroom. Drives size-aware target selection.
  const inputTokens = estimateTokens(
    opts.system + opts.user + JSON.stringify(jsonSchema)
  )
  const neededTokens = inputTokens + opts.maxTokens + TOKEN_SAFETY_MARGIN

  const base: ExecuteOpts = {
    system: opts.system,
    user: opts.user,
    jsonSchema,
    schemaName: opts.schemaName,
    effort: opts.effort,
    allowHighReasoning: opts.allowHighReasoning,
    swarmTier: opts.swarmTier,
    maxTokens: opts.maxTokens,
    neededTokens,
    // One deadline covers the first chain AND the parse-retry chain, so the
    // whole completeJSON call stays inside its role's route's function budget.
    // A caller-supplied deadlineAt (see the option's own comment above) wins
    // over computing a fresh one here.
    deadlineAt: opts.deadlineAt ?? Date.now() + CHAIN_DEADLINE_MS[opts.role],
  }

  function tryParse(
    raw: string
  ): { ok: true; value: T } | { ok: false; error: string; parsed: unknown; issues: readonly unknown[] } {
    let parsed: unknown
    try {
      parsed = JSON.parse(stripMarkdownFence(raw))
    } catch {
      return { ok: false, error: 'response was not valid JSON', parsed: undefined, issues: [] }
    }
    let result = opts.schema.safeParse(parsed)
    // Defensive unwrap (2026-08-02, plans/active/reasoning-pipeline/14):
    // Cerebras's gpt-oss-120b, live, wrapped an otherwise-correct object in a
    // one-element array despite strict json_schema mode (see
    // JSON_SHAPE_GUARDRAIL above — a prompt-level ask, not a guarantee).
    // Retried only on this exact observed shape, not a general JSON repair
    // tool: if the array-of-one doesn't ALSO satisfy the schema, the original
    // error is what's reported.
    if (!result.success && Array.isArray(parsed) && parsed.length === 1) {
      const unwrapped = opts.schema.safeParse(parsed[0])
      if (unwrapped.success) result = unwrapped
    }
    if (result.success) return { ok: true, value: result.data }
    // First issue only, capped: zod's full stringified issue array can run 1–3k
    // chars, and this text is appended to the retry prompt at full token price.
    const issue = result.error.issues[0]
    const compact = issue
      ? `${issue.path.join('.') || '(root)'}: ${issue.message}`.slice(0, 300)
      : 'did not match the schema'
    return { ok: false, error: compact, parsed, issues: result.error.issues }
  }

  // Ask once; on schema-parse failure, ask again with the validation error
  // appended so the model can self-correct. Then give up.
  const firstResult = await execute(opts.role, base)
  const first = tryParse(firstResult.content)
  if (first.ok) return first.value

  const retryUser = `${opts.user}\n\nYour previous reply did not match the required schema (${first.error}). Reply again with only valid JSON that matches the schema.`
  const secondResult = await execute(opts.role, { ...base, user: retryUser })
  const second = tryParse(secondResult.content)
  if (second.ok) return second.value

  // Third, code-only pass: fires ONLY when every issue on the retry's own
  // output is a plain string- or array-length overflow (isRepairableIssue
  // below) — a missing field, wrong type, or anything else still falls
  // straight through to the ai-invalid-output throw. Started 2026-09-09
  // (Samir's spec, real-verified live the same session): DeepSeek-V4-
  // Flash-0731 repeatedly overflowing core_question/scope_notes/
  // cross_perspective_notes/question_level_assumptions[i]'s STRING length
  // caps on both attempts — sometimes padding an otherwise-good field with
  // its own commentary about the limit itself rather than shortening it.
  // Widened to ARRAY caps 2026-09-12 (real-verified the same session): the
  // same model overflowing global_evidence_strategy's
  // questions_for_user[].options (contracts.ts's `.max(3)`) with a
  // genuinely reasonable 4th option. Repairing the offending field(s) to
  // their own schema cap (issue.maximum — zod already computed this for us;
  // no need to re-derive it from the jsonSchema above) and re-validating
  // recovers a genuinely-good answer instead of throwing it away and
  // forcing a manual retry through the whole UI.
  const repair = repairOversizedFields(second.parsed, second.issues, opts.schema)
  if (repair.ok) {
    log.warn('ai/router', 'completeJSON auto-repaired to fit schema', {
      schemaName: opts.schemaName,
      role: opts.role,
      target: targetName(secondResult.target),
      repaired: repair.repaired,
    })
    return repair.value
  }

  // Diagnostic only (2026-07-30): visibility into what the model actually
  // returned on a genuine ai-invalid-output — this path previously had none.
  // firstTarget/secondTarget (2026-07-31): which provider/model actually
  // served each attempt — the raw content alone couldn't say whether a
  // reproducible malformed-output pattern traces to one specific target.
  log.error('ai/router', 'completeJSON invalid output after retry', {
    schemaName: opts.schemaName,
    role: opts.role,
    firstTarget: targetName(firstResult.target),
    firstError: first.error,
    firstRaw: firstResult.content.slice(0, 500),
    secondTarget: targetName(secondResult.target),
    secondError: second.error,
    secondRaw: secondResult.content.slice(0, 500),
  })
  throw new AiError(502, 'ai-invalid-output')
}

// Test-only hook: reset module-global routing state between cases. (The client
// factory seam is separate — __setClientFactory — and survives resets.)
export function __resetRouterState(): void {
  __resetRoutingState()
  __resetClients()
}
