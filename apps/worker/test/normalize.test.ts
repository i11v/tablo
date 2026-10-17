import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { LiveVehicle, TripVehicle } from "@app/contract"
import { PidBoardResponse, PidTripPosition, PidVehiclePosition } from "../src/golemio/schema.ts"
import {
  routeTypeToKind,
  toBoards,
  toLiveVehicle,
  toTripVehicle,
} from "../src/golemio/normalize.ts"
import { fixture } from "./fixtures/departureboards.ts"
import { tripPositionFixture, vehiclePositionsFixture } from "./fixtures/transit.ts"

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

describe("toLiveVehicle", () => {
  const [tram, metro, , , trolleybus] = vehiclePositionsFixture.features
    .slice(0, 5) // the 6th is the malformed one
    .map((f) => Schema.decodeUnknownSync(PidVehiclePosition)(f))

  it("carries the trip position, its report time and what to draw it as", () => {
    const vehicle = toLiveVehicle(tram)
    expect(vehicle).toEqual({
      tripId: "24_8789_260829",
      route: "24",
      kind: "tram",
      lat: 50.09144,
      lon: 14.43988,
      bearing: 247,
      delaySeconds: -16,
      lastStopSequence: 19,
      nextStopSequence: 20,
      distance: 7.421801,
      state: "at_stop",
      updatedAt: "2026-10-04T23:41:44+02:00",
    })
    expect(() => Schema.decodeUnknownSync(LiveVehicle)(vehicle)).not.toThrow()
    expect(toLiveVehicle(metro)).toMatchObject({ route: "A", kind: "metro", state: "on_track" })
  })

  it("tolerates a vehicle with no route name, bearing, delay, stops or distance", () => {
    expect(toLiveVehicle(trolleybus)).toMatchObject({
      route: "?",
      kind: "bus",
      bearing: null,
      delaySeconds: null,
      lastStopSequence: null,
      nextStopSequence: null,
      distance: null,
    })
  })
})
