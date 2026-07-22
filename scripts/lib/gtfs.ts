/**
 * Joins over the GTFS feed for the map view: which routes serve which ASW
 * node, and per-route display metadata. stops.txt/routes.txt go through the
 * real CSV parser; trips.txt and stop_times.txt are tens of MB and their
 * fields (ids, times, sequence numbers) are never quoted in PID's feed, so
 * those use a plain line/comma split.
 */

/** gtfs stop_id -> asw_node_id, platform rows only (location_type 0 + ASW). */
export const indexGtfsStops = (rows: string[][]): Map<string, number> => {
  const [header, ...data] = rows
  const col = new Map(header.map((name, i) => [name, i]))
  const iId = col.get("stop_id")!
  const iLoc = col.get("location_type")!
  const iNode = col.get("asw_node_id")!
  const out = new Map<string, number>()
  for (const r of data) {
    if (r.length < header.length || r[iLoc] !== "0" || r[iNode] === "") continue
    out.set(r[iId], Number(r[iNode]))
  }
  return out
}

const cols = (header: string): Map<string, number> =>
  new Map(header.split(",").map((name, i) => [name.trim(), i]))

export interface TripInfo {
  routeId: string
  directionId: string
  shapeId: string
}

export const parseTrips = (text: string): Map<string, TripInfo> => {
  const nl = text.indexOf("\n")
  const c = cols(text.slice(0, nl))
  const iTrip = c.get("trip_id")!
  const iRoute = c.get("route_id")!
  const iDir = c.get("direction_id")!
  const iShape = c.get("shape_id")!
  const out = new Map<string, TripInfo>()
  for (const line of text.slice(nl + 1).split("\n")) {
    if (line === "" || line === "\r") continue
    const f = line.split(",")
    out.set(f[iTrip], {
      routeId: f[iRoute],
      directionId: f[iDir],
      shapeId: f[iShape]?.trim() ?? "",
    })
  }
  return out
}

/** stop_times -> trips -> routes: the set of route ids serving each node. */
export const nodeRoutes = (
  stopTimesText: string,
  trips: Map<string, { routeId: string }>,
  stopNode: Map<string, number>,
): Map<number, Set<string>> => {
  const nl = stopTimesText.indexOf("\n")
  const c = cols(stopTimesText.slice(0, nl))
  const iTrip = c.get("trip_id")!
  const iStop = c.get("stop_id")!
  const out = new Map<number, Set<string>>()
  for (const line of stopTimesText.slice(nl + 1).split("\n")) {
    if (line === "" || line === "\r") continue
    const f = line.split(",")
    const node = stopNode.get(f[iStop])
    if (node === undefined) continue
    const trip = trips.get(f[iTrip])
    if (trip === undefined) continue
    let set = out.get(node)
    if (set === undefined) {
      set = new Set()
      out.set(node, set)
    }
    set.add(trip.routeId)
  }
  return out
}

const FALLBACK_COLOR = "888888"

export interface RouteMeta {
  shortName: string
  color: string
  textColor: string
  type: number
}

export const parseRoutes = (rows: string[][]): Map<string, RouteMeta> => {
  const [header, ...data] = rows
  const col = new Map(header.map((name, i) => [name, i]))
  const iId = col.get("route_id")!
  const iShort = col.get("route_short_name")!
  const iType = col.get("route_type")!
  const iColor = col.get("route_color")!
  const iText = col.get("route_text_color")!
  const out = new Map<string, RouteMeta>()
  for (const r of data) {
    if (r.length < header.length) continue
    out.set(r[iId], {
      shortName: r[iShort],
      color: r[iColor] !== "" ? r[iColor] : FALLBACK_COLOR,
      textColor: r[iText] !== "" ? r[iText] : "FFFFFF",
      type: Number(r[iType]),
    })
  }
  return out
}
