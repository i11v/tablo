import { Schema } from "effect"
import { routeTypeToKind, type VehiclePosition } from "@app/contract"

/** Subset of GET /v2/vehiclepositions we consume. Unknown fields ignored. */
const VpGtfs = Schema.Struct({
  route_id: Schema.String,
  route_short_name: Schema.String,
  route_type: Schema.Number,
  trip_id: Schema.String,
  trip_headsign: Schema.optional(Schema.NullOr(Schema.String)),
})

const VpFeature = Schema.Struct({
  geometry: Schema.Struct({ coordinates: Schema.Array(Schema.Number) }),
  properties: Schema.Struct({
    trip: Schema.Struct({ gtfs: VpGtfs }),
    last_position: Schema.Struct({
      bearing: Schema.NullOr(Schema.Number),
      delay: Schema.Struct({ actual: Schema.NullOr(Schema.Number) }),
      is_canceled: Schema.NullOr(Schema.Boolean),
      origin_timestamp: Schema.String,
      state_position: Schema.String,
      tracking: Schema.NullOr(Schema.Boolean),
    }),
  }),
})

export const VehiclePositionsResponse = Schema.Struct({ features: Schema.Array(VpFeature) })
export type VehiclePositionsResponse = typeof VehiclePositionsResponse.Type

/** Slim Golemio features to the wire shape; drop canceled and untracked runs. */
export const toVehicles = (data: VehiclePositionsResponse): Array<VehiclePosition> => {
  const out: Array<VehiclePosition> = []
  for (const f of data.features) {
    const p = f.properties
    if (p.last_position.is_canceled === true) continue
    if (p.last_position.tracking === false) continue
    const [lon, lat] = f.geometry.coordinates
    if (lon === undefined || lat === undefined) continue
    out.push({
      id: p.trip.gtfs.trip_id,
      routeId: p.trip.gtfs.route_id,
      route: p.trip.gtfs.route_short_name,
      kind: routeTypeToKind(p.trip.gtfs.route_type),
      lat,
      lon,
      bearing: p.last_position.bearing,
      delaySeconds: p.last_position.delay.actual,
      headsign: p.trip.gtfs.trip_headsign ?? null,
      atStop: p.last_position.state_position === "at_stop",
      timestamp: p.last_position.origin_timestamp,
    })
  }
  return out
}
