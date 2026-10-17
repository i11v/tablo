import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { type TripBucketV1, tripFromBucket } from "@app/contract"
import { buildTripBuckets } from "../src/gtfs/buckets.ts"
import { makeTripPlans, TripBucketLoadError } from "../src/gtfs/plans.ts"

const notFound = { _tag: "notFound" } as const

const bucket: TripBucketV1 = buildTripBuckets({
  trips: [
    ["trip_id", "trip_headsign", "shape_id"],
    ["22_1_260101", "Bílá Hora", ""],
    ["22_2_260101", "Nádraží Hostivař", ""],
  ],
  stops: [
    ["stop_id", "stop_name", "stop_lat", "stop_lon", "platform_code"],
    ["U1Z1P", "Anděl", "50.07", "14.40", "A"],
  ],
  stopTimes: [
    [
      "trip_id",
      "arrival_time",
      "departure_time",
      "stop_id",
      "stop_sequence",
      "shape_dist_traveled",
    ],
    ["22_1_260101", "08:00:00", "08:00:30", "U1Z1P", "1", "0"],
    ["22_2_260101", "09:00:00", "09:00:00", "U1Z1P", "1", "0"],
  ],
  shapes: [
    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
  ],
}).get("22")!

type Mode = "ok" | "missing" | "fail"

const setup = Effect.gen(function* () {
  const loads = yield* Ref.make<ReadonlyArray<string>>([])
  const mode = yield* Ref.make<Mode>("ok")
  const plans = yield* makeTripPlans((path) =>
    Effect.gen(function* () {
      yield* Ref.update(loads, (l) => [...l, path])
      switch (yield* Ref.get(mode)) {
        case "ok":
          return path === "/data/trips/v1/22.json"
            ? (JSON.parse(JSON.stringify(bucket)) as unknown)
            : undefined
        case "missing":
          return undefined
        case "fail":
          return yield* new TripBucketLoadError({ path, cause: new Error("boom") })
      }
    }),
  )
  return { plans, loads, mode }
})

describe("TripPlans", () => {
  it.effect("serves plans from the route's bucket, loading it once", () =>
    Effect.gen(function* () {
      const { plans, loads } = yield* setup
      expect(yield* plans.get("22_1_260101")).toEqual({
        _tag: "ok",
        value: tripFromBucket(bucket, "22_1_260101"),
      })
      expect(yield* plans.get("22_2_260101")).toMatchObject({
        value: { headsign: "Nádraží Hostivař" },
      })
      expect((yield* plans.get("22_1_260101"))._tag).toBe("ok")
      expect(yield* Ref.get(loads)).toEqual(["/data/trips/v1/22.json"])
    }),
  )

  it.effect("misses for unknown trips, routes and id shapes", () =>
    Effect.gen(function* () {
      const { plans, loads } = yield* setup
      expect(yield* plans.get("22_9_260101")).toEqual(notFound)
      expect(yield* plans.get("999_1_260101")).toEqual(notFound)
      expect(yield* plans.get("nounderscore")).toEqual(notFound)
      expect(yield* Ref.get(loads)).toEqual(["/data/trips/v1/22.json", "/data/trips/v1/999.json"])
    }),
  )

  it.effect("reports a failed load as unavailable and retries it next time", () =>
    Effect.gen(function* () {
      const { plans, loads, mode } = yield* setup
      yield* Ref.set(mode, "fail")
      expect(yield* plans.get("22_1_260101")).toEqual({
        _tag: "unavailable",
        reason: "TripBucketLoadError",
      })
      yield* Ref.set(mode, "ok")
      expect((yield* plans.get("22_1_260101"))._tag).toBe("ok")
      expect(yield* Ref.get(loads)).toHaveLength(2)
    }),
  )

  it.effect("reports malformed data as unavailable, never serves it", () =>
    Effect.gen(function* () {
      const broken = { ...bucket, stops: [["Anděl", "50.07", 14.4, 1, 1, "A"]] }
      const plans = yield* makeTripPlans(() => Effect.succeed(broken as unknown))
      expect((yield* plans.get("22_1_260101"))._tag).toBe("unavailable")
      const notABucket = yield* makeTripPlans(() => Effect.succeed("<html>" as unknown))
      expect((yield* notABucket.get("22_1_260101"))._tag).toBe("unavailable")
    }),
  )
})
