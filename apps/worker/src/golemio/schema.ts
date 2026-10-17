import { Effect, Option, Schema } from "effect"

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

const NumberOrNumeric = Schema.Union([Schema.Number, Schema.NumberFromString])

/** An odd asw_id (Golemio has sent non-numbers here) decodes to null rather than
 * failing the whole multi-stop board; toBoards then falls back to the stop_id. */
const AswId = Schema.NullOr(Schema.Struct({ node: NumberOrNumeric, stop: NumberOrNumeric })).pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
)

export const PidStop = Schema.Struct({
  stop_id: Schema.String,
  stop_name: Schema.String,
  asw_id: AswId,
})
export type PidStop = typeof PidStop.Type

export const PidBoardResponse = Schema.Struct({
  stops: Schema.Array(PidStop),
  departures: Schema.Array(PidDeparture),
})
export type PidBoardResponse = typeof PidBoardResponse.Type

/* ---- GET /v2/vehiclepositions/:tripId ---- */

const PointGeometry = Schema.Struct({
  coordinates: Schema.Tuple([Schema.Number, Schema.Number]), // [lon, lat]
})

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

/* ---- GET /v2/vehiclepositions?limit=… (every tracked vehicle) ---- */

/** One vehicle of the city-wide list: a trip position plus its route. */
export const PidVehiclePosition = Schema.Struct({
  geometry: PointGeometry,
  properties: Schema.Struct({
    last_position: PidTripPosition.fields.properties.fields.last_position,
    trip: Schema.Struct({
      gtfs: Schema.Struct({
        trip_id: Schema.String,
        route_short_name: Schema.NullOr(Schema.String),
        route_type: Schema.NullOr(Schema.Number), // GTFS: 0 tram, 1 metro, 2 train, 3 bus, 11 trolleybus
      }),
    }),
  }),
})
export type PidVehiclePosition = typeof PidVehiclePosition.Type

/** The list's envelope. Features are decoded one by one (see GolemioClient),
 * so one malformed vehicle drops only itself, not the whole city. */
export const PidVehiclePositions = Schema.Struct({
  features: Schema.Array(Schema.Unknown),
})
