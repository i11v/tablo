import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { BBox, LiveVehicles, Trip, TripId, TripVehicle } from "./transit.ts"

export const HealthResponse = Schema.Struct({
  ok: Schema.Boolean,
  version: Schema.String,
})

/** The trip isn't known upstream, or (for /vehicle) isn't being tracked right now. */
export class TripNotFound extends Schema.TaggedError<TripNotFound>()(
  "TripNotFound",
  { tripId: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Golemio is failing or rate-limiting us and there's nothing cached to serve. */
export class UpstreamUnavailable extends Schema.TaggedError<UpstreamUnavailable>()(
  "UpstreamUnavailable",
  { reason: Schema.String },
  { httpApiStatus: 503 },
) {}

export const Api = HttpApi.make("tablo")
  .add(
    HttpApiGroup.make("system").add(
      HttpApiEndpoint.get("health", "/api/health", { success: HealthResponse }),
    ),
  )
  .add(
    HttpApiGroup.make("transit")
      .add(
        HttpApiEndpoint.get("trip", "/api/trips/:tripId", {
          params: { tripId: TripId },
          success: Trip,
          error: [TripNotFound, UpstreamUnavailable],
        }),
      )
      .add(
        HttpApiEndpoint.get("tripVehicle", "/api/trips/:tripId/vehicle", {
          params: { tripId: TripId },
          success: TripVehicle,
          error: [TripNotFound, UpstreamUnavailable],
        }),
      )
      .add(
        HttpApiEndpoint.get("vehicles", "/api/vehicles", {
          query: { bbox: BBox },
          success: LiveVehicles,
          error: UpstreamUnavailable,
        }),
      ),
  )
