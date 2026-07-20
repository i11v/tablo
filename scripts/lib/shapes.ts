import type { TripInfo } from "./gtfs.ts"

/**
 * One representative shape per (route, direction): the shape id used by the
 * most trips. Returns shapeId -> routeId for the shapes worth extracting.
 */
export const pickShapeIds = (trips: Map<string, TripInfo>): Map<string, string> => {
  const counts = new Map<string, Map<string, number>>() // routeId|dir -> shapeId -> n
  for (const t of trips.values()) {
    if (t.shapeId === "") continue
    const key = t.routeId + "|" + t.directionId
    let m = counts.get(key)
    if (m === undefined) {
      m = new Map()
      counts.set(key, m)
    }
    m.set(t.shapeId, (m.get(t.shapeId) ?? 0) + 1)
  }
  const out = new Map<string, string>()
  for (const [key, m] of counts) {
    const routeId = key.slice(0, key.indexOf("|"))
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
    out.set(best, routeId)
  }
  return out
}

/** shapes.txt is unquoted — line-split parse, same rationale as stop_times. */
export const collectShapes = (
  text: string,
  wanted: Map<string, string>,
): Map<string, Array<[number, number]>> => {
  const nl = text.indexOf("\n")
  const header = text
    .slice(0, nl)
    .split(",")
    .map((s) => s.trim())
  const iId = header.indexOf("shape_id")
  const iLat = header.indexOf("shape_pt_lat")
  const iLon = header.indexOf("shape_pt_lon")
  const iSeq = header.indexOf("shape_pt_sequence")
  const acc = new Map<string, Array<[number, [number, number]]>>()
  for (const line of text.slice(nl + 1).split("\n")) {
    if (line === "" || line === "\r") continue
    const f = line.split(",")
    if (!wanted.has(f[iId])) continue
    let list = acc.get(f[iId])
    if (list === undefined) {
      list = []
      acc.set(f[iId], list)
    }
    list.push([Number(f[iSeq]), [Number(f[iLon]), Number(f[iLat])]])
  }
  const out = new Map<string, Array<[number, number]>>()
  for (const [id, list] of acc) {
    out.set(
      id,
      list.sort((a, b) => a[0] - b[0]).map(([, p]) => p),
    )
  }
  return out
}
