import { Schema, SchemaTransformation } from "effect"
import { VehicleKind } from "./domain.ts"

/**
 * GTFS trip ids as PID publishes them ("9_29806_261003", "992_1734_260829").
 * Bounded charset + length: the id is interpolated into an upstream Golemio
 * URL and used as a gateway cache key.
 */
export const TripId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]{1,64}$/))

/** One stop on a trip, in travel order. */
export const TripStop = Schema.Struct({
  name: Schema.String,
  lat: Schema.Number,
  lon: Schema.Number,
  // ASW ids parsed from the GTFS stop id ("U539Z1P" → node 539, stop 1);
  // null for stops outside the ASW registry (rail waypoints).
  node: Schema.NullOr(Schema.Number),
  stop: Schema.NullOr(Schema.Number),
  platform: Schema.NullOr(Schema.String),
  sequence: Schema.Number,
  // Scheduled times as seconds after the trip's service-day midnight. GTFS
  // times run past 24:00 for after-midnight trips, so they're not wall-clock
  // strings; clients anchor them with a departure's absolute timestamp.
  arrival: Schema.Number,
  departure: Schema.Number,
  // Distance along the shape, km — lines a vehicle position up with the path.
  distance: Schema.Number,
})
export type TripStop = typeof TripStop.Type

/** A shape point: [lon, lat, distance along the shape in km]. */
export const ShapePoint = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number])
export type ShapePoint = typeof ShapePoint.Type

/** A trip's static plan: its stops and the path between them. */
export const Trip = Schema.Struct({
  tripId: Schema.String,
  headsign: Schema.String,
  stops: Schema.Array(TripStop),
  shape: Schema.Array(ShapePoint),
})
export type Trip = typeof Trip.Type

/** Where one trip's vehicle is right now. */
export const TripVehicle = Schema.Struct({
  tripId: Schema.String,
  lat: Schema.Number,
  lon: Schema.Number,
  bearing: Schema.NullOr(Schema.Number),
  delaySeconds: Schema.NullOr(Schema.Number),
  // Sequences of the stop last served and the next one ahead (TripStop.sequence).
  lastStopSequence: Schema.NullOr(Schema.Number),
  nextStopSequence: Schema.NullOr(Schema.Number),
  distance: Schema.NullOr(Schema.Number), // km along the shape
  // Golemio state_position: on_track, at_stop, before_track, after_track, off_track, canceled, …
  state: Schema.String,
  updatedAt: Schema.String,
})
export type TripVehicle = typeof TripVehicle.Type

/** A vehicle on the map around a stop. */
export const LiveVehicle = Schema.Struct({
  tripId: Schema.String,
  route: Schema.String,
  kind: VehicleKind,
  lat: Schema.Number,
  lon: Schema.Number,
  bearing: Schema.NullOr(Schema.Number),
  delaySeconds: Schema.NullOr(Schema.Number),
})
export type LiveVehicle = typeof LiveVehicle.Type

export const LiveVehicles = Schema.Struct({
  vehicles: Schema.Array(LiveVehicle),
  generatedAt: Schema.String,
})
export type LiveVehicles = typeof LiveVehicles.Type

/** Largest bbox side the vehicles endpoint serves, in degrees (~5 km). */
export const MAX_BBOX_SPAN = 0.05

/**
 * "minLat,minLon,maxLat,maxLon" in WGS-84 degrees. Bounded in size: every
 * distinct box costs an upstream call, so the gateway also snaps it to a grid.
 */
export const BBox = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Struct({
      minLat: Schema.Number,
      minLon: Schema.Number,
      maxLat: Schema.Number,
      maxLon: Schema.Number,
    }).check(
      Schema.makeFilter(
        (b) =>
          b.minLat < b.maxLat &&
          b.minLon < b.maxLon &&
          b.maxLat - b.minLat <= MAX_BBOX_SPAN &&
          b.maxLon - b.minLon <= MAX_BBOX_SPAN &&
          b.minLat >= -90 &&
          b.maxLat <= 90 &&
          b.minLon >= -180 &&
          b.maxLon <= 180,
        { title: `bbox with sides ≤ ${MAX_BBOX_SPAN}°` },
      ),
    ),
    SchemaTransformation.transform({
      // Malformed input yields NaN fields, which the filter above rejects.
      decode: (s: string) => {
        const [minLat, minLon, maxLat, maxLon] = s.split(",").map(Number)
        return { minLat, minLon, maxLat, maxLon }
      },
      encode: (b) => [b.minLat, b.minLon, b.maxLat, b.maxLon].join(","),
    }),
  ),
)
export type BBox = typeof BBox.Type
