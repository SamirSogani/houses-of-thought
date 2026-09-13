// Concurrency limiter for the DeepInfra target family — split out of
// router.ts (repo's 600-LOC rule, already well over it before this file
// existed). All three DeepInfra targets (`deepinfra`, `deepinfraLarge`,
// `deepinfraCritic` — router-config.ts) share ONE `DEEP_INFRA_API_KEY`
// account, so they share one real capacity ceiling regardless of which
// tier's model is being called.
//
// Added 2026-09-13 after a 9-way concurrent reasoning-pipeline load test
// (Samir: "set 9 different houses off at once... test for latency,
// accuracy, and how well the model held under load") found every
// review-panel gate hitting client-side timeouts under up to 81 simultaneous
// DeepInfra requests (9 houses × 9 parallel standard-reviewer calls each,
// all landing on the critic tier at once). Root cause traced via
// `statusOf()` (router-shared.ts): every failure logged `status: "unknown"`
// — meaning no HTTP response ever came back to read a status from, i.e. a
// client-side timeout (`raceTimeout()`, router.ts, ~200s+3s ceiling), NOT
// DeepInfra issuing a real 429 rejection. Full incident:
// plans/active/reasoning-pipeline/model-evaluation/concurrency-2026-09-13-local-dev-9way.md.
//
// Fix: queue excess calls instead of firing all of them at once. Bounded to
// DEEPINFRA_MAX_CONCURRENT in-flight requests; everything past that waits in
// FIFO order for a slot to free up, rather than all N competing for the same
// saturated upstream and many timing out together (the observed failure).
// Queue wait time is separate from — and doesn't eat into — a request's own
// raceTimeout budget, since that timer only starts once the request actually
// begins (router.ts's callProvider acquires a slot before calling
// raceTimeout), so a request that waits gets a full, uncontended shot once
// it's dequeued rather than racing a clock that started while it was still
// waiting in line.
//
// Deliberately in-process (a module-level counter), not a distributed/
// Redis-backed limiter — Samir confirmed Vercel Fluid Compute is enabled on
// this project, which lets one warm instance serve multiple concurrent
// invocations and therefore share this module's state; that's what makes an
// in-process limiter meaningful in production, not just in local dev's
// single persistent `next dev` process (which is what the 2026-09-13 test
// itself ran against). If traffic ever outgrows what Fluid Compute keeps on
// one instance, this in-process limiter stops seeing the full picture and a
// shared/distributed one would be needed instead — not attempted here since
// it wasn't the confirmed bottleneck.

const DEEPINFRA_MAX_CONCURRENT = Number(process.env.DEEPINFRA_MAX_CONCURRENT ?? 20)

// Exported (not just the singleton below) so tests can construct a small,
// isolated instance rather than sharing/resetting module-level state.
export class ConcurrencyLimiter {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  // Resolves once a slot is free. The caller MUST invoke the returned
  // release function exactly once (a try/finally at the call site) — an
  // un-released slot leaks forever and would eventually wedge the whole
  // lane.
  acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++
      return Promise.resolve(() => this.release())
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve(() => this.release())
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }

  // Diagnostic only, not load-bearing — a cheap hook for the admin AI
  // monitor or ad-hoc debugging if queue depth is ever worth surfacing.
  snapshot(): { active: number; queued: number; max: number } {
    return { active: this.active, queued: this.queue.length, max: this.max }
  }
}

// One shared limiter for every DeepInfra target — see the file header for
// why they share one ceiling instead of one limiter per tier.
export const deepinfraLimiter = new ConcurrencyLimiter(DEEPINFRA_MAX_CONCURRENT)
