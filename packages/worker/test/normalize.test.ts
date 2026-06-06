import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { PidBoardResponse } from "../src/golemio/schema.ts"
import { routeTypeToKind, toBoards } from "../src/golemio/normalize.ts"
import { fixture } from "./fixtures/departureboards.ts"

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
      [{ node: 81, stops: [2] }, { node: 1040, stops: null }],
      data,
    )
    expect(boards.map((b) => b.key)).toEqual(["81:2", "1040"])
    expect(boards[0].departures).toHaveLength(1)
    expect(boards[0].departures[0].route).toBe("1")
    // node 1040: t1 + t2; t4 dropped (both timestamps null)
    expect(boards[1].departures.map((d) => d.route)).toEqual(["9", "B"])
  })

  it("respects platform scoping", () => {
    const boards = toBoards([{ node: 81, stops: [99] }], data)
    expect(boards[0].departures).toHaveLength(0)
  })

  it("normalizes fields", () => {
    const [board] = toBoards([{ node: 1040, stops: null }], data)
    const d = board.departures[0]
    expect(d).toEqual({
      route: "9", kind: "tram", headsign: "Sídliště Řepy",
      scheduled: "2026-06-06T12:04:00.000Z", predicted: "2026-06-06T12:05:30.000Z",
      delaySeconds: 90, isCanceled: false, isAtStop: false, platform: "A",
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
