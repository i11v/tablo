import { afterEach, describe, expect, it } from "vitest"
import { Effect, FileSystem, Layer, Path, Schema, Tracer } from "effect"
import { HttpRouter } from "effect/http"
import { LiveVehicles, Trip, TripVehicle, type BBox } from "@app/contract"
import { apiLayer } from "../src/api.ts"
import type { TripPlansApi } from "../src/gtfs/plans.ts"
import type { Outcome, TransitApi } from "../src/gateway/transit.ts"
import type { TransitRpc } from "../src/api.ts"
import { toLiveVehicle, toTripVehicle } from "../src/golemio/normalize.ts"
import { PidTripPosition, PidVehiclePosition } from "../src/golemio/schema.ts"
import { tripPositionFixture, vehiclePositionsFixture } from "./fixtures/transit.ts"

const trip: Trip = {
  tripId: "9_29806_261003",
  headsign: "Spojovací",
  stops: [
    {
      name: "Národní třída",
      lat: 50.081158,
      lon: 14.419593,
      node: 539,
      stop: 1,
      platform: "A",
      sequence: 13,
      arrival: 39_900,
      departure: 39_900,
      distance: 6.381883,
    },
  ],
  shape: [[14.41959, 50.08116, 6.3819]],
}
const vehicle = toTripVehicle(Schema.decodeUnknownSync(PidTripPosition)(tripPositionFixture))
const vehicles = {
  vehicles: vehiclePositionsFixture.features
    .slice(0, 4)
    .map((f) => toLiveVehicle(Schema.decodeUnknownSync(PidVehiclePosition)(f))),
  generatedAt: "2026-10-03T09:04:00.000Z",
}

const ok = <A>(value: A): Outcome<A> => ({ _tag: "ok", value })

/** Gateway stand-in: every method answers `outcome` (or `ok` with fixtures). */
const fakeTransit = (
  outcome: "ok" | Outcome<never> | "die",
  seen: { bbox?: BBox } = {},
): TransitApi => {
  const answer = <A>(value: A): Effect.Effect<Outcome<A>> =>
    outcome === "die"
      ? Effect.die(new Error("RpcCallError: instance reset"))
      : Effect.succeed(outcome === "ok" ? ok(value) : outcome)
  return {
    getTripVehicle: () => answer(vehicle),
    getVehicles: (bbox) => {
      seen.bbox = bbox
      return answer(vehicles)
    },
  }
}

let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  dispose = undefined
})

/** Deployed-GTFS stand-in: knows `trip`, or answers `outcome` for everything. */
const fakePlans = (outcome?: Outcome<never> | "die"): TripPlansApi => ({
  get: (id) =>
    outcome === "die"
      ? Effect.die(new Error("boom"))
      : Effect.succeed(
          outcome ?? (id === trip.tripId ? ok(trip) : ({ _tag: "notFound" } as const)),
        ),
})

const serve = (
  transit: TransitRpc,
  layer: Layer.Layer<never> = Layer.empty,
  plans: TripPlansApi = fakePlans(),
) => {
  const web = HttpRouter.toWebHandler(
    apiLayer("test", () => transit, plans).pipe(
      Layer.provide([FileSystem.layerNoop({}), Path.layer]),
      Layer.provideMerge(layer),
    ),
    { disableLogger: true },
  )
  dispose = web.dispose
  return (path: string, init?: RequestInit) => web.handler(new Request(`http://local${path}`, init))
}

describe("transit API", () => {
  it("GET /api/trips/:tripId serves the deployed GTFS plan, never the gateway", async () => {
    // A gateway that dies proves trips never reach it.
    const get = serve(fakeTransit("die"))
    const res = await get("/api/trips/" + trip.tripId)
    expect(res.status).toBe(200)
    expect(Schema.decodeUnknownSync(Trip)(await res.json())).toEqual(trip)
    const miss = await get("/api/trips/9_1_1")
    expect(miss.status).toBe(404)
    expect(await miss.json()).toEqual({ _tag: "TripNotFound", tripId: "9_1_1" })
  })

  it("maps an unreadable trip bucket to 503, not 404 or 500", async () => {
    const unavailable = { _tag: "unavailable", reason: "TripBucketLoadError" } as const
    for (const plans of [fakePlans(unavailable), fakePlans("die")]) {
      const res = await serve(fakeTransit("ok"), Layer.empty, plans)("/api/trips/9_1_1")
      expect(res.status).toBe(503)
    }
  })

  it("GET /api/trips/:tripId/vehicle returns the live position", async () => {
    const res = await serve(fakeTransit("ok"))("/api/trips/9_29806_261003/vehicle")
    expect(res.status).toBe(200)
    expect(Schema.decodeUnknownSync(TripVehicle)(await res.json())).toEqual(vehicle)
  })

  it("GET /api/vehicles decodes the bbox and returns vehicles", async () => {
    const seen: { bbox?: BBox } = {}
    const res = await serve(fakeTransit("ok", seen))(
      "/api/vehicles?bbox=50.077,14.412,50.085,14.428",
    )
    expect(res.status).toBe(200)
    expect(Schema.decodeUnknownSync(LiveVehicles)(await res.json()).vehicles).toHaveLength(4)
    expect(seen.bbox).toEqual({ minLat: 50.077, minLon: 14.412, maxLat: 50.085, maxLon: 14.428 })
  })

  it("maps an untracked vehicle to 404 TripNotFound", async () => {
    const res = await serve(fakeTransit({ _tag: "notFound" }))("/api/trips/9_1_1/vehicle")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ _tag: "TripNotFound", tripId: "9_1_1" })
  })

  it("maps unavailable to 503 UpstreamUnavailable", async () => {
    const get = serve(fakeTransit({ _tag: "unavailable", reason: "GolemioRateLimitedError" }))
    for (const path of [
      "/api/trips/9_1_1/vehicle",
      "/api/vehicles?bbox=50.077,14.412,50.085,14.428",
    ]) {
      const res = await get(path)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({
        _tag: "UpstreamUnavailable",
        reason: "GolemioRateLimitedError",
      })
    }
  })

  it("maps a failed DO hop to 503, not 500", async () => {
    const res = await serve(fakeTransit("die"))("/api/trips/9_1_1/vehicle")
    expect(res.status).toBe(503)
  })

  it("passes the client's trace on to the gateway", async () => {
    const seen: Array<string | undefined> = []
    const transit = fakeTransit("ok")
    // any tracer but the built-in no-op one turns on request spans
    const tracer = Tracer.make({ span: (options) => new Tracer.NativeSpan(options) })
    const res = await serve(
      {
        ...transit,
        getTripVehicle: (tripId, traceparent) => (
          seen.push(traceparent),
          transit.getTripVehicle(tripId)
        ),
      },
      Layer.succeed(Tracer.Tracer, tracer),
    )("/api/trips/9_1_1/vehicle", {
      headers: { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" },
    })
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/)
  })

  it("rejects bad input with 400", async () => {
    const get = serve(fakeTransit("ok"))
    for (const path of [
      "/api/vehicles",
      "/api/vehicles?bbox=nonsense",
      "/api/vehicles?bbox=50.085,14.412,50.077,14.428", // min > max
      "/api/vehicles?bbox=49.5,14.0,50.6,14.2", // too large
      "/api/trips/" + encodeURIComponent("bad id!"),
    ]) {
      expect({ path, status: (await get(path)).status }).toEqual({ path, status: 400 })
    }
  })
})
