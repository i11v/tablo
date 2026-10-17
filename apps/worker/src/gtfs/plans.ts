import {
  Trip,
  type TripBucketV1,
  tripBucketKey,
  tripBucketPath,
  tripFromBucket,
} from "@app/contract"
import { Cache, Cause, Duration, Effect, Exit, Option, Schema } from "effect"
import type { Outcome } from "../gateway/cache.ts"
import { reasonOf } from "../gateway/upstream.ts"

/** A bucket couldn't be read or holds malformed data (not a plain miss). */
export class TripBucketLoadError extends Schema.TaggedError<TripBucketLoadError>()(
  "TripBucketLoadError",
  { path: Schema.String, cause: Schema.Defect() },
) {}

/**
 * Fetch one bucket file: its parsed JSON, or undefined when there is no such
 * file (a route the feed doesn't have). Buckets only change on deploy, which replaces the isolate, so what
 * this returns is cached for the isolate's lifetime.
 */
export type LoadBucket = (path: string) => Effect.Effect<unknown, TripBucketLoadError>

export interface TripPlansApi {
  /**
   * The plan from the deployed GTFS. notFound when the feed has no such
   * trip; unavailable when its bucket couldn't be read. Never fails.
   */
  readonly get: (tripId: string) => Effect.Effect<Outcome<Trip>>
}

const decodeTrip = Schema.decodeUnknownOption(Trip)

const isBucket = (json: unknown): json is TripBucketV1 =>
  typeof json === "object" &&
  json !== null &&
  (json as { version?: unknown }).version === 1 &&
  typeof (json as { trips?: unknown }).trips === "object"

// Keep successes for the isolate's life; drop failures so the next request retries.
const keepSuccess = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? Duration.infinity : Duration.zero

/**
 * Trip plans served from the GTFS buckets shipped with the deploy, so a plan
 * costs no upstream call and no hop through the gateway Durable Object. Per
 * isolate it keeps a few parsed buckets (a route's vehicles tend to be asked
 * for together; the largest is a few MB) and many expanded plans.
 */
export const makeTripPlans = (loadBucket: LoadBucket) =>
  Effect.gen(function* () {
    const buckets = yield* Cache.makeWith(
      (key: string) => {
        const path = tripBucketPath(key)
        return Effect.flatMap(loadBucket(path), (json) =>
          json === undefined || isBucket(json)
            ? Effect.succeed(json)
            : Effect.fail(new TripBucketLoadError({ path, cause: "not a v1 trip bucket" })),
        )
      },
      { capacity: 3, timeToLive: keepSuccess },
    )
    const plans = yield* Cache.makeWith(
      (tripId: string) =>
        Effect.gen(function* () {
          const key = tripBucketKey(tripId)
          if (key === null) return undefined
          const bucket = yield* Cache.get(buckets, key)
          if (bucket === undefined) return undefined
          const raw = tripFromBucket(bucket, tripId)
          if (raw === undefined) return undefined
          // Validate the one plan we serve rather than the whole bucket. A
          // broken one is our data bug: unavailable, not "no such trip".
          const trip = decodeTrip(raw)
          if (Option.isNone(trip)) {
            return yield* new TripBucketLoadError({ path: tripBucketPath(key), cause: tripId })
          }
          return trip.value
        }),
      { capacity: 512, timeToLive: keepSuccess },
    )

    const get = Effect.fn("TripPlans.get")((tripId: string) =>
      Cache.get(plans, tripId).pipe(
        Effect.map(
          (trip): Outcome<Trip> =>
            trip === undefined ? { _tag: "notFound" } : { _tag: "ok", value: trip },
        ),
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning("trip bucket unavailable", cause), {
            _tag: "unavailable",
            reason: reasonOf(Cause.squash(cause)),
          } as const),
        ),
      ),
    )
    return { get } satisfies TripPlansApi
  })
