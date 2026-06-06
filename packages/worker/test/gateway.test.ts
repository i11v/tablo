import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { RateLimiter } from "effect/unstable/persistence"
import type { PidBoardResponse } from "../src/golemio/schema.ts"
import { GolemioClient } from "../src/golemio/client.ts"
import { GolemioUpstreamError } from "../src/golemio/errors.ts"
import { DepartureGateway } from "../src/gateway/service.ts"

const emptyResponse: PidBoardResponse = { stops: [], departures: [] }

/** Controllable fake GolemioClient: counts calls, can be switched to failing. */
const makeFake = Effect.gen(function* () {
  const calls = yield* Ref.make(0)
  const failing = yield* Ref.make(false)
  const layer = Layer.succeed(GolemioClient, {
    fetchBoards: () =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (n) => n + 1)
        if (yield* Ref.get(failing)) {
          return yield* new GolemioUpstreamError({ status: 500, detail: "boom" })
        }
        return emptyResponse
      }),
  })
  return { calls, failing, layer }
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
        expect(yield* Ref.get(fake.calls)).toBe(1)
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
        expect(yield* Ref.get(fake.calls)).toBe(2)
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
        expect(yield* Ref.get(fake.calls)).toBe(20)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )
})
