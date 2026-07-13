import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { RateLimiter } from "effect/unstable/persistence"
import type { StopSelector } from "@app/contract"
import type { PidBoardResponse } from "../src/golemio/schema.ts"
import { GolemioClient } from "../src/golemio/client.ts"
import { GolemioRateLimitedError, GolemioUpstreamError } from "../src/golemio/errors.ts"
import { DepartureGateway } from "../src/gateway/service.ts"

const emptyResponse: PidBoardResponse = { stops: [], departures: [] }

/** Controllable fake GolemioClient: records each call's selectors, can be
 * switched to failing. */
const makeFake = Effect.gen(function* () {
  const batches = yield* Ref.make<ReadonlyArray<ReadonlyArray<StopSelector>>>([])
  const failing = yield* Ref.make(false)
  const layer = Layer.succeed(GolemioClient, {
    fetchBoards: (selectors: ReadonlyArray<StopSelector>) =>
      Effect.gen(function* () {
        yield* Ref.update(batches, (b) => [...b, selectors])
        if (yield* Ref.get(failing)) {
          return yield* new GolemioUpstreamError({ status: 500, detail: "boom" })
        }
        return emptyResponse
      }),
  })
  const calls = Ref.get(batches).pipe(Effect.map((b) => b.length))
  return { calls, batches, failing, layer }
})

const rateLimiterLayer = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))

const gatewayLayer = (clientLayer: Layer.Layer<GolemioClient>) =>
  DepartureGateway.layer.pipe(Layer.provide([clientLayer, rateLimiterLayer]))

describe("DepartureGateway", () => {
  it.effect("coalesces identical requests within the cache TTL", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        const sel = [{ node: 1040, stops: null }]
        yield* Effect.all([gw.getBoards(sel), gw.getBoards(sel)], { concurrency: "unbounded" })
        yield* TestClock.adjust("2 seconds")
        yield* gw.getBoards(sel)
        expect(yield* fake.calls).toBe(1)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("batches all misses into a single upstream call", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        const result = yield* gw.getBoards([
          { node: 1, stops: null },
          { node: 2, stops: [10, 20] },
          { node: 3, stops: null },
        ])
        expect(result.boards.map((b) => b.key)).toEqual(["1", "2:10,20", "3"])
        expect(yield* fake.calls).toBe(1)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("reuses fresh per-selector boards across overlapping selector sets", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        yield* gw.getBoards([
          { node: 1, stops: null },
          { node: 2, stops: null },
        ])
        // A different set overlapping the first: only the new node is fetched.
        const second = yield* gw.getBoards([
          { node: 2, stops: null },
          { node: 3, stops: null },
        ])
        expect(second.boards.map((b) => b.key)).toEqual(["2", "3"])
        const batches = yield* Ref.get(fake.batches)
        expect(batches.length).toBe(2)
        expect(batches[1]).toEqual([{ node: 3, stops: null }])
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("refetches after the TTL expires", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        const sel = [{ node: 1040, stops: null }]
        yield* gw.getBoards(sel)
        yield* TestClock.adjust("6 seconds")
        yield* gw.getBoards(sel)
        expect(yield* fake.calls).toBe(2)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("serves stale data flagged degraded when upstream fails", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        const sel = [{ node: 1040, stops: null }]
        const first = yield* gw.getBoards(sel)
        expect(first.degraded).toBe(false)
        yield* Ref.set(fake.failing, true)
        yield* TestClock.adjust("6 seconds")
        const second = yield* gw.getBoards(sel)
        expect(second.degraded).toBe(true)
        expect(second.reason).toContain("GolemioUpstreamError")
        expect(second.boards).toEqual(first.boards)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("degrades with empty boards when failing and no stale data exists", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.failing, true)
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        const result = yield* gw.getBoards([{ node: 7, stops: null }])
        expect(result.degraded).toBe(true)
        expect(result.boards).toEqual([])
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("sheds when the rate limit window is exhausted", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        // 20 distinct cache keys exhaust the 20/8s budget
        for (let i = 0; i < 20; i++) {
          yield* gw.getBoards([{ node: i, stops: null }])
        }
        const fiber = yield* Effect.forkChild(gw.getBoards([{ node: 999, stops: null }]))
        yield* TestClock.adjust("6 seconds") // shed timeout < remaining window
        const result = yield* Fiber.join(fiber) // getBoards never fails
        expect(result.degraded).toBe(true)
        expect(yield* fake.calls).toBe(20)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("cools down for 30s after an upstream 429", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const limited = yield* Ref.make(false)
      const layer = Layer.succeed(GolemioClient, {
        fetchBoards: () =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (n) => n + 1)
            if (yield* Ref.get(limited)) {
              return yield* new GolemioRateLimitedError()
            }
            return emptyResponse
          }),
      })
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        const sel = [{ node: 1040, stops: null }]
        yield* gw.getBoards(sel) // healthy: 1 upstream call
        yield* Ref.set(limited, true)
        yield* TestClock.adjust("6 seconds") // expire cache TTL
        const hit = yield* gw.getBoards(sel) // 429: 2nd call, cooldown armed
        expect(hit.degraded).toBe(true)
        yield* TestClock.adjust("6 seconds") // TTL expired again, cooldown active
        const during = yield* gw.getBoards(sel)
        expect(during.degraded).toBe(true)
        expect(yield* Ref.get(calls)).toBe(2) // no upstream call during cooldown
        yield* Ref.set(limited, false)
        yield* TestClock.adjust("30 seconds") // cooldown over
        const after = yield* gw.getBoards(sel)
        expect(after.degraded).toBe(false)
        expect(yield* Ref.get(calls)).toBe(3)
      }).pipe(Effect.provide(gatewayLayer(layer)))
    }),
  )

  it.effect("evicts the oldest stale fallback beyond capacity (64)", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* DepartureGateway
        // Insert 65 distinct keys, pacing past the 20/8s rate-limit window.
        for (let i = 0; i < 65; i++) {
          if (i > 0 && i % 16 === 0) yield* TestClock.adjust("8 seconds")
          yield* gw.getBoards([{ node: i + 1, stops: null }])
        }
        yield* Ref.set(fake.failing, true)
        yield* TestClock.adjust("8 seconds") // expire cache TTL + refill limiter
        // Oldest key (node 1) was evicted from the cache: no board comes back.
        const evicted = yield* gw.getBoards([{ node: 1, stops: null }])
        expect(evicted.degraded).toBe(true)
        expect(evicted.boards).toEqual([])
        // Newest key still has its stale board.
        const retained = yield* gw.getBoards([{ node: 65, stops: null }])
        expect(retained.degraded).toBe(true)
        expect(retained.boards.length).toBe(1)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )
})
