import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import type { BBox } from "@app/contract"
import {
  GolemioNotFoundError,
  GolemioRateLimitedError,
  GolemioUpstreamError,
} from "../src/golemio/errors.ts"
import type { GolemioClient } from "../src/golemio/client.ts"
import { PidTripPosition, PidTripResponse, PidVehiclePosition } from "../src/golemio/schema.ts"
import { DepartureGateway } from "../src/gateway/service.ts"
import { TransitGateway } from "../src/gateway/transit.ts"
import { fakeClient, guardLayer } from "./fakes.ts"
import { tripFixture, tripPositionFixture, vehiclePositionsFixture } from "./fixtures/transit.ts"

const tripData = Schema.decodeUnknownSync(PidTripResponse)(tripFixture)
const positionData = Schema.decodeUnknownSync(PidTripPosition)(tripPositionFixture)
const vehiclesData = vehiclePositionsFixture.features
  .slice(0, 4)
  .map((f) => Schema.decodeUnknownSync(PidVehiclePosition)(f))

const box = (minLat: number, minLon: number, maxLat: number, maxLon: number): BBox => ({
  minLat,
  minLon,
  maxLat,
  maxLon,
})

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
    fetchAllVehicles: () =>
      respond("vehicles", vehiclesData).pipe(
        Effect.catchTag("GolemioNotFoundError", () => Effect.succeed([])),
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

  it.effect("serves every box from one city-wide snapshot, filtered", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const centre = yield* gw.getVehicles(box(50.07, 14.4, 50.1, 14.44))
        const east = yield* gw.getVehicles(box(50.03, 14.55, 50.06, 14.58))
        const all = yield* gw.getVehicles(box(49.8, 14, 50.6, 14.99))
        expect(yield* Ref.get(fake.log)).toEqual(["vehicles"])
        const ids = (o: typeof centre) =>
          o._tag === "ok" ? o.value.vehicles.map((v) => v.tripId) : o
        expect(ids(centre)).toEqual(["24_8789_260829", "991_11748_260202"])
        expect(ids(east)).toEqual(["175_2073_260901"])
        expect(ids(all)).toHaveLength(4)
        expect(centre).toMatchObject({
          _tag: "ok",
          value: { generatedAt: new Date(0).toISOString() },
        })
      }).pipe(Effect.provide(gatewaysLayer(fake.layer)))
    }),
  )

  it.effect("refreshes the snapshot after 5 s and serves it stale while upstream fails", () =>
    Effect.gen(function* () {
      const fake = yield* makeFake
      yield* Effect.gen(function* () {
        const gw = yield* TransitGateway
        const centre = box(50.07, 14.4, 50.1, 14.44)
        const first = yield* gw.getVehicles(centre)
        yield* TestClock.adjust("4 seconds")
        yield* gw.getVehicles(centre)
        expect(yield* fake.calls).toBe(1)
        yield* TestClock.adjust("2 seconds")
        yield* Ref.set(fake.mode, "fail")
        expect(yield* gw.getVehicles(centre)).toEqual(first)
        expect(yield* fake.calls).toBe(2)
        yield* TestClock.adjust("60 seconds")
        expect(yield* gw.getVehicles(centre)).toEqual({
          _tag: "unavailable",
          reason: "GolemioUpstreamError",
        })
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
