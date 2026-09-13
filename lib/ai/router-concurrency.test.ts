// Unit tests for the DeepInfra concurrency limiter (router-concurrency.ts) —
// added alongside the limiter itself, 2026-09-13, after a 9-way concurrent
// reasoning-pipeline load test found every DeepInfra request firing at once
// under contention. Pure logic tests: no router/network involved, a fresh
// small ConcurrencyLimiter instance per test so nothing depends on the
// module-level deepinfraLimiter singleton's real (env-configurable) max.

import { describe, expect, it } from 'vitest'
import { ConcurrencyLimiter } from './router-concurrency'

describe('ConcurrencyLimiter', () => {
  it('grants a slot immediately while under the max', async () => {
    const limiter = new ConcurrencyLimiter(2)
    const release = await limiter.acquire()
    expect(limiter.snapshot()).toEqual({ active: 1, queued: 0, max: 2 })
    release()
    expect(limiter.snapshot()).toEqual({ active: 0, queued: 0, max: 2 })
  })

  it('queues a caller once the max is already held, and grants it a slot on release', async () => {
    const limiter = new ConcurrencyLimiter(1)
    const release1 = await limiter.acquire()
    expect(limiter.snapshot()).toEqual({ active: 1, queued: 0, max: 1 })

    let acquired2 = false
    const pending2 = limiter.acquire().then((release) => {
      acquired2 = true
      return release
    })
    // Still queued — nothing has released the only slot yet. Flush the
    // microtask queue without granting the second caller anything.
    await Promise.resolve()
    await Promise.resolve()
    expect(acquired2).toBe(false)
    expect(limiter.snapshot()).toEqual({ active: 1, queued: 1, max: 1 })

    release1()
    const release2 = await pending2
    expect(acquired2).toBe(true)
    expect(limiter.snapshot()).toEqual({ active: 1, queued: 0, max: 1 })

    release2()
    expect(limiter.snapshot()).toEqual({ active: 0, queued: 0, max: 1 })
  })

  it('releases queued callers in FIFO order, not last-in-first-out', async () => {
    const limiter = new ConcurrencyLimiter(1)
    const release1 = await limiter.acquire()

    const order: number[] = []
    const p2 = limiter.acquire().then((release) => {
      order.push(2)
      return release
    })
    const p3 = limiter.acquire().then((release) => {
      order.push(3)
      return release
    })
    await Promise.resolve()
    expect(limiter.snapshot().queued).toBe(2)

    release1()
    const release2 = await p2
    expect(order).toEqual([2]) // 2 was queued first, so it goes first — not 3
    release2()
    const release3 = await p3
    expect(order).toEqual([2, 3])
    release3()
    expect(limiter.snapshot()).toEqual({ active: 0, queued: 0, max: 1 })
  })

  it('allows up to `max` concurrent holders before anyone has to queue', async () => {
    const limiter = new ConcurrencyLimiter(3)
    const releases = await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()])
    expect(limiter.snapshot()).toEqual({ active: 3, queued: 0, max: 3 })

    let acquired4 = false
    const pending4 = limiter.acquire().then((r) => {
      acquired4 = true
      return r
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(acquired4).toBe(false)
    expect(limiter.snapshot()).toEqual({ active: 3, queued: 1, max: 3 })

    releases[0]()
    const release4 = await pending4
    expect(acquired4).toBe(true)
    release4()
    releases[1]()
    releases[2]()
    expect(limiter.snapshot()).toEqual({ active: 0, queued: 0, max: 3 })
  })
})
