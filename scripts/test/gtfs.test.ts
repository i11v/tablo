import { describe, expect, it } from "vitest"
import { parseCsv } from "../lib/csv.ts"
import { indexGtfsStops, nodeRoutes, parseRoutes, parseTrips } from "../lib/gtfs.ts"

const stopsTxt = [
  "stop_id,stop_name,stop_lat,stop_lon,zone_id,location_type,asw_node_id,asw_stop_id,platform_code",
  "U1040Z1,Anděl,50.07,14.40,P,0,1040,1,A",
  "U1040Z2,Anděl,50.071,14.401,P,0,1040,2,B",
  "T123,Depot,50.0,14.0,,1,,,",
].join("\n")

const tripsTxt = [
  "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id",
  "L22,svc1,22_1,Somewhere,0,L22V1",
  "L22,svc1,22_2,Elsewhere,1,L22V2",
  "L9,svc1,9_1,Anywhere,0,L9V1",
].join("\n")

const stopTimesTxt = [
  "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
  "22_1,10:00:00,10:00:00,U1040Z1,1",
  "9_1,10:05:00,10:05:00,U1040Z2,3",
  "9_1,10:15:00,10:15:00,UNKNOWN,9",
].join("\n")

describe("gtfs join", () => {
  it("indexes gtfs stop ids to ASW nodes", () => {
    const m = indexGtfsStops(parseCsv(stopsTxt))
    expect(m.get("U1040Z1")).toBe(1040)
    expect(m.has("T123")).toBe(false)
  })

  it("parses trips with route/direction/shape", () => {
    const t = parseTrips(tripsTxt)
    expect(t.get("22_1")).toEqual({ routeId: "L22", directionId: "0", shapeId: "L22V1" })
    expect(t.size).toBe(3)
  })

  it("joins stop_times through trips to per-node route sets", () => {
    const stopNode = indexGtfsStops(parseCsv(stopsTxt))
    const routes = nodeRoutes(stopTimesTxt, parseTrips(tripsTxt), stopNode)
    expect([...routes.get(1040)!].sort()).toEqual(["L22", "L9"].sort())
  })

  it("parses route metadata with color fallbacks", () => {
    const routesTxt = [
      "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color",
      "L22,22,Long,0,7A0603,FFFFFF",
      "L9,9,Long,0,,",
    ].join("\n")
    const r = parseRoutes(parseCsv(routesTxt))
    expect(r.get("L22")).toEqual({ shortName: "22", color: "7A0603", textColor: "FFFFFF", type: 0 })
    expect(r.get("L9")!.color).toBe("888888")
  })
})
