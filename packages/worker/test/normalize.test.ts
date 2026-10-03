import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { LiveVehicles, Trip, TripVehicle } from "@app/contract"
import {
  PidBoardResponse,
  PidPublicVehicles,
  PidTripPosition,
  PidTripResponse,
} from "../src/golemio/schema.ts"
import {
  gtfsTimeToSeconds,
  parseAswStopId,
  publicRouteTypeToKind,
  routeTypeToKind,
  toBoards,
  toLiveVehicles,
  toTrip,
  toTripVehicle,
} from "../src/golemio/normalize.ts"
import { fixture } from "./fixtures/departureboards.ts"
import { publicVehiclesFixture, tripFixture, tripPositionFixture } from "./fixtures/transit.ts"

describe("PidBoardResponse", () => {
  it("decodes the fixture, ignoring unknown fields", () => {
    const data = Schema.decodeUnknownSync(PidBoardResponse)(fixture)
    expect(data.departures).toHaveLength(4)
    expect(data.stops[0].asw_id).toEqual({ node: 1040, stop: 1 })
  })
})

describe("routeTypeToKind", () => {
  it("maps GTFS route types", () => {
    expect(routeTypeToKind(0)).toBe("tram")
    expect(routeTypeToKind(1)).toBe("metro")
    expect(routeTypeToKind(2)).toBe("train")
    expect(routeTypeToKind(3)).toBe("bus")
    expect(routeTypeToKind(11)).toBe("bus") // trolleybus rendered as bus in v1
    expect(routeTypeToKind(null)).toBe("other")
    expect(routeTypeToKind(7)).toBe("other")
  })
})

