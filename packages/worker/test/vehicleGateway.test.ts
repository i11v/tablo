import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { RateLimiter } from "effect/unstable/persistence"
import { GolemioClient } from "../src/golemio/client.ts"
import { GolemioUpstreamError } from "../src/golemio/errors.ts"
import { VehicleGateway } from "../src/gateway/vehicles.ts"

/** Mirrors the vehicles.test.ts fixture: one minimal decoded feature. */
const feature = () => ({
  geometry: { coordinates: [14.6161737, 50.0837135] },
  properties: {
    trip: {
      gtfs: {
        route_id: "L1001",
        route_short_name: "S1",
        route_type: 2,
        trip_id: "1001_9360_260603",
        trip_headsign: "Praha hl.n.",
      },
    },
    last_position: {
      bearing: 264,
      delay: { actual: 85 },
      is_canceled: false,
      origin_timestamp: "2026-07-20T09:00:00.000Z",
      state_position: "at_stop",
      tracking: true,
    },
  },
})

/** Controllable fake GolemioClient: counts fetchVehicles calls, can be
 * switched to failing. fetchBoards is present but unused here. */
const makeFake = Effect.gen(function* () {
  const calls = yield* Ref.make(0)
  const failing = yield* Ref.make(false)
  const layer = Layer.succeed(GolemioClient, {
    fetchBoards: () => Effect.succeed({ stops: [], departures: [] }),
    fetchVehicles: () =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (n) => n + 1)
        if (yield* Ref.get(failing)) {
          return yield* new GolemioUpstreamError({ status: 500, detail: "boom" })
        }
        return { features: [feature()] }
      }),
  })
  return { calls, failing, layer }
})

const rateLimiterLayer = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))

const gatewayLayer = (clientLayer: Layer.Layer<GolemioClient>) =>
  VehicleGateway.layer.pipe(Layer.provide([clientLayer, rateLimiterLayer]))

describe("VehicleGateway", () => {
  it.effect("coalesces concurrent requests into a single upstream call", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* VehicleGateway
        yield* Effect.all([gw.getVehicles(), gw.getVehicles()], { concurrency: "unbounded" })
        expect(yield* Ref.get(fake.calls)).toBe(1)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("serves the cache within the TTL, refetches after it expires", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* VehicleGateway
        yield* gw.getVehicles()
        yield* TestClock.adjust("2 seconds")
        yield* gw.getVehicles()
        expect(yield* Ref.get(fake.calls)).toBe(1)
        yield* TestClock.adjust("3 seconds") // past the 4.5s TTL
        yield* gw.getVehicles()
        expect(yield* Ref.get(fake.calls)).toBe(2)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("serves stale vehicles flagged degraded when upstream fails", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* VehicleGateway
        const first = yield* gw.getVehicles()
        expect(first.degraded).toBe(false)
        expect(first.vehicles.length).toBe(1)
        yield* Ref.set(fake.failing, true)
        yield* TestClock.adjust("5 seconds")
        const second = yield* gw.getVehicles()
        expect(second.degraded).toBe(true)
        expect(second.reason).toContain("GolemioUpstreamError")
        expect(second.vehicles).toEqual(first.vehicles)
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )

  it.effect("degrades with empty vehicles when failing and no cache exists", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.failing, true)
      yield* Effect.gen(function* () {
        const gw = yield* VehicleGateway
        const result = yield* gw.getVehicles()
        expect(result.degraded).toBe(true)
        expect(result.vehicles).toEqual([])
        expect(result.reason).toContain("GolemioUpstreamError")
      }).pipe(Effect.provide(gatewayLayer(fake.layer)))
    }),
  )
})
