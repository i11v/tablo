import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { MAX_BBOX_SPAN } from "@app/contract"
import type { BBox } from "@app/contract"
import {
  GolemioNotFoundError,
  GolemioRateLimitedError,
  GolemioUpstreamError,
} from "../src/golemio/errors.ts"
import type { GolemioClient } from "../src/golemio/client.ts"
import { PidPublicVehicles, PidTripPosition, PidTripResponse } from "../src/golemio/schema.ts"
import { DepartureGateway } from "../src/gateway/service.ts"
import { snapBBox, TransitGateway } from "../src/gateway/transit.ts"
import { fakeClient, guardLayer } from "./fakes.ts"
import { publicVehiclesFixture, tripFixture, tripPositionFixture } from "./fixtures/transit.ts"

const tripData = Schema.decodeUnknownSync(PidTripResponse)(tripFixture)
const positionData = Schema.decodeUnknownSync(PidTripPosition)(tripPositionFixture)
const vehiclesData = Schema.decodeUnknownSync(PidPublicVehicles)(publicVehiclesFixture)

type Mode = "ok" | "notFound" | "fail" | "rateLimited"

/** Fake upstream for every endpoint: logs each call, answers per `mode`,
 * optionally after `latencyMs` (TestClock time). */
const makeFake = Effect.gen(function* () {
  const log = yield* Ref.make<ReadonlyArray<string>>([])
  const mode = yield* Ref.make<Mode>("ok")
  const latencyMs = yield* Ref.make(0)

  const respond = <A>(label: string, value: A) =>
    Effect.gen(function* () {
      yield* Ref.update(log, (l) => [...l, label])
      const latency = yield* Ref.get(latencyMs)
      if (latency > 0) yield* Effect.sleep(latency)
      switch (yield* Ref.get(mode)) {
        case "ok":
          return value
        case "notFound":
          return yield* new GolemioNotFoundError()
        case "fail":
          return yield* new GolemioUpstreamError({ status: 500, detail: "boom" })
        case "rateLimited":
          return yield* new GolemioRateLimitedError()
      }
    })

  const layer = fakeClient({
    fetchBoards: () =>
      respond("boards", { stops: [], departures: [] }).pipe(
        Effect.catchTag("GolemioNotFoundError", () =>
          Effect.succeed({ stops: [], departures: [] }),
        ),
      ),
    fetchTrip: (id) => respond(`trip:${id}`, tripData),
    fetchTripPosition: (id) => respond(`position:${id}`, positionData),
    fetchVehicles: (b) =>
      respond(`vehicles:${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`, vehiclesData).pipe(
        Effect.catchTag("GolemioNotFoundError", () => Effect.succeed({ features: [] })),
      ),
  })
  const calls = Ref.get(log).pipe(Effect.map((l) => l.length))
  return { log, calls, mode, latencyMs, layer }
})

/** Both gateways on ONE client and ONE guard — the DO's wiring. */
const gatewaysLayer = (client: Layer.Layer<GolemioClient>) =>
  Layer.mergeAll(DepartureGateway.layer, TransitGateway.layer).pipe(
    Layer.provide([client, guardLayer]),
  )

const TRIP = "9_29806_261003"