describe("toBoards", () => {
  const data = Schema.decodeUnknownSync(PidBoardResponse)(fixture)

  it("groups departures into boards per selector, in selector order", () => {
    const boards = toBoards(
      [
        { node: 81, stops: [2] },
        { node: 1040, stops: null },
      ],
      data,
    )
    expect(boards.map((b) => b.key)).toEqual(["81:2", "1040"])
    expect(boards[0].departures).toHaveLength(1)
    expect(boards[0].departures[0].route).toBe("1")
    // node 1040: t1 + t2; t4 dropped (both timestamps null)
    expect(boards[1].departures.map((d) => d.route)).toEqual(["9", "B"])
  })

  it("drops departures with an unparseable effective timestamp", () => {
    // A garbage timestamp would yield NaN from the sort comparator and
    // scramble board ordering; toDeparture must drop it like a null one.
    const garbage = Schema.decodeUnknownSync(PidBoardResponse)({
      stops: [{ stop_id: "U1040Z1P", stop_name: "Anděl", asw_id: { node: 1040, stop: 1 } }],
      departures: [
        {
          departure_timestamp: { predicted: null, scheduled: "2026-06-06T12:04:00.000Z" },
          delay: { is_available: false, minutes: null, seconds: null },
          route: { short_name: "OK", type: 0, is_night: false },
          trip: { headsign: "Good", id: "g1", is_canceled: false, is_at_stop: false },
          stop: { id: "U1040Z1P", platform_code: null },
        },
        {
          departure_timestamp: { predicted: "not-a-date", scheduled: "also-garbage" },
          delay: { is_available: false, minutes: null, seconds: null },
          route: { short_name: "G", type: 0, is_night: false },
          trip: { headsign: "Garbage", id: "g2", is_canceled: false, is_at_stop: false },
          stop: { id: "U1040Z1P", platform_code: null },
        },
      ],
    })
    const [board] = toBoards([{ node: 1040, stops: null }], garbage)
    expect(board.departures.map((d) => d.route)).toEqual(["OK"])
  })

  it("degrades to schedule-only when predicted is garbage but scheduled is valid", () => {
    const mixed = Schema.decodeUnknownSync(PidBoardResponse)({
      stops: [{ stop_id: "U1040Z1P", stop_name: "Anděl", asw_id: { node: 1040, stop: 1 } }],
      departures: [
        {
          departure_timestamp: { predicted: "not-a-date", scheduled: "2026-06-06T12:04:00.000Z" },
          delay: { is_available: false, minutes: null, seconds: null },
          route: { short_name: "9", type: 0, is_night: false },
          trip: { headsign: "X", id: "m1", is_canceled: false, is_at_stop: false },
          stop: { id: "U1040Z1P", platform_code: null },
        },
      ],
    })
    const [board] = toBoards([{ node: 1040, stops: null }], mixed)
    expect(board.departures).toHaveLength(1)
    expect(board.departures[0].predicted).toBeNull()
    expect(board.departures[0].scheduled).toBe("2026-06-06T12:04:00.000Z")
  })

  it("handles offset-bearing Prague-local timestamps (the format production sends)", () => {
    // Golemio emits +01:00/+02:00 offsets, not Z. The strings pass through
    // verbatim and ordering must hold on offset-bearing values.
    const offsets = Schema.decodeUnknownSync(PidBoardResponse)({
      stops: [{ stop_id: "U1040Z1P", stop_name: "Anděl", asw_id: { node: 1040, stop: 1 } }],
      departures: [
        {
          departure_timestamp: {
            predicted: "2026-06-09T14:50:00.000+02:00",
            scheduled: "2026-06-09T14:48:00.000+02:00",
          },
          delay: { is_available: true, minutes: 2, seconds: null },
          route: { short_name: "9", type: 0, is_night: false },
          trip: { headsign: "Later", id: "o2", is_canceled: false, is_at_stop: false },
          stop: { id: "U1040Z1P", platform_code: null },
        },
        {
          departure_timestamp: { predicted: null, scheduled: "2026-06-09T14:15:00.000+02:00" },
          delay: { is_available: false, minutes: null, seconds: null },
          route: { short_name: "B", type: 1, is_night: false },
          trip: { headsign: "Earlier", id: "o1", is_canceled: false, is_at_stop: false },
          stop: { id: "U1040Z1P", platform_code: null },
        },
      ],
    })
    const [board] = toBoards([{ node: 1040, stops: null }], offsets)
    expect(board.departures.map((d) => d.headsign)).toEqual(["Earlier", "Later"])
    expect(board.departures[1].scheduled).toBe("2026-06-09T14:48:00.000+02:00")
    expect(board.departures[1].delaySeconds).toBe(120)
  })

  it("respects platform scoping", () => {
    const boards = toBoards([{ node: 81, stops: [99] }], data)
    expect(boards[0].departures).toHaveLength(0)
  })

  it("normalizes fields", () => {
    const [board] = toBoards([{ node: 1040, stops: null }], data)
    const d = board.departures[0]
    expect(d).toEqual({
      route: "9",
      kind: "tram",
      headsign: "Sídliště Řepy",
      scheduled: "2026-06-06T12:04:00.000Z",
      predicted: "2026-06-06T12:05:30.000Z",
      delaySeconds: 90,
      isCanceled: false,
      isAtStop: false,
      platform: "A",
      tripId: "t1",
    })
    const noRealtime = board.departures[1]
    expect(noRealtime.predicted).toBeNull()
    expect(noRealtime.delaySeconds).toBeNull()
    expect(noRealtime.platform).toBeNull()
  })

  it("sorts departures by effective time", () => {
    const [board] = toBoards([{ node: 1040, stops: null }], data)
    const times = board.departures.map((d) => Date.parse(d.predicted ?? d.scheduled))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe("gtfsTimeToSeconds", () => {
  it("counts seconds after service-day midnight, past 24:00 too", () => {
    expect(gtfsTimeToSeconds("10:46:00")).toBe(38_760)
    expect(gtfsTimeToSeconds("00:00:00")).toBe(0)
    expect(gtfsTimeToSeconds("25:10:05")).toBe(90_605)
    expect(gtfsTimeToSeconds("7:05:00")).toBe(25_500) // GTFS allows H:MM:SS
  })
  it("rejects garbage", () => {
    expect(gtfsTimeToSeconds("")).toBeNull()
    expect(gtfsTimeToSeconds("10:46")).toBeNull()
    expect(gtfsTimeToSeconds("10:61:00")).toBeNull()
  })
})

describe("parseAswStopId", () => {
  it("parses U<node>Z<stop> GTFS stop ids", () => {
    expect(parseAswStopId("U539Z1P")).toEqual({ node: 539, stop: 1 })
    expect(parseAswStopId("U539Z101P")).toEqual({ node: 539, stop: 101 })
    expect(parseAswStopId("U1072Z301")).toEqual({ node: 1072, stop: 301 })
  })
  it("returns null for non-ASW ids", () => {
    expect(parseAswStopId("T58005")).toBeNull()
    expect(parseAswStopId("U539S1")).toBeNull()
  })
})

describe("publicRouteTypeToKind", () => {
  it("maps Golemio's named route types", () => {
    expect(publicRouteTypeToKind("tram")).toBe("tram")
    expect(publicRouteTypeToKind("metro")).toBe("metro")
    expect(publicRouteTypeToKind("train")).toBe("train")
    expect(publicRouteTypeToKind("bus")).toBe("bus")
    expect(publicRouteTypeToKind("trolleybus")).toBe("bus")
    expect(publicRouteTypeToKind("ferry")).toBe("other")
    expect(publicRouteTypeToKind(null)).toBe("other")
  })
})

describe("toTrip", () => {
  const data = Schema.decodeUnknownSync(PidTripResponse)(tripFixture)

  it("orders stops by sequence and normalizes them", () => {
    const trip = toTrip(data)
    expect(trip.tripId).toBe("9_29806_261003")
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
    const trip = toTrip(data)
    expect(trip.shape).toEqual([
      [14.34667, 50.06807, 0],
      [14.34678, 50.06807, 0.0084],
      [14.35185, 50.06824, 0.3723],
      [14.49929, 50.09159, 14.9414],
      [14.49942, 50.09154, 14.9523],
    ])
  })

  it("drops consecutive points that coincide after rounding", () => {
    const [first] = tripFixture.shapes.filter((p) => p.properties.shape_pt_sequence === 1)
    const nearDuplicate = {
      ...first,
      geometry: { ...first.geometry, coordinates: [14.3466662, 50.0680658] },
      properties: { ...first.properties, shape_pt_sequence: 1.5, shape_dist_traveled: 0.0001 },
    }
    const trip = toTrip(
      Schema.decodeUnknownSync(PidTripResponse)({
        ...tripFixture,
        shapes: [...tripFixture.shapes, nearDuplicate],
      }),
    )
    expect(trip.shape).toHaveLength(5)
    expect(trip.shape[0]).toEqual([14.34667, 50.06807, 0])
  })

  it("falls back across arrival/departure and drops stops with no usable time", () => {
    const [a, b] = tripFixture.stop_times
    const trip = toTrip(
      Schema.decodeUnknownSync(PidTripResponse)({
        ...tripFixture,
        stop_times: [
          { ...a, arrival_time: "garbage" },
          { ...b, arrival_time: "x", departure_time: "y", shape_dist_traveled: null },
        ],
      }),
    )
    expect(trip.stops).toHaveLength(1)
    expect(trip.stops[0].arrival).toBe(trip.stops[0].departure)
  })

  it("produces a value the contract schema accepts", () => {
    expect(() => Schema.decodeUnknownSync(Trip)(toTrip(data))).not.toThrow()
  })
})

describe("toTripVehicle", () => {
  it("normalizes a live trip position", () => {
    const data = Schema.decodeUnknownSync(PidTripPosition)(tripPositionFixture)
    const vehicle = toTripVehicle(data)
    expect(vehicle).toEqual({
      tripId: "9_29806_261003",
      lat: 50.08141,
      lon: 14.41406,
      bearing: 88,
      delaySeconds: 64,
      lastStopSequence: 12,
      nextStopSequence: 13,
      distance: 5.831, // upstream sends the string "5.831"
      state: "at_stop",
      updatedAt: "2026-10-03T11:03:41+02:00",
    })
    expect(() => Schema.decodeUnknownSync(TripVehicle)(vehicle)).not.toThrow()
  })

  it("nulls missing realtime bits", () => {
    const raw = tripPositionFixture.properties.last_position
    const data = Schema.decodeUnknownSync(PidTripPosition)({
      ...tripPositionFixture,
      properties: {
        ...tripPositionFixture.properties,
        last_position: {
          ...raw,
          bearing: null,
          delay: null,
          last_stop: null,
          next_stop: { ...raw.next_stop, sequence: null },
          shape_dist_traveled: null,
        },
      },
    })
    const vehicle = toTripVehicle(data)
    expect(vehicle.bearing).toBeNull()
    expect(vehicle.delaySeconds).toBeNull()
    expect(vehicle.lastStopSequence).toBeNull()
    expect(vehicle.nextStopSequence).toBeNull()
    expect(vehicle.distance).toBeNull()
  })
})

describe("toLiveVehicles", () => {
  const data = Schema.decodeUnknownSync(PidPublicVehicles)(publicVehiclesFixture)

  it("maps features to vehicles, dropping ones without a trip", () => {
    const result = toLiveVehicles(data, "2026-10-03T09:04:00.000Z")
    expect(result.generatedAt).toBe("2026-10-03T09:04:00.000Z")
    expect(result.vehicles.map((v) => v.tripId)).toEqual([
      "23_9755_260926",
      "992_1421_260829",
      "9_29806_261003",
      "58_101_261003",
    ])
    expect(result.vehicles[0]).toEqual({
      tripId: "23_9755_260926",
      route: "23",
      kind: "tram",
      lat: 50.08107,
      lon: 14.41971,
      bearing: 174,
      delaySeconds: 242,
    })
    expect(result.vehicles[1].kind).toBe("metro")
    expect(result.vehicles[1].route).toBe("B")
    expect(result.vehicles[3]).toMatchObject({
      route: "?",
      kind: "bus",
      bearing: null,
      delaySeconds: null,
    })
    expect(() => Schema.decodeUnknownSync(LiveVehicles)(result)).not.toThrow()
  })
})
