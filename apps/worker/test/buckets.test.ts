import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Trip, TripBucketV1, tripBucketKey, tripFromBucket } from "@app/contract"
import { buildTripBuckets, type GtfsTables } from "../src/gtfs/buckets.ts"
import { toTrip } from "../src/golemio/normalize.ts"
import { PidTripResponse } from "../src/golemio/schema.ts"
import { tripFixture } from "./fixtures/transit.ts"

const golemio = Schema.decodeUnknownSync(PidTripResponse)(tripFixture)

/** The Golemio trip fixture as the GTFS rows it was served from, plus a
 * second route and a shapeless trip. */
const gtfs = (): GtfsTables => ({
  trips: [
    ["route_id", "trip_id", "trip_headsign", "shape_id"],
    ["L9", golemio.trip_id, golemio.trip_headsign, "L9V1"],
    ["L9", "9_1_261003", "Sídliště Řepy", ""],
    ["L991", "991_7_260202", "Depo Hostivař", "L9V1"],
    ["L991", "991_8_260202", "no stop times", "L9V1"],
  ],
  stops: [
    ["stop_id", "stop_name", "stop_lat", "stop_lon", "platform_code"],
    ...[
      ...new Map(golemio.stop_times.map((st) => [st.stop.properties.stop_id, st.stop])).values(),
    ].map((s) => [
      s.properties.stop_id,
      s.properties.stop_name,
      String(s.geometry.coordinates[1]),
      String(s.geometry.coordinates[0]),
      s.properties.platform_code ?? "",
    ]),
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
    ...golemio.stop_times.map((st) => [
      golemio.trip_id,
      st.arrival_time,
      st.departure_time,
      st.stop.properties.stop_id,
      String(st.stop_sequence),
      st.shape_dist_traveled === null ? "" : String(st.shape_dist_traveled),
    ]),
    ["9_1_261003", "10:00:00", "", golemio.stop_times[0].stop.properties.stop_id, "1", ""],
    [
      "991_7_260202",
      "25:01:30",
      "25:02:00",
      golemio.stop_times[1].stop.properties.stop_id,
      "4",
      "2.5",
    ],
    ["991_7_260202", "bogus", "", golemio.stop_times[2].stop.properties.stop_id, "5", "3"],
  ],
  shapes: [
    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
    ...golemio.shapes.map((p) => [
      "L9V1",
      String(p.geometry.coordinates[1]),
      String(p.geometry.coordinates[0]),
      String(p.properties.shape_pt_sequence),
      String(p.properties.shape_dist_traveled),
    ]),
  ],
})

describe("tripBucketKey", () => {
  it("is the route prefix of a PID trip id", () => {
    expect(tripBucketKey("991_11906_260202")).toBe("991")
    expect(tripBucketKey("9_29806_261003")).toBe("9")
    expect(tripBucketKey("nounderscore")).toBeNull()
    expect(tripBucketKey("../x_1")).toBeNull()
  })
})

describe("buildTripBuckets", () => {
  const buckets = buildTripBuckets(gtfs())

  it("serves exactly the plan Golemio does for the same GTFS trip", () => {
    const bucket = buckets.get("9")!
    expect(tripFromBucket(bucket, golemio.trip_id)).toEqual(toTrip(golemio))
  })

  it("groups trips by route prefix and skips trips without stop times", () => {
    expect([...buckets.keys()]).toEqual(["9", "991"])
    expect(Object.keys(buckets.get("991")!.trips)).toEqual(["991_7_260202"])
    expect(tripFromBucket(buckets.get("991")!, "991_8_260202")).toBeUndefined()
  })

  it("normalizes times like the Golemio path and drops unparseable calls", () => {
    const night = tripFromBucket(buckets.get("991")!, "991_7_260202")!
    expect(night.stops.map((s) => [s.arrival, s.departure, s.distance])).toEqual([
      [25 * 3600 + 90, 25 * 3600 + 120, 2.5],
    ])
    const single = tripFromBucket(buckets.get("9")!, "9_1_261003")!
    expect(single.stops[0]).toMatchObject({ arrival: 36000, departure: 36000, distance: 0 })
    expect(single.shape).toEqual([])
  })

  it("emits buckets the contract schema accepts, deterministically", () => {
    for (const bucket of buckets.values()) {
      Schema.decodeUnknownSync(TripBucketV1)(bucket)
      for (const id of Object.keys(bucket.trips)) {
        Schema.decodeUnknownSync(Trip)(tripFromBucket(bucket, id))
      }
    }
    expect(JSON.stringify([...buildTripBuckets(gtfs())])).toBe(JSON.stringify([...buckets]))
  })

  it("ignores inherited keys as trip ids", () => {
    expect(tripFromBucket(buckets.get("9")!, "constructor")).toBeUndefined()
  })
})
