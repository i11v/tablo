import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Trip, TripBucketV1, tripBucketKey, tripFromBucket } from "@app/contract"
import { buildTripBuckets, type GtfsTables, gtfsTimeToSeconds } from "../src/gtfs/buckets.ts"
import { parseAswStopId } from "../src/asw.ts"

const TRIP = "9_29806_261003"

/** Rows of PID's GTFS for tram 9 (4 of its 33 calls, 5 of 414 shape points),
 * out of order on purpose: the feed doesn't promise any order. */
const gtfs = (extra: Partial<Record<keyof GtfsTables, Array<Array<string>>>> = {}): GtfsTables => ({
  trips: [
    ["route_id", "service_id", "trip_id", "trip_headsign", "shape_id"],
    ["L9", "0000010-2", TRIP, "Spojovací", "L9V1"],
    ["L9", "0000010-2", "9_1_261003", "Sídliště Řepy", ""],
    ["L991", "1111111-1", "991_7_260202", "Depo Hostivař", "L9V1"],
    ["L991", "1111111-1", "991_8_260202", "no stop times", "L9V1"],
    ...(extra.trips ?? []),
  ],
  stops: [
    ["stop_id", "stop_name", "stop_lat", "stop_lon", "platform_code"],
    ["U539Z1P", "Národní třída", "50.081158", "14.419593", "A"],
    ["U567Z1P", "Hotel Golf", "50.068031", "14.346667", "A"],
    ["U694Z2P", "Spojovací", "50.091507", "14.499409", "B"],
    ["U483Z1P", "Národní divadlo", "50.081413", "14.414886", "A"],
    ["T58005", "Praha-Libeň (waypoint)", "50.1", "14.49", ""],
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
    [TRIP, "11:05:00", "11:05:00", "U539Z1P", "13", "6.381883"],
    [TRIP, "10:46:00", "10:46:00", "U567Z1P", "1", "0"],
    [TRIP, "11:39:00", "11:39:00", "U694Z2P", "33", "14.9523"],
    [TRIP, "11:03:00", "11:03:00", "U483Z1P", "12", "5.932476"],
    ["9_1_261003", "10:00:00", "", "T58005", "1", ""],
    ["991_7_260202", "25:01:30", "25:02:00", "U483Z1P", "4", "2.5"],
    ["991_7_260202", "bogus", "x", "U539Z1P", "5", "3"],
    ...(extra.stopTimes ?? []),
  ],
  shapes: [
    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
    ["L9V1", "50.06807", "14.346783", "2", "0.00837"],
    ["L9V1", "50.068066", "14.346666", "1", "0"],
    ["L9V1", "50.091535", "14.49942", "414", "14.9523"],
    ["L9V1", "50.068242", "14.351854", "3", "0.372326"],
    ["L9V1", "50.091588", "14.499291", "413", "14.941364"],
    ...(extra.shapes ?? []),
  ],
})

const plan = (tripId: string, tables = gtfs()) =>
  tripFromBucket(buildTripBuckets(tables).get(tripBucketKey(tripId)!)!, tripId)

describe("gtfsTimeToSeconds", () => {
  it("parses service-day times, including past midnight", () => {
    expect(gtfsTimeToSeconds("10:46:00")).toBe(38_760)
    expect(gtfsTimeToSeconds("00:00:00")).toBe(0)
    expect(gtfsTimeToSeconds("25:10:05")).toBe(90_605)
    expect(gtfsTimeToSeconds("7:05:00")).toBe(25_500) // GTFS allows H:MM:SS
  })
  it("rejects anything else", () => {
    expect(gtfsTimeToSeconds("")).toBeNull()
    expect(gtfsTimeToSeconds("10:46")).toBeNull()
    expect(gtfsTimeToSeconds("10:61:00")).toBeNull()
  })
})

