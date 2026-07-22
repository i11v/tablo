import maplibregl, {
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
  type Map as MlMap,
  type Marker,
} from "maplibre-gl"
import type {
  RouteInfo,
  ShapeAsset,
  StopIndexEntry,
  StopPlatform,
  VehicleKind,
} from "@app/contract"
import { lerp, lerpAngle } from "../../lib/map/lerp.ts"

/** Fallback marker colors when a route has no GTFS color. */
const KIND_COLOR: Record<VehicleKind, string> = {
  tram: "#c8102e",
  bus: "#1f6fb2",
  metro: "#00A562",
  train: "#6b7280",
  other: "#6b7280",
}

const ANIM_MS = 800
const STALE_MS = 60_000

// ---- shapes (route geometry) ----

const SHAPE_SOURCE = "shapes"
const SHAPE_LAYER = "shapes-line"

type LngLat = [number, number]

// Minimal structural GeoJSON — @types/geojson isn't hoisted here, so we build a
// plain LineString FeatureCollection and cast at the maplibre boundary below.
interface LineFeature {
  readonly type: "Feature"
  readonly geometry: { readonly type: "LineString"; readonly coordinates: ReadonlyArray<LngLat> }
  readonly properties: { readonly color: string }
}
interface ShapeCollection {
  readonly type: "FeatureCollection"
  readonly features: ReadonlyArray<LineFeature>
}

type GeoJSONData = GeoJSONSourceSpecification["data"]

const shapesToFeatureCollection = (shapes: ReadonlyArray<ShapeAsset>): ShapeCollection => ({
  type: "FeatureCollection",
  features: shapes.flatMap((s) =>
    s.coords.map(
      (seg): LineFeature => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: seg as LngLat[] },
        properties: { color: "#" + s.color },
      }),
    ),
  ),
})

/** setData on a single GeoJSON source; create source+layer on first call. */
export const syncShapes = (map: MlMap, shapes: ReadonlyArray<ShapeAsset>): void => {
  const data = shapesToFeatureCollection(shapes) as unknown as GeoJSONData
  const source = map.getSource(SHAPE_SOURCE) as GeoJSONSource | undefined
  if (source === undefined) {
    map.addSource(SHAPE_SOURCE, { type: "geojson", data })
    map.addLayer({
      id: SHAPE_LAYER,
      type: "line",
      source: SHAPE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3,
        "line-opacity": 0.6,
      },
    })
  } else {
    source.setData(data)
  }
}

// ---- vehicles ----

interface Sample {
  lat: number
  lon: number
  bearing: number
}

export interface VehicleMarker {
  readonly marker: Marker
  readonly el: HTMLElement
  from: Sample
  to: Sample
  start: number
}

const vehicleEl = (route: string, bg: string, fg: string): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText = "position:relative;width:0;height:0;"
  const arrow = document.createElement("div")
  arrow.style.cssText =
    "position:absolute;left:-4px;top:-15px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:6px solid " +
    bg +
    ";"
  const badge = document.createElement("div")
  badge.textContent = route
  badge.style.cssText =
    "position:absolute;left:-11px;top:-9px;min-width:22px;height:18px;padding:0 4px;box-sizing:border-box;" +
    "display:flex;align-items:center;justify-content:center;border-radius:5px;" +
    "font:700 11px/1 ui-sans-serif,system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.5);" +
    "background:" +
    bg +
    ";color:" +
    fg +
    ";"
  el.append(arrow, badge)
  return el
}

const currentSample = (m: VehicleMarker, now: number): Sample => {
  const t = Math.min(1, (now - m.start) / ANIM_MS)
  return {
    lat: lerp(m.from.lat, m.to.lat, t),
    lon: lerp(m.from.lon, m.to.lon, t),
    bearing: lerpAngle(m.from.bearing, m.to.bearing, t),
  }
}

export interface VehicleInput {
  readonly id: string
  readonly route: string
  readonly routeId: string
  readonly kind: VehicleKind
  readonly lat: number
  readonly lon: number
  readonly bearing: number | null
  readonly timestamp: string
}

