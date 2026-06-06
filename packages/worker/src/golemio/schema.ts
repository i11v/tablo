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
