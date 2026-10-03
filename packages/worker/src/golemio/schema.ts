import { Schema } from "effect"

/** Subset of GET /v2/pid/departureboards we consume. Unknown fields ignored. */
const StopTime = Schema.Struct({
  predicted: Schema.NullOr(Schema.String),
  scheduled: Schema.NullOr(Schema.String),
})

const Delay = Schema.Struct({
  is_available: Schema.Boolean,
  minutes: Schema.NullOr(Schema.Number),
  seconds: Schema.NullOr(Schema.Number),
})

const Route = Schema.Struct({
  short_name: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.Number), // GTFS: 0 tram, 1 metro, 2 train, 3 bus, 11 trolleybus
  is_night: Schema.Boolean,
})

const Trip = Schema.Struct({
  headsign: Schema.String,
  id: Schema.String,
  is_canceled: Schema.Boolean,
  is_at_stop: Schema.Boolean,
})

const DepartureStop = Schema.Struct({
  id: Schema.String,
  platform_code: Schema.NullOr(Schema.String),
})

export const PidDeparture = Schema.Struct({
  departure_timestamp: StopTime,
  delay: Delay,
  route: Route,
  trip: Trip,
  stop: DepartureStop,
})
export type PidDeparture = typeof PidDeparture.Type

export const PidStop = Schema.Struct({
  stop_id: Schema.String,
  stop_name: Schema.String,
  asw_id: Schema.NullOr(Schema.Struct({ node: Schema.Number, stop: Schema.Number })),
})
export type PidStop = typeof PidStop.Type

export const PidBoardResponse = Schema.Struct({
  stops: Schema.Array(PidStop),
  departures: Schema.Array(PidDeparture),
})
export type PidBoardResponse = typeof PidBoardResponse.Type

/* ---- GET /v2/gtfs/trips/:id?includeStops&includeStopTimes&includeShapes ---- */

const PointGeometry = Schema.Struct({
  coordinates: Schema.Tuple([Schema.Number, Schema.Number]), // [lon, lat]
})

const PidTripStopTime = Schema.Struct({
  arrival_time: Schema.String, // "HH:MM:SS", may exceed 24:00
  departure_time: Schema.String,
  stop_sequence: Schema.Number,
  shape_dist_traveled: Schema.NullOr(Schema.Number),
  stop: Schema.Struct({
    geometry: PointGeometry,
    properties: Schema.Struct({
      stop_id: Schema.String,
      stop_name: Schema.String,
      platform_code: Schema.NullOr(Schema.String),
    }),
  }),
})

const PidShapePoint = Schema.Struct({
  geometry: PointGeometry,
  properties: Schema.Struct({
    shape_dist_traveled: Schema.Number,
    shape_pt_sequence: Schema.Number,
  }),
})

export const PidTripResponse = Schema.Struct({
  trip_id: Schema.String,
  trip_headsign: Schema.String,
  stop_times: Schema.Array(PidTripStopTime),
  shapes: Schema.Array(PidShapePoint),
})
export type PidTripResponse = typeof PidTripResponse.Type

/* ---- GET /v2/vehiclepositions/:tripId ---- */

const NumberOrNumeric = Schema.Union([Schema.Number, Schema.NumberFromString])

export const PidTripPosition = Schema.Struct({
  geometry: PointGeometry,
  properties: Schema.Struct({
    last_position: Schema.Struct({
      bearing: Schema.NullOr(Schema.Number),
      delay: Schema.NullOr(Schema.Struct({ actual: Schema.NullOr(Schema.Number) })),
      last_stop: Schema.NullOr(Schema.Struct({ sequence: Schema.NullOr(Schema.Number) })),
      next_stop: Schema.NullOr(Schema.Struct({ sequence: Schema.NullOr(Schema.Number) })),
      origin_timestamp: Schema.String,
      shape_dist_traveled: Schema.NullOr(NumberOrNumeric), // km; Golemio sends a string
      state_position: Schema.String,
    }),
    trip: Schema.Struct({
      gtfs: Schema.Struct({ trip_id: Schema.String }),
    }),
  }),
})
export type PidTripPosition = typeof PidTripPosition.Type

/* ---- GET /v2/public/vehiclepositions?boundingBox=… ---- */

export const PidPublicVehicles = Schema.Struct({
  features: Schema.Array(
    Schema.Struct({
      geometry: PointGeometry,
      properties: Schema.Struct({
        // Nullable defensively: one untracked vehicle must not fail the whole decode.
        gtfs_trip_id: Schema.NullOr(Schema.String),
        gtfs_route_short_name: Schema.NullOr(Schema.String),
        route_type: Schema.NullOr(Schema.String), // "tram", "metro", "bus", "train", "trolleybus", …
        bearing: Schema.NullOr(Schema.Number),
        delay: Schema.NullOr(Schema.Number),
      }),
    }),
  ),
})
export type PidPublicVehicles = typeof PidPublicVehicles.Type
