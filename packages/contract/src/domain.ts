import { Schema } from "effect"

export const VehicleKind = Schema.Literals(["tram", "metro", "train", "bus", "other"])
export type VehicleKind = typeof VehicleKind.Type

/**
 * Caps on client-supplied selections. The Subscribe payload drives upstream
 * Golemio URLs, gateway cache keys and DO storage, all keyed by anonymous
 * client input — without bounds a single client could fabricate unlimited
 * cache entries and burn the shared upstream rate budget. Prague ASW node
 * ids are ≤6 digits and a node has a handful of platforms; these limits are
 * far above any legitimate use.
 */
export const MAX_SELECTORS = 20
export const MAX_PLATFORMS_PER_SELECTOR = 16

/** Positive integer id as found in PID's ASW registry (node or platform id). */
const AswId = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 999_999 }),
)

/** A user-facing stop selection: a whole ASW node, or specific platforms within it. */
export const StopSelector = Schema.Struct({
  node: AswId,
  stops: Schema.NullOr(
    Schema.Array(AswId).check(Schema.isMaxLength(MAX_PLATFORMS_PER_SELECTOR)),
  ),
})
export type StopSelector = typeof StopSelector.Type

/** Canonical key for a selector — board id on the wire and cache key. */
export const selectorKey = (s: StopSelector): string =>
  s.stops === null ? `${s.node}` : `${s.node}:${[...s.stops].sort((a, b) => a - b).join(",")}`

export const Departure = Schema.Struct({
  route: Schema.String,                    // "9", "B", "S7"
  kind: VehicleKind,
  headsign: Schema.String,
  // ISO 8601 WITH OFFSET, passed through from Golemio — production data is
  // Prague-local (+01:00 CET / +02:00 CEST), not Z-suffixed UTC. Consume via
  // Date.parse only; never compare or slice the strings.
  scheduled: Schema.String,
  predicted: Schema.NullOr(Schema.String), // carries realtime delay when present
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