describe("TransitGateway", () => {
  it.effect("caches a trip plan for hours", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const first = yield* gw.getTrip(TRIP)
        expect(first._tag).toBe("ok")
        if (first._tag === "ok")
          expect(first.value.stops.map((s) => s.sequence)).toEqual([1, 12, 13, 33])
        yield* TestClock.adjust("5 hours")
        expect((yield* gw.getTrip(TRIP))._tag).toBe("ok")
        expect(yield* fake.calls).toBe(1)
        yield* TestClock.adjust("61 minutes") // past the 6 h TTL
        yield* gw.getTrip(TRIP)
        expect(yield* fake.calls).toBe(2)
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("shares one upstream call among concurrent identical requests", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.latencyMs, 1_000)
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const fiber = yield* Effect.forkChild(
          Effect.all([gw.getTrip(TRIP), gw.getTrip(TRIP), gw.getTrip(TRIP)], {
            concurrency: "unbounded",
          }),
        )
        yield* Effect.yieldNow
        yield* TestClock.adjust("1 second")
        const results = yield* Fiber.join(fiber)
        expect(results.map((r) => r._tag)).toEqual(["ok", "ok", "ok"])
        expect(yield* Ref.get(fake.log)).toEqual([`trip:${TRIP}`])
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("reports an unknown trip as notFound and remembers that for a minute", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.mode, "notFound")
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        expect(yield* gw.getTrip("nope")).toEqual({ _tag: "notFound" })
        expect(yield* gw.getTrip("nope")).toEqual({ _tag: "notFound" })
        expect(yield* fake.calls).toBe(1)
        yield* TestClock.adjust("61 seconds")
        yield* gw.getTrip("nope")
        expect(yield* fake.calls).toBe(2)
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("reports an untracked trip vehicle as notFound", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.mode, "notFound")
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        expect(yield* gw.getTripVehicle(TRIP)).toEqual({ _tag: "notFound" })
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("refreshes a trip vehicle after 5 s", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const first = yield* gw.getTripVehicle(TRIP)
        expect(first).toMatchObject({ _tag: "ok", value: { tripId: TRIP, distance: 5.831 } })
        yield* TestClock.adjust("4 seconds")
        yield* gw.getTripVehicle(TRIP)
        expect(yield* fake.calls).toBe(1)
        yield* TestClock.adjust("2 seconds")
        yield* gw.getTripVehicle(TRIP)
        expect(yield* fake.calls).toBe(2)
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("serves a stale trip vehicle while upstream fails, for up to a minute", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const fresh = yield* gw.getTripVehicle(TRIP)
        yield* Ref.set(fake.mode, "fail")
        yield* TestClock.adjust("6 seconds")
        expect(yield* gw.getTripVehicle(TRIP)).toEqual(fresh)
        expect(yield* fake.calls).toBe(2) // it did try
        yield* TestClock.adjust("60 seconds")
        expect(yield* gw.getTripVehicle(TRIP)).toEqual({
          _tag: "unavailable",
          reason: "GolemioUpstreamError",
        })
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("is unavailable when upstream fails and nothing is cached", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.mode, "fail")
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        expect(yield* gw.getTrip(TRIP)).toEqual({
          _tag: "unavailable",
          reason: "GolemioUpstreamError",
        })
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("snaps nearby boxes onto one grid box and one upstream call", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const a = yield* gw.getVehicles({
          minLat: 50.0771,
          minLon: 14.4121,
          maxLat: 50.0849,
          maxLon: 14.4279,
        })
        const b = yield* gw.getVehicles({
          minLat: 50.0772,
          minLon: 14.4125,
          maxLat: 50.0848,
          maxLon: 14.428,
        })
        expect(yield* Ref.get(fake.log)).toEqual(["vehicles:50.075,14.41,50.085,14.43"])
        expect(b).toEqual(a)
        expect(a).toMatchObject({ _tag: "ok", value: { generatedAt: new Date(0).toISOString() } })
        if (a._tag === "ok") expect(a.value.vehicles).toHaveLength(4)
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("a 429 on any endpoint cools down every endpoint", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Ref.set(fake.mode, "rateLimited")
      yield* Effect.gen(function* () {
        const transit = yield* TransitGateway
        const boards = yield* DepartureGateway
        expect(yield* transit.getTrip(TRIP)).toEqual({
          _tag: "unavailable",
          reason: "GolemioRateLimitedError",
        })
        yield* Ref.set(fake.mode, "ok")
        const board = yield* boards.getBoards([{ node: 539, stops: null }])
        expect(board.degraded).toBe(true)
        expect(board.reason).toBe("GatewayShedError")
        expect(yield* transit.getTripVehicle(TRIP)).toEqual({
          _tag: "unavailable",
          reason: "GatewayShedError",
        })
        expect(yield* fake.calls).toBe(1) // nothing reached upstream during cooldown
        yield* TestClock.adjust("31 seconds")
        expect((yield* boards.getBoards([{ node: 539, stops: null }])).degraded).toBe(false)
        expect(yield* fake.calls).toBe(2)
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("trips spend the same rate budget as boards", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const transit = yield* TransitGateway
        const boards = yield* DepartureGateway
        for (let i = 0; i < 20; i++) {
          yield* transit.getTrip(`trip_${i}`) // exhausts the 20 / 8 s window
        }
        const fiber = yield* Effect.forkChild(boards.getBoards([{ node: 539, stops: null }]))
        yield* TestClock.adjust("6 seconds") // shed timeout < remaining window
        const result = yield* Fiber.join(fiber)
        expect(result.degraded).toBe(true)
        expect(yield* fake.calls).toBe(20)
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )
})

describe("snapBBox", () => {
  const box = (minLat: number, minLon: number, maxLat: number, maxLon: number): BBox => ({
    minLat,
    minLon,
    maxLat,
    maxLon,
  })

  it("snaps outward to the 0.005° grid", () => {
    expect(snapBBox(box(50.0771, 14.4121, 50.0849, 14.4279))).toEqual({
      key: "10015,2882,10017,2886",
      bbox: box(50.075, 14.41, 50.085, 14.43),
    })
  })

  it("leaves grid-aligned boxes alone", () => {
    expect(snapBBox(box(50.075, 14.41, 50.085, 14.43)).bbox).toEqual(
      box(50.075, 14.41, 50.085, 14.43),
    )
  })

  it("gives a box inside one cell a whole cell", () => {
    expect(snapBBox(box(50.0751, 14.4101, 50.0752, 14.4102)).bbox).toEqual(
      box(50.075, 14.41, 50.08, 14.415),
    )
  })

  it("clamps a snapped box back to MAX_BBOX_SPAN", () => {
    // 0.05° unaligned → 11 grid cells once snapped outward → trimmed to 10
    const { bbox } = snapBBox(box(50.0771, 14.4021, 50.1271, 14.4521))
    expect(bbox.maxLat - bbox.minLat).toBeCloseTo(MAX_BBOX_SPAN, 9)
    expect(bbox.maxLon - bbox.minLon).toBeCloseTo(MAX_BBOX_SPAN, 9)
    expect(bbox.minLat).toBe(50.075)
    expect(bbox.minLon).toBe(14.4)
  })
})
