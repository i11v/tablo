import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { GolemioClient } from "../src/golemio/client.ts"
import { fixture } from "./fixtures/departureboards.ts"
import { publicVehiclesFixture, tripFixture, tripPositionFixture } from "./fixtures/transit.ts"

const capture: { url: URL | null; token: string | undefined } = { url: null, token: undefined }

const mockHttp = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      capture.url = url
      capture.token = request.headers["x-access-token"]
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      )
    }),
  )

const layerWith = (status: number, body: unknown) =>
  GolemioClient.layer(Redacted.make("test-token")).pipe(Layer.provide(mockHttp(status, body)))

describe("GolemioClient", () => {
  it.effect("builds aswIds[] params and decodes the response", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const data = yield* client.fetchBoards([
        { node: 1040, stops: null },
        { node: 81, stops: [1, 2] },
      ])
      expect(data.departures).toHaveLength(4)
      const params = capture.url!.searchParams
      expect(params.getAll("aswIds[]")).toEqual(["1040", "81_1", "81_2"])
      expect(params.get("mode")).toBe("departures")
      expect(params.get("order")).toBe("real")
      expect(Number(params.get("minutesAfter"))).toBeGreaterThan(0)
    }).pipe(Effect.provide(layerWith(200, fixture))),
  )

  it.effect("maps 429 to GolemioRateLimitedError", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const exit = yield* Effect.exit(client.fetchBoards([{ node: 1, stops: null }]))
      expect(exit._tag).toBe("Failure")
      expect(JSON.stringify(exit)).toContain("GolemioRateLimitedError")
    }).pipe(Effect.provide(layerWith(429, {}))),
  )

  it.effect("maps 401 to GolemioUpstreamError with status", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const exit = yield* Effect.exit(client.fetchBoards([{ node: 1, stops: null }]))
      expect(JSON.stringify(exit)).toContain("GolemioUpstreamError")
      expect(JSON.stringify(exit)).toContain("401")
    }).pipe(Effect.provide(layerWith(401, { error_message: "unauthorized", error_status: 401 }))),
  )

  it.effect("fetchTrip asks for stops, stop times and shapes in one call", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const data = yield* client.fetchTrip("9_29806_261003")
      expect(data.trip_id).toBe("9_29806_261003")
      expect(data.stop_times).toHaveLength(4)
      expect(capture.url!.pathname).toBe("/v2/gtfs/trips/9_29806_261003")
      const params = capture.url!.searchParams
      expect(params.get("includeStops")).toBe("true")
      expect(params.get("includeStopTimes")).toBe("true")
      expect(params.get("includeShapes")).toBe("true")
      expect(capture.token).toBe("test-token")
    }).pipe(Effect.provide(layerWith(200, tripFixture))),
  )

  it.effect("fetchTrip maps 404 to GolemioNotFoundError", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const error = yield* Effect.flip(client.fetchTrip("nope"))
      expect(error._tag).toBe("GolemioNotFoundError")
    }).pipe(Effect.provide(layerWith(404, { error_message: "Not Found", error_status: 404 }))),
  )

  it.effect("fetchTripPosition hits the per-trip endpoint without extra params", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const data = yield* client.fetchTripPosition("9_29806_261003")
      expect(data.properties.last_position.shape_dist_traveled).toBe(5.831)
      expect(capture.url!.pathname).toBe("/v2/vehiclepositions/9_29806_261003")
      // Golemio 400s on unknown query params here
      expect([...capture.url!.searchParams.keys()]).toEqual([])
    }).pipe(Effect.provide(layerWith(200, tripPositionFixture))),
  )

  it.effect("fetchTripPosition maps 404 (not tracked) to GolemioNotFoundError", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const error = yield* Effect.flip(client.fetchTripPosition("9_1_1"))
      expect(error._tag).toBe("GolemioNotFoundError")
    }).pipe(Effect.provide(layerWith(404, { error_message: "Not Found", error_status: 404 }))),
  )

  it.effect("fetchVehicles sends the box top-left → bottom-right, lat first", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const data = yield* client.fetchVehicles({
        minLat: 50.075,
        minLon: 14.41,
        maxLat: 50.085,
        maxLon: 14.43,
      })
      expect(data.features).toHaveLength(5)
      expect(capture.url!.pathname).toBe("/v2/public/vehiclepositions")
      expect(capture.url!.searchParams.get("boundingBox")).toBe("50.085,14.41,50.075,14.43")
    }).pipe(Effect.provide(layerWith(200, publicVehiclesFixture))),
  )

  it.effect("fetchVehicles treats 404 as an empty collection", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const data = yield* client.fetchVehicles({
        minLat: 50,
        minLon: 14,
        maxLat: 50.01,
        maxLon: 14.01,
      })
      expect(data.features).toEqual([])
    }).pipe(Effect.provide(layerWith(404, { error_message: "Not Found", error_status: 404 }))),
  )
})
