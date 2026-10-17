import { Schema } from "effect"
import { ShapePoint, type Trip } from "./transit.ts"

/**
 * Trip plans built from PID's static GTFS at deploy time, one file per route
 * under {@link TRIP_BUCKET_DIR}. The Worker serves /api/trips/:tripId from
 * these, so a plan costs no upstream call. Not read by the clients directly:
 * the API's `Trip` stays the contract; this is its storage format.
 */
export const TRIP_BUCKET_DIR = "/data/trips/v1"

/**
 * Bucket of a trip id: its route prefix ("991_11906_260202" → "991"). PID
 * trip ids always start with the route number; null for any other shape.
 */
export const tripBucketKey = (tripId: string): string | null => {
  const m = /^([A-Za-z0-9]+)_/.exec(tripId)
  return m === null ? null : m[1]
}

export const tripBucketPath = (key: string): string => `${TRIP_BUCKET_DIR}/${key}.json`

/** [name, lat, lon, ASW node, ASW stop, platform] — a `TripStop` minus the per-trip part. */
export const TripBucketStop = Schema.Tuple([
  Schema.String,
  Schema.Number,
  Schema.Number,
  Schema.NullOr(Schema.Number),
  Schema.NullOr(Schema.Number),
  Schema.NullOr(Schema.String),
])
export type TripBucketStop = typeof TripBucketStop.Type

/** [index into the bucket's stops, sequence, arrival s, departure s, distance km]. */
export const TripBucketCall = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
])
export type TripBucketCall = typeof TripBucketCall.Type

export const TripBucketTrip = Schema.Struct({
  headsign: Schema.String,
  /** Key into the bucket's shapes; null when the trip has none. */
  shape: Schema.NullOr(Schema.String),
  /** In travel order. */
  calls: Schema.Array(TripBucketCall),
})
export type TripBucketTrip = typeof TripBucketTrip.Type

export const TripBucketV1 = Schema.Struct({
  version: Schema.Literal(1),
  stops: Schema.Array(TripBucketStop),
  shapes: Schema.Record(Schema.String, Schema.Array(ShapePoint)),
  trips: Schema.Record(Schema.String, TripBucketTrip),
})
export type TripBucketV1 = typeof TripBucketV1.Type

/** The plan of `tripId` as the API serves it, or undefined if the bucket lacks it. */
export const tripFromBucket = (bucket: TripBucketV1, tripId: string): Trip | undefined => {
  if (!Object.hasOwn(bucket.trips, tripId)) return undefined
  const trip = bucket.trips[tripId]
  return {
    tripId,
    headsign: trip.headsign,
    stops: trip.calls.map(([index, sequence, arrival, departure, distance]) => {
      const [name, lat, lon, node, stop, platform] = bucket.stops[index]
      return { name, lat, lon, node, stop, platform, sequence, arrival, departure, distance }
    }),
    shape:
      trip.shape !== null && Object.hasOwn(bucket.shapes, trip.shape)
        ? bucket.shapes[trip.shape]
        : [],
  }
}
