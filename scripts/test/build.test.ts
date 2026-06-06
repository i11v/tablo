import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { StopIndexV1 } from "@app/contract"
import { buildIndex } from "../lib/build.ts"

// header matches real PID stops.txt (verified 2026-06-06)
const HEADER = ["stop_id","stop_name","stop_lat","stop_lon","zone_id","stop_url","location_type","parent_station","wheelchair_boarding","level_id","platform_code","asw_node_id","asw_stop_id","zone_region_type"]
const row = (over: Record<string, string>): string[] =>
  HEADER.map((h) => over[h] ?? (h === "location_type" ? "0" : ""))

const rows = [
  HEADER,
  row({ stop_id: "U1040Z1P", stop_name: "Anděl", stop_lat: "50.0710", stop_lon: "14.4030", zone_id: "P", asw_node_id: "1040", asw_stop_id: "1" }),
  row({ stop_id: "U1040Z2P", stop_name: "Anděl", stop_lat: "50.0712", stop_lon: "14.4032", zone_id: "P", asw_node_id: "1040", asw_stop_id: "2" }),
  // node 81 carries two distinct names -> platform-scoped entries
  row({ stop_id: "U81Z1P", stop_name: "Dělnická", stop_lat: "50.10", stop_lon: "14.45", zone_id: "P", asw_node_id: "81", asw_stop_id: "1" }),
  row({ stop_id: "U81Z2P", stop_name: "Tusarova", stop_lat: "50.11", stop_lon: "14.46", zone_id: "P", asw_node_id: "81", asw_stop_id: "2" }),
  // no ASW node -> excluded (rail/technical waypoint)
  row({ stop_id: "T53041", stop_name: "hr.VUSC 0200/0520 04" }),
  // non-platform location_type -> excluded
  row({ stop_id: "U1040S1", stop_name: "Anděl", location_type: "1", asw_node_id: "1040" }),
]

describe("buildIndex", () => {
  const index = buildIndex(rows, "2026-06-06T00:00:00.000Z")

  it("produces a schema-valid v1 artifact", () => {
    expect(() => Schema.decodeUnknownSync(StopIndexV1)(index)).not.toThrow()
  })

  it("groups single-name nodes as whole-node entries with centroid", () => {
    const andel = index.stops.find((s) => s.name === "Anděl")
    expect(andel).toBeDefined()
    expect(andel!.node).toBe(1040)
    expect(andel!.stops).toBeNull()
    expect(andel!.lat).toBeCloseTo(50.0711, 4)
    expect(andel!.zone).toBe("P")
    expect(andel!.norm).toBe("andel")
  })

  it("splits multi-name nodes into platform-scoped entries", () => {
    const delnicka = index.stops.find((s) => s.name === "Dělnická")
    const tusarova = index.stops.find((s) => s.name === "Tusarova")
    expect(delnicka!.stops).toEqual([1])
    expect(tusarova!.stops).toEqual([2])
    expect(delnicka!.node).toBe(81)
  })

  it("excludes ASW-less and non-platform rows", () => {
    expect(index.stops.some((s) => s.name.startsWith("hr."))).toBe(false)
    expect(index.stops).toHaveLength(3)
  })

  it("fills disambig when the same folded name exists at multiple nodes", () => {
    const withDupe = buildIndex(
      [...rows, row({ stop_id: "U9000Z1", stop_name: "Anděl", stop_lat: "49.0", stop_lon: "15.0", zone_id: "B", asw_node_id: "9000", asw_stop_id: "1" })],
      "2026-06-06T00:00:00.000Z",
    )
    const both = withDupe.stops.filter((s) => s.norm === "andel")
    expect(both).toHaveLength(2)
    expect(both.every((s) => s.disambig !== null)).toBe(true)
  })
})