/** Reconcile DOM markers with the incoming vehicle list; animate on next frames. */
export const syncVehicles = (
  map: MlMap,
  vehicles: ReadonlyArray<VehicleInput>,
  markers: Map<string, VehicleMarker>,
  routesTbl: ReadonlyMap<string, RouteInfo> | null,
  now: number,
): void => {
  const seen = new Set<string>()
  for (const v of vehicles) {
    seen.add(v.id)
    const to: Sample = { lat: v.lat, lon: v.lon, bearing: v.bearing ?? 0 }
    const stale = now - Date.parse(v.timestamp) > STALE_MS
    const existing = markers.get(v.id)
    if (existing === undefined) {
      const info = routesTbl?.get(v.routeId)
      const bg = info && info.color !== "" ? "#" + info.color : KIND_COLOR[v.kind]
      const fg = info && info.textColor !== "" ? "#" + info.textColor : "#ffffff"
      const el = vehicleEl(v.route, bg, fg)
      el.style.opacity = stale ? "0.4" : "1"
      const marker = new maplibregl.Marker({ element: el, rotationAlignment: "map" })
        .setLngLat([v.lon, v.lat])
        .setRotation(to.bearing)
        .addTo(map)
      markers.set(v.id, { marker, el, from: to, to, start: now })
    } else {
      existing.from = currentSample(existing, now)
      existing.to = to
      existing.start = now
      existing.el.style.opacity = stale ? "0.4" : "1"
    }
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) {
      m.marker.remove()
      markers.delete(id)
    }
  }
}

/** Advance every vehicle marker toward its target; call from a shared rAF loop. */
export const animateVehicles = (markers: Map<string, VehicleMarker>, now: number): void => {
  for (const m of markers.values()) {
    const s = currentSample(m, now)
    m.marker.setLngLat([s.lon, s.lat])
    m.marker.setRotation(s.bearing)
  }
}

// ---- generic keyed DOM-marker reconciler (platforms, stop dots) ----

const reconcile = <T>(
  map: MlMap,
  items: ReadonlyArray<T>,
  markers: Map<string, Marker>,
  keyOf: (item: T) => string,
  make: (item: T) => Marker,
): void => {
  const seen = new Set<string>()
  for (const item of items) {
    const key = keyOf(item)
    seen.add(key)
    if (!markers.has(key)) markers.set(key, make(item).addTo(map))
  }
  for (const [key, marker] of markers) {
    if (!seen.has(key)) {
      marker.remove()
      markers.delete(key)
    }
  }
}

const platformEl = (code: string): HTMLElement => {
  const el = document.createElement("div")
  el.textContent = code
  el.style.cssText =
    "cursor:pointer;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;" +
    "display:flex;align-items:center;justify-content:center;border-radius:4px;" +
    "font:700 10px/1 ui-sans-serif,system-ui,sans-serif;color:#0a0a0a;background:#e9e7e0;" +
    "box-shadow:0 1px 3px rgba(0,0,0,0.55);"
  return el
}

/** One small labeled marker per platform of the focused entry. */
export const syncPlatforms = (
  map: MlMap,
  entry: StopIndexEntry | null,
  onTap: (platform: StopPlatform) => void,
  markers: Map<string, Marker>,
): void => {
  const plats = entry?.platforms ?? []
  reconcile(
    map,
    plats,
    markers,
    (p) => p.code + "@" + p.stop,
    (p) => {
      const el = platformEl(p.code)
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        onTap(p)
      })
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat])
    },
  )
}

const dotEl = (): HTMLElement => {
  const el = document.createElement("div")
  el.style.cssText =
    "cursor:pointer;width:9px;height:9px;border-radius:50%;background:#e9e7e0;" +
    "border:1.5px solid #0a0a0a;box-shadow:0 0 4px rgba(0,0,0,0.5);"
  return el
}

/** Tiny circle markers for the overview state (viewport-filtered by caller). */
export const syncStopDots = (
  map: MlMap,
  entries: ReadonlyArray<StopIndexEntry>,
  onTap: (entry: StopIndexEntry) => void,
  markers: Map<string, Marker>,
): void => {
  reconcile(
    map,
    entries,
    markers,
    (e) => String(e.node),
    (e) => {
      const el = dotEl()
      el.addEventListener("click", (ev) => {
        ev.stopPropagation()
        onTap(e)
      })
      return new maplibregl.Marker({ element: el }).setLngLat([e.lon, e.lat])
    },
  )
}

/** Metres-radius bounds around a point, as [[west,south],[east,north]]. */
export const boundsAround = (
  lat: number,
  lon: number,
  metres: number,
): [[number, number], [number, number]] => {
  const dLat = metres / 111_320
  const dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ]
}
