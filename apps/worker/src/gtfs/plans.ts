import {
  Trip,
  type TripBucketV1,
  tripBucketKey,
  tripBucketPath,
  tripFromBucket,
} from "@app/contract"
import { Cache, Duration, Effect, Exit, Option, Schema } from "effect"

/** Reading a bucket failed in a way worth retrying (not a plain miss). */
export class TripBucketLoadError extends Schema.TaggedError<TripBucketLoadError>()(
  "TripBucketLoadError",
  { path: Schema.String, cause: Schema.Defect() },
) {}

/**
 * Fetch one bucket file: its parsed JSON, or undefined when there is no such
 * file. Buckets only change on deploy, which replaces the isolate, so what
 * this returns is cached for the isolate's lifetime.
 */
export type LoadBucket = (path: string) => Effect.Effect<unknown, TripBucketLoadError>

export interface TripPlansApi {
  /** The plan from the deployed GTFS, or undefined to ask Golemio. Never fails. */
  readonly get: (tripId: string) => Effect.Effect<Trip | undefined>
}

const decodeTrip = Schema.decodeUnknownOption(Trip)

const asBucket = (json: unknown): TripBucketV1 | undefined =>
  typeof json === "object" &&
  json !== null &&
  (json as { version?: unknown }).version === 1 &&
  typeof (json as { trips?: unknown }).trips === "object"
    ? (json as TripBucketV1)
    : undefined

// Keep successes for the isolate's life; drop failures so the next request retries.
const keepSuccess = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? Duration.infinity : Duration.zero

/**
 * Trip plans served from the GTFS buckets shipped with the deploy, so a plan
 * costs no Golemio call and no hop through the gateway Durable Object. Per
 * isolate it keeps a few parsed buckets (a route's vehicles tend to be asked
 * for together; the largest is a few MB) and many expanded plans.
 */
export const makeTripPlans = (loadBucket: LoadBucket) =>
  Effect.gen(function* () {
    const buckets = yield* Cache.makeWith(
      (key: string) => loadBucket(tripBucketPath(key)).pipe(Effect.map(asBucket)),
      { capacity: 3, timeToLive: keepSuccess },
    )
    const plans = yield* Cache.makeWith(
      (tripId: string) =>
        Effect.gen(function* () {
          const key = tripBucketKey(tripId)
          if (key === null) return undefined
          const bucket = yield* Cache.get(buckets, key)
          if (bucket === undefined) return undefined
          // Validate the one plan we serve rather than the whole bucket.
          return Option.getOrUndefined(decodeTrip(tripFromBucket(bucket, tripId)))
        }),
      { capacity: 512, timeToLive: keepSuccess },
    )

    const get = Effect.fn("TripPlans.get")((tripId: string) =>
      Cache.get(plans, tripId).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning("trip bucket unavailable", cause), undefined),
        ),
      ),
    )
    return { get } satisfies TripPlansApi
  })

/** No deployed plans: every trip goes to Golemio. */
export const noTripPlans: TripPlansApi = { get: () => Effect.undefined }
