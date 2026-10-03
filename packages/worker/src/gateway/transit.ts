import type { BBox, LiveVehicles, Trip, TripVehicle } from "@app/contract"
import { MAX_BBOX_SPAN } from "@app/contract"
import { Clock, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { GolemioClient } from "../golemio/client.ts"
import { toLiveVehicles, toTrip, toTripVehicle } from "../golemio/normalize.ts"
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
const VEHICLES = { ttlMs: 5_000, maxStaleMs: 60_000, capacity: 64 }

/** Bboxes snap outward to this grid (degrees) so nearby clients share entries. */
export const BBOX_GRID = 0.005
const CELLS_PER_DEGREE = Math.round(1 / BBOX_GRID)
const MAX_SPAN_CELLS = Math.round(MAX_BBOX_SPAN * CELLS_PER_DEGREE)

/** Snap one axis outward to the grid, then clamp it (centred) to MAX_BBOX_SPAN. */
const snapAxis = (min: number, max: number): readonly [number, number] => {
  // The epsilon keeps values already on a grid line (50.075 → 10015 cells)
  // from being pushed a whole cell out by float error.
  let lo = Math.floor(min * CELLS_PER_DEGREE + 1e-9)
  let hi = Math.ceil(max * CELLS_PER_DEGREE - 1e-9)
  if (hi <= lo) hi = lo + 1
  const excess = hi - lo - MAX_SPAN_CELLS
  if (excess > 0) {
    lo += Math.floor(excess / 2)
    hi = lo + MAX_SPAN_CELLS
  }
  return [lo, hi]
}

/** Snapped box plus its canonical cache key. */
export const snapBBox = (bbox: BBox): { readonly key: string; readonly bbox: BBox } => {
  const [latLo, latHi] = snapAxis(bbox.minLat, bbox.maxLat)
  const [lonLo, lonHi] = snapAxis(bbox.minLon, bbox.maxLon)
  return {
    key: `${latLo},${lonLo},${latHi},${lonHi}`,
    bbox: {
      minLat: latLo / CELLS_PER_DEGREE,
      minLon: lonLo / CELLS_PER_DEGREE,
      maxLat: latHi / CELLS_PER_DEGREE,
      maxLon: lonHi / CELLS_PER_DEGREE,
    },
  }
}

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
      const vehicles = yield* makeOutcomeCache<LiveVehicles>(VEHICLES)

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

      const getVehicles = Effect.fn("TransitGateway.getVehicles")((requested: BBox) => {
        const { key, bbox } = snapBBox(requested)
        return vehicles.get(
          key,
          Effect.gen(function* () {
            const data = yield* guard.run(client.fetchVehicles(bbox))
            const fetchedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
            return ok(toLiveVehicles(data, fetchedAt))
          }),
        )
      })

      return { getTrip, getTripVehicle, getVehicles }
    }),
  )
}
