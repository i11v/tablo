import { Schema } from "effect"
import { VehicleKind } from "./domain.ts"

/** Bound on client-subscribed route ids — same reasoning as MAX_SELECTORS. */
export const MAX_VEHICLE_ROUTES = 32

/** GTFS route id, e.g. "L22", "L991". Bounded: it becomes DO storage. */
export const RouteId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16))

/** One live vehicle, slimmed at the worker edge from Golemio vehiclepositions. */
export const VehiclePosition = Schema.Struct({
  id: Schema.String, // GTFS trip id — stable for one run of the vehicle
  routeId: Schema.String, // "L22"
  route: Schema.String, // "22" — display short name
  kind: VehicleKind,
  lat: Schema.Number,
  lon: Schema.Number,
  bearing: Schema.NullOr(Schema.Number), // degrees, 0 = north
  delaySeconds: Schema.NullOr(Schema.Number),
  headsign: Schema.NullOr(Schema.String),
  atStop: Schema.Boolean,
  timestamp: Schema.String, // vehicle-reported ISO time (staleness signal)
})
export type VehiclePosition = typeof VehiclePosition.Type
