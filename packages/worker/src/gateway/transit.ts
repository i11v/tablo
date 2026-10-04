import type { BBox, LiveVehicle, LiveVehicles, Trip, TripVehicle } from "@app/contract"
import { Clock, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { GolemioClient } from "../golemio/client.ts"
import { toLiveVehicle, toTrip, toTripVehicle } from "../golemio/normalize.ts"
import { type Found, makeOutcomeCache, type Outcome } from "./cache.ts"
import { UpstreamGuard } from "./upstream.ts"

export type { Outcome } from "./cache.ts"

// A trip id names one scheduled run, so its plan is static: cache it long.
// Unknown ids are remembered briefly so a bad id can't hammer upstream.
const TRIP = {
  ttlMs: 6 * 3600_000,
  notFoundTtlMs: 60_000,
  maxStaleMs: 24 * 3600_000,
  capacity: 128,
}
// Positions move: as fresh as boards. Stale ones are only worth serving for a
// minute — the payload's own timestamps tell the client how old they are.
const TRIP_VEHICLE = { ttlMs: 5_000, maxStaleMs: 60_000, capacity: 256 }
// Every vehicle in PID, fetched once and filtered per map box, so any number of
// boxes cost one upstream call per refresh.
const ALL_VEHICLES = { ttlMs: 5_000, maxStaleMs: 60_000, capacity: 1 }
const ALL = "all"

const inBox = (v: LiveVehicle, b: BBox) =>
  v.lat >= b.minLat && v.lat <= b.maxLat && v.lon >= b.minLon && v.lon <= b.maxLon

const ok = <A>(value: A): Found<A> => ({ _tag: "ok", value })
const notFound = { _tag: "notFound" } as const

export interface TransitApi {
  /** Never fails — see {@link Outcome}. */
  readonly getTrip: (tripId: string) => Effect.Effect<Outcome<Trip>>
  readonly getTripVehicle: (tripId: string) => Effect.Effect<Outcome<TripVehicle>>
  readonly getVehicles: (bbox: BBox) => Effect.Effect<Outcome<LiveVehicles>>
}

/** Trips and live vehicles, on the same upstream budget as the boards. */
export class TransitGateway extends Context.Service<TransitGateway, TransitApi>()(
  "@app/TransitGateway",
) {
  static readonly layer = Layer.effect(
    TransitGateway,
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const guard = yield* UpstreamGuard
      const trips = yield* makeOutcomeCache<Trip>(TRIP)
      const tripVehicles = yield* makeOutcomeCache<TripVehicle>(TRIP_VEHICLE)
      const snapshot = yield* makeOutcomeCache<LiveVehicles>(ALL_VEHICLES)

      const getTrip = Effect.fn("TransitGateway.getTrip")((tripId: string) =>
        trips.get(
          tripId,
          guard.run(client.fetchTrip(tripId)).pipe(
            Effect.map((data) => ok(toTrip(data))),
            Effect.catchTag("GolemioNotFoundError", () => Effect.succeed(notFound)),
          ),
        ),
      )

      const getTripVehicle = Effect.fn("TransitGateway.getTripVehicle")((tripId: string) =>
        tripVehicles.get(
          tripId,
          guard.run(client.fetchTripPosition(tripId)).pipe(
            Effect.map((data) => ok(toTripVehicle(data))),
            // not tracked right now (not started yet, finished, or no GPS)
            Effect.catchTag("GolemioNotFoundError", () => Effect.succeed(notFound)),
          ),
        ),
      )

      const getVehicles = Effect.fn("TransitGateway.getVehicles")(function* (bbox: BBox) {
        const all = yield* snapshot.get(
          ALL,
          Effect.gen(function* () {
            const data = yield* guard.run(client.fetchAllVehicles())
            const generatedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
            return ok({ vehicles: data.map(toLiveVehicle), generatedAt })
          }),
        )
        return all._tag === "ok"
          ? ok({ ...all.value, vehicles: all.value.vehicles.filter((v) => inBox(v, bbox)) })
          : all
      })

      return { getTrip, getTripVehicle, getVehicles }
    }),
  )
}