describe("parseAswStopId", () => {
  it("reads node and stop from ASW stop ids", () => {
    expect(parseAswStopId("U539Z1P")).toEqual({ node: 539, stop: 1 })
    expect(parseAswStopId("U539Z101P")).toEqual({ node: 539, stop: 101 })
    expect(parseAswStopId("U1072Z301")).toEqual({ node: 1072, stop: 301 })
  })
  it("is null for rail waypoints and other ids", () => {
    expect(parseAswStopId("T58005")).toBeNull()
    expect(parseAswStopId("U539S1")).toBeNull()
  })
})

describe("tripBucketKey", () => {
  it("is the route prefix of a PID trip id", () => {
    expect(tripBucketKey("991_11906_260202")).toBe("991")
    expect(tripBucketKey(TRIP)).toBe("9")
    expect(tripBucketKey("nounderscore")).toBeNull()
    expect(tripBucketKey("../x_1")).toBeNull()
  })
})

describe("buildTripBuckets", () => {
  it("orders calls by sequence and normalizes them", () => {
    const trip = plan(TRIP)!
    expect(trip.tripId).toBe(TRIP)
    expect(trip.headsign).toBe("Spojovací")
    expect(trip.stops.map((s) => s.sequence)).toEqual([1, 12, 13, 33])
    expect(trip.stops[2]).toEqual({
      name: "Národní třída",
      lat: 50.081158,
      lon: 14.419593,
      node: 539,
      stop: 1,
      platform: "A",
      sequence: 13,
      arrival: 11 * 3600 + 5 * 60,
      departure: 11 * 3600 + 5 * 60,
      distance: 6.381883,
    })
    expect(trip.stops[0].distance).toBe(0)
  })

  it("orders the shape by sequence as rounded [lon, lat, km] points", () => {
    expect(plan(TRIP)!.shape).toEqual([
      [14.34667, 50.06807, 0],
      [14.34678, 50.06807, 0.0084],
      [14.35185, 50.06824, 0.3723],
      [14.49929, 50.09159, 14.9414],
      [14.49942, 50.09154, 14.9523],
    ])
  })

  it("drops consecutive shape points that coincide after rounding", () => {
    const shape = plan(
      TRIP,
      gtfs({ shapes: [["L9V1", "50.0680658", "14.3466662", "1.5", "0.0001"]] }),
    )!.shape
    expect(shape).toHaveLength(5)
    expect(shape[0]).toEqual([14.34667, 50.06807, 0])
  })

  it("falls back across arrival/departure and drops calls with no usable time", () => {
    const night = plan("991_7_260202")!
    expect(night.stops.map((s) => [s.arrival, s.departure, s.distance])).toEqual([
      [25 * 3600 + 90, 25 * 3600 + 120, 2.5],
    ])
    const waypoint = plan("9_1_261003")!
    expect(waypoint.stops[0]).toMatchObject({
      node: null,
      stop: null,
      platform: null,
      arrival: 36_000,
      departure: 36_000,
      distance: 0,
    })
    expect(waypoint.shape).toEqual([])
  })

  it("groups trips by route prefix and skips trips without calls", () => {
    const buckets = buildTripBuckets(gtfs())
    expect([...buckets.keys()]).toEqual(["9", "991"])
    expect(Object.keys(buckets.get("991")!.trips)).toEqual(["991_7_260202"])
    expect(plan("991_8_260202")).toBeUndefined()
    expect(tripFromBucket(buckets.get("9")!, "constructor")).toBeUndefined() // not inherited keys
  })

  it("emits buckets and plans the contract accepts, deterministically", () => {
    const buckets = buildTripBuckets(gtfs())
    for (const bucket of buckets.values()) {
      Schema.decodeUnknownSync(TripBucketV1)(bucket)
      for (const id of Object.keys(bucket.trips)) {
        Schema.decodeUnknownSync(Trip)(tripFromBucket(bucket, id))
      }
    }
    expect(JSON.stringify([...buildTripBuckets(gtfs())])).toBe(JSON.stringify([...buckets]))
  })
})
