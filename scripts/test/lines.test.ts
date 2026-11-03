import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { LinesV1 } from "@app/contract"
import { buildLines } from "../lib/lines.ts"

// `metres` east and north of Národní třída
const at = (east: number, north: number): [number, number] => [
  50.0817 + north / 110_574,
  14.4194 + east / (Math.cos((50.08 * Math.PI) / 180) * 111_320),
]

const ROUTES = ["route_id", "route_type", "is_regional"]
const TRIPS = ["route_id", "trip_id", "shape_id"]
const SHAPES = ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]

const shape = (id: string, points: Array<[number, number]>): string[][] =>
  points.map(([lat, lon], i) => [id, String(lat), String(lon), String(i + 1)])

const build = (
  routes: string[][],
  trips: string[][],
  shapes: string[][],
): ReturnType<typeof buildLines> =>
  buildLines(
    { routes: [ROUTES, ...routes], trips: [TRIPS, ...trips], shapes: [SHAPES, ...shapes] },
    "2026-11-03T03:00:00.000Z",
  )

/** How far north of Národní třída a coordinate pair sits, in metres. */
const north = (lat: number) => (lat - 50.0817) * 110_574

describe("buildLines", () => {
  it("draws the two tracks of a street once", () => {
    const lines = build(
      [["L22", "0", "0"]],
      [
        ["L22", "t1", "S1"],
        ["L22", "t2", "S2"],
      ],
      [...shape("S1", [at(0, 0), at(300, 0)]), ...shape("S2", [at(300, 4), at(0, 4)])],
    )
    Schema.decodeUnknownSync(LinesV1)(lines)
    expect(lines.lines).toHaveLength(1)
    expect(lines.lines[0].kinds).toEqual(["tram"])
    const lats = lines.lines[0].coords.filter((_, i) => i % 2 === 0)
    for (const lat of lats) expect(Math.abs(north(lat))).toBeLessThan(1)
  })

  it("marks the stretch buses share with trams, and leaves a crossing street alone", () => {
    const lines = build(
      [
        ["L22", "0", "0"],
        ["L176", "3", "0"],
        ["L9", "0", "0"],
      ],
      [
        ["L22", "t1", "TRAM"],
        ["L22", "t2", "TRAM"],
        ["L176", "b1", "BUS"],
        ["L9", "c1", "CROSS"],
      ],
      [
        ...shape("TRAM", [at(0, 0), at(400, 0)]),
        // runs with the tram for 200 m, 3 m off, then turns away north
        ...shape("BUS", [at(0, 3), at(200, 3), at(200, 300)]),
        ...shape("CROSS", [at(300, -200), at(300, 200)]),
      ],
    )
    const kinds = lines.lines.map((l) => l.kinds.join("+")).sort()
    expect(kinds).toContain("tram+bus")
    expect(kinds).toContain("bus")
    const shared = lines.lines.find((l) => l.kinds.join("+") === "tram+bus")!
    for (const lat of shared.coords.filter((_, i) => i % 2 === 0))
      expect(Math.abs(north(lat))).toBeLessThan(1)
    // the crossing tram keeps to its own street: no point of it bends towards the other line
    const crossing = lines.lines.filter((l) =>
      l.coords.some((v, i) => i % 2 === 0 && north(v) < -50),
    )
    expect(crossing).toHaveLength(1)
    const east = (lon: number) => (lon - 14.4194) * Math.cos((50.08 * Math.PI) / 180) * 111_320
    for (const lon of crossing[0].coords.filter((_, i) => i % 2 === 1))
      expect(Math.abs(east(lon) - 300)).toBeLessThan(1)
  })

  it("keeps metro apart and leaves out regional routes and other modes", () => {
    const lines = build(
      [
        ["L22", "0", "0"],
        ["L992", "1", "0"],
        ["L300", "3", "1"],
        ["S9", "2", "1"],
      ],
      [
        ["L22", "t1", "TRAM"],
        ["L992", "m1", "METRO"],
        ["L300", "r1", "REGIONAL"],
        ["S9", "s1", "TRAIN"],
      ],
      [
        ...shape("TRAM", [at(0, 0), at(300, 0)]),
        ...shape("METRO", [at(0, 3), at(300, 3)]),
        ...shape("REGIONAL", [at(0, 100), at(300, 100)]),
        ...shape("TRAIN", [at(0, 200), at(300, 200)]),
      ],
    )
    expect(lines.lines.map((l) => l.kinds)).toEqual([["tram"], ["metro"]])
  })

  it("draws a wide street once: trams in the median, buses in each carriageway", () => {
    const lines = build(
      [
        ["L22", "0", "0"],
        ["L176", "3", "0"],
      ],
      [
        ["L22", "t1", "TRAM"],
        ["L22", "t2", "TRAM"],
        ["L176", "b1", "EAST"],
        ["L176", "b2", "WEST"],
      ],
      [
        ...shape("TRAM", [at(0, 0), at(500, 0)]),
        ...shape("EAST", [at(0, -11), at(500, -11)]),
        ...shape("WEST", [at(500, 12), at(0, 12)]),
      ],
    )
    expect(lines.lines.map((l) => l.kinds)).toEqual([["tram", "bus"]])
  })

  it("keeps a turn through a junction, joined to both streets and rounded", () => {
    const lines = build(
      [
        ["L9", "0", "0"],
        ["L22", "0", "0"],
        ["L7", "0", "0"],
      ],
      [
        ["L9", "t1", "EASTWEST"],
        ["L22", "t2", "NORTHSOUTH"],
        ["L7", "t3", "TURN"],
      ],
      [
        ...shape("EASTWEST", [at(-300, 0), at(300, 0)]),
        ...shape("NORTHSOUTH", [at(0, -300), at(0, 300)]),
        // tram 7: in from the west, turning north at the crossroads
        ...shape("TURN", [at(-300, 2), at(0, 2), at(2, 300)]),
      ],
    )
    const east = (lon: number) => (lon - 14.4194) * Math.cos((50.08 * Math.PI) / 180) * 111_320
    const turn = lines.lines.filter((l) => {
      const pts = l.coords.length / 2
      return Array.from({ length: pts }, (_, i) => [
        east(l.coords[2 * i + 1]),
        north(l.coords[2 * i]),
      ]).some(([x, y]) => x < -3 && y > 3)
    })
    // a curve cutting the corner, not a gap: it leaves the east-west line and joins the north-south one
    expect(turn).toHaveLength(1)
    const pts = Array.from({ length: turn[0].coords.length / 2 }, (_, i) => [
      east(turn[0].coords[2 * i + 1]),
      north(turn[0].coords[2 * i]),
    ])
    const [x0, y0] = pts[0],
      [x1, y1] = pts[pts.length - 1]
    expect(Math.abs(y0)).toBeLessThan(1)
    expect(Math.abs(x1)).toBeLessThan(1)
    expect(x0).toBeLessThan(-10)
    expect(y1).toBeGreaterThan(10)
    // rounded: more than a single corner
    expect(pts.length).toBeGreaterThan(4)
  })
})
