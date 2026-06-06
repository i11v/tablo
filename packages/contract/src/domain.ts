import { Schema } from "effect"

export const VehicleKind = Schema.Literals(["tram", "metro", "train", "bus", "other"])
export type VehicleKind = typeof VehicleKind.Type

/** A user-facing stop selection: a whole ASW node, or specific platforms within it. */
export const StopSelector = Schema.Struct({
  node: Schema.Number,
  stops: Schema.NullOr(Schema.Array(Schema.Number)),
})
export type StopSelector = typeof StopSelector.Type

/** Canonical key for a selector — board id on the wire and cache key. */
export const selectorKey = (s: StopSelector): string =>
  s.stops === null ? `${s.node}` : `${s.node}:${[...s.stops].sort((a, b) => a - b).join(",")}`

export const Departure = Schema.Struct({
  route: Schema.String,                    // "9", "B", "S7"
  kind: VehicleKind,
  headsign: Schema.String,
  scheduled: Schema.String,                // ISO UTC
  predicted: Schema.NullOr(Schema.String), // ISO UTC, carries realtime delay
  delaySeconds: Schema.NullOr(Schema.Number),
  isCanceled: Schema.Boolean,
  isAtStop: Schema.Boolean,
  platform: Schema.NullOr(Schema.String),
})
export type Departure = typeof Departure.Type

export const StopBoard = Schema.Struct({
  key: Schema.String, // selectorKey of the subscribed selector
  departures: Schema.Array(Departure),
})
export type StopBoard = typeof StopBoard.Type
