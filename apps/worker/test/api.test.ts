import { afterEach, describe, expect, it } from "vitest"
import { Effect, FileSystem, Layer, Path, Schema, Tracer } from "effect"
import { HttpRouter } from "effect/http"
import { LiveVehicles, Trip, TripVehicle, type BBox } from "@app/contract"
import { apiLayer } from "../src/api.ts"
import type { Outcome, TransitApi } from "../src/gateway/transit.ts"
import type { TransitRpc } from "../src/api.ts"
import { toLiveVehicle, toTrip, toTripVehicle } from "../src/golemio/normalize.ts"
import { PidTripPosition, PidTripResponse, PidVehiclePosition } from "../src/golemio/schema.ts"
import { tripFixture, tripPositionFixture, vehiclePositionsFixture } from "./fixtures/transit.ts"

const trip = toTrip(Schema.decodeUnknownSync(PidTripResponse)(tripFixture))
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
    getTrip: () => answer(trip),
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

const serve = (transit: TransitRpc, layer: Layer.Layer<never> = Layer.empty) => {
  const web = HttpRouter.toWebHandler(
    apiLayer("test", () => transit).pipe(
      Layer.provide([FileSystem.layerNoop({}), Path.layer]),
      Layer.provideMerge(layer),
    ),
    { disableLogger: true },
  )
  dispose = web.dispose
  return (path: string, init?: RequestInit) => web.handler(new Request(`http://local${path}`, init))
}

describe("transit API", () => {
  it("GET /api/trips/:tripId returns the trip plan", async () => {
    const res = await serve(fakeTransit("ok"))("/api/trips/9_29806_261003")
    expect(res.status).toBe(200)
    const body = Schema.decodeUnknownSync(Trip)(await res.json())
    expect(body.stops.map((s) => s.name)).toContain("Národní třída")
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

  it("maps notFound to 404 TripNotFound", async () => {
    const get = serve(fakeTransit({ _tag: "notFound" }))
    for (const path of ["/api/trips/9_1_1", "/api/trips/9_1_1/vehicle"]) {
      const res = await get(path)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ _tag: "TripNotFound", tripId: "9_1_1" })
    }
  })

  it("maps unavailable to 503 UpstreamUnavailable", async () => {
    const get = serve(fakeTransit({ _tag: "unavailable", reason: "GolemioRateLimitedError" }))
    for (const path of [
      "/api/trips/9_1_1",
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
    const res = await serve(fakeTransit("die"))("/api/trips/9_1_1")
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
        getTrip: (tripId, traceparent) => (seen.push(traceparent), transit.getTrip(tripId)),
      },
      Layer.succeed(Tracer.Tracer, tracer),
    )("/api/trips/9_1_1", {
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
