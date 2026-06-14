import { fold, type StopIndexEntry, type StopIndexV1 } from "@app/contract"
import type { VehicleKind } from "@app/contract"

/**
 * stops.txt rows -> StopIndexV1.
 * Groups platforms by (asw_node_id, stop_name): single-name nodes become one
 * whole-node entry (stops: null); multi-name nodes get one platform-scoped
 * entry per name. ASW-less rows (rail/technical waypoints) and non-platform
 * location_types are excluded.
 */
export const buildIndex = (rows: string[][], generatedAt: string): StopIndexV1 => {
  const [header, ...data] = rows
  const col = new Map(header.map((name, i) => [name, i]))
  const need = (name: string): number => {
    const i = col.get(name)
    if (i === undefined) throw new Error("stops.txt is missing column " + name)
    return i
  }
  const iName = need("stop_name")
  const iLat = need("stop_lat")
  const iLon = need("stop_lon")
  const iZone = need("zone_id")
  const iLoc = need("location_type")
  const iNode = need("asw_node_id")
  const iStop = need("asw_stop_id")
  const iPlat = need("platform_code")

  interface Group {
    name: string
    node: number
    stops: Set<number>
    lats: number[]
    lons: number[]
    zones: string[]
    plats: Map<number, string> // asw_stop_id -> trimmed platform_code
    coords: Map<number, { lat: number; lon: number }> // asw_stop_id -> its own coords
  }
  const groups = new Map<string, Group>()
  const namesPerNode = new Map<number, Set<string>>()

  for (const r of data) {
    if (r.length < header.length) continue
    if (r[iLoc] !== "0" || r[iNode] === "") continue
    const node = Number(r[iNode])
    const name = r[iName]
    const key = node + "|" + name
    let g = groups.get(key)
    if (g === undefined) {
      g = { name, node, stops: new Set(), lats: [], lons: [], zones: [], plats: new Map(), coords: new Map() }
      groups.set(key, g)
    }
    if (r[iStop] !== "") {
      const stop = Number(r[iStop])
      g.stops.add(stop)
      g.plats.set(stop, r[iPlat].trim())
      g.coords.set(stop, { lat: Number(r[iLat]), lon: Number(r[iLon]) })
    }
    g.lats.push(Number(r[iLat]))
    g.lons.push(Number(r[iLon]))
    if (r[iZone] !== "") g.zones.push(r[iZone])
    let names = namesPerNode.get(node)
    if (names === undefined) {
      names = new Set()
      namesPerNode.set(node, names)
    }
    names.add(name)
  }

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
  const mode = (xs: string[]): string | null => {
    if (xs.length === 0) return null
    const counts = new Map<string, number>()
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  // Mutable local shape: StopIndexEntry has readonly fields from Schema, so we
  // assign disambig on this interface and map to StopIndexEntry at the end.
  interface MutableEntry {
    name: string
    norm: string
    node: number
    stops: number[] | null
    lat: number
    lon: number
    zone: string | null
    modes: VehicleKind[]
    disambig: string | null
    platforms: { code: string; stop: number; lat: number; lon: number }[]
  }

  const entries: MutableEntry[] = [...groups.values()].map((g) => ({
    name: g.name,
    norm: fold(g.name),
    node: g.node,
    stops: namesPerNode.get(g.node)!.size > 1 ? [...g.stops].sort((a, b) => a - b) : null,
    lat: Number(mean(g.lats).toFixed(5)),
    lon: Number(mean(g.lons).toFixed(5)),
    zone: mode(g.zones),
    modes: [],
    disambig: null,
    platforms: [...g.plats.entries()]
      .filter(([, code]) => code !== "")
      .map(([stop, code]) => {
        const c = g.coords.get(stop)!
        return { code, stop, lat: Number(c.lat.toFixed(5)), lon: Number(c.lon.toFixed(5)) }
      })
      .sort((a, b) => a.code.localeCompare(b.code)),
  }))

  // disambiguate identical folded names across different nodes (zone is enough for v1)
  const byNorm = new Map<string, MutableEntry[]>()
  for (const e of entries) {
    const list = byNorm.get(e.norm) ?? []
    list.push(e)
    byNorm.set(e.norm, list)
  }
  for (const list of byNorm.values()) {
    if (new Set(list.map((e) => e.node)).size > 1) {
      for (const e of list) e.disambig = e.zone ?? "node " + e.node
    }
  }

  entries.sort((a, b) => a.norm.localeCompare(b.norm) || a.node - b.node)
  const stops: StopIndexEntry[] = entries
  return { version: 1 as const, generatedAt, stops }
}
