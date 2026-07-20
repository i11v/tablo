import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useSelector } from "@tanstack/react-store"
import maplibregl, { type Marker } from "maplibre-gl"
import {
  MAX_VEHICLE_ROUTES,
  type RouteInfo,
  routeTypeToKind,
  selectorKey,
  type StopIndexEntry,
  type StopPlatform,
  type StopSelector,
  type VehicleKind,
} from "@app/contract"
import { useDepartures } from "../../hooks/useDepartures.ts"
import { useRoutesTable, useShapes } from "../../hooks/useRouteAssets.ts"
import { useStopIndex } from "../../hooks/useStopIndex.ts"
import { closestEntry } from "../../lib/map/closest.ts"
import { shareSearch } from "../../lib/url.ts"
import { geoStore, mapKindsStore, toggleMapKind } from "../../store.ts"
import { FilterChips } from "./FilterChips.tsx"
import {
  animateVehicles,
  boundsAround,
  syncPlatforms,
  syncShapes,
  syncStopDots,
  syncVehicles,
  type VehicleInput,
  type VehicleMarker,
} from "./layers.ts"
import { PlatformSheet } from "./PlatformSheet.tsx"

const OVERVIEW_CENTER: [number, number] = [14.42, 50.087]
const DOT_MIN_ZOOM = 13
const MAX_DOTS = 400

const EMPTY_ENTRIES: ReadonlyArray<StopIndexEntry> = []

// `other`-kind vehicles ride the `bus` chip (no chip of their own).
const chipKind = (k: VehicleKind): VehicleKind => (k === "other" ? "bus" : k)

const toVehicleInput = (v: {
  id: string
  route: string
  routeId: string
  kind: VehicleKind
  lat: number
  lon: number
  bearing: number | null
  timestamp: string
}): VehicleInput => ({
  id: v.id,
  route: v.route,
  routeId: v.routeId,
  kind: v.kind,
  lat: v.lat,
  lon: v.lon,
  bearing: v.bearing,
  timestamp: v.timestamp,
})

export function MapScreen() {
  const index = useStopIndex()
  const geo = useSelector(geoStore)
  const kinds = useSelector(mapKindsStore)
  const routesTbl = useRoutesTable()

  const stops = index._tag === "ready" ? index.stops : EMPTY_ENTRIES

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [loaded, setLoaded] = useState(false)
  const userPannedRef = useRef(false)

  const [focus, setFocus] = useState<StopIndexEntry | null>(null)
  const [sheet, setSheet] = useState<{ platform: StopPlatform; entry: StopIndexEntry } | null>(null)
  const [overviewEntries, setOverviewEntries] =
    useState<ReadonlyArray<StopIndexEntry>>(EMPTY_ENTRIES)

  // Marker bookkeeping — owned here, passed into the (stateless) layer helpers.
  const vehicleMarkers = useRef<Map<string, VehicleMarker>>(new Map())
  const platformMarkers = useRef<Map<string, Marker>>(new Map())
  const dotMarkers = useRef<Map<string, Marker>>(new Map())

  // Refs so the map's native event handlers read current state without re-binding.
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const focusRef = useRef(focus)
  focusRef.current = focus

  // ---- derived: which routes/vehicles/shapes the focused stop contributes ----
  const focusRoutes = useMemo<ReadonlyArray<RouteInfo>>(() => {
    if (focus === null || routesTbl === null) return []
    return focus.routes.flatMap((id) => {
      const r = routesTbl.get(id)
      return r === undefined ? [] : [r]
    })
  }, [focus, routesTbl])

  const visibleRoutes = useMemo(
    () => focusRoutes.filter((r) => kinds.has(chipKind(routeTypeToKind(r.type)))),
    [focusRoutes, kinds],
  )

  const vehicleRouteIds = useMemo(
    () => visibleRoutes.map((r) => r.id).slice(0, MAX_VEHICLE_ROUTES),
    [visibleRoutes],
  )

  const shapes = useShapes(visibleRoutes)
  const shapeSig = shapes.map((s) => s.routeId).join(",")
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes

  const selectors = useMemo<ReadonlyArray<StopSelector>>(
    () => (sheet ? [{ node: sheet.entry.node, stops: [sheet.platform.stop] }] : []),
    [sheet],
  )
  const feed = useDepartures(selectors, vehicleRouteIds)

  // ---- create the map once ----
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const map = new maplibregl.Map({
      container,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: OVERVIEW_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.on("load", () => setLoaded(true))
    map.on("dragstart", () => {
      userPannedRef.current = true
    })
    const recompute = (): void => {
      if (map.getZoom() < DOT_MIN_ZOOM) {
        setOverviewEntries(EMPTY_ENTRIES)
        return
      }
      const b = map.getBounds()
      const within = stopsRef.current.filter((e) => b.contains([e.lon, e.lat]))
      setOverviewEntries(within.slice(0, MAX_DOTS))
    }
    map.on("moveend", recompute)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- auto-focus the closest stop while geo is live and the user hasn't panned ----
  useEffect(() => {
    if (geo.tag !== "active" || stops.length === 0 || userPannedRef.current) return
    const closest = closestEntry(stops, geo.lat, geo.lon)
    if (closest !== null && closest.node !== focus?.node) setFocus(closest)
  }, [geo, stops, focus])

  // ---- fit the camera to the focused stop ----
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !loaded || focus === null) return
    map.fitBounds(boundsAround(focus.lat, focus.lon, 700), { padding: 48 })
  }, [focus, loaded])

  // ---- sync route geometry (empty in overview: no focus -> no visibleRoutes) ----
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !loaded) return
    syncShapes(map, shapesRef.current)
  }, [loaded, shapeSig])

  // ---- sync live vehicles on each feed tick ----
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !loaded) return
    syncVehicles(
      map,
      feed.vehicles.map(toVehicleInput),
      vehicleMarkers.current,
      routesTbl,
      Date.now(),
    )
  }, [feed.vehicles, loaded, routesTbl])

  // ---- one shared rAF loop animating all vehicle markers ----
  useEffect(() => {
    if (!loaded) return
    let raf = 0
    const tick = (): void => {
      animateVehicles(vehicleMarkers.current, Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loaded])

  // ---- platform markers for the focused stop ----
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !loaded) return
    syncPlatforms(
      map,
      focus,
      (platform) => {
        if (focusRef.current !== null) setSheet({ platform, entry: focusRef.current })
      },
      platformMarkers.current,
    )
  }, [focus, loaded])

  // ---- stop dots for the overview state ----
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !loaded) return
    syncStopDots(
      map,
      focus === null ? overviewEntries : EMPTY_ENTRIES,
      setFocus,
      dotMarkers.current,
    )
  }, [focus, loaded, overviewEntries])

  const recenter = (): void => {
    userPannedRef.current = false
    const map = mapRef.current
    if (geo.tag !== "active" || map === null) return
    const closest = closestEntry(stops, geo.lat, geo.lon)
    if (closest === null) return
    setFocus(closest)
    map.fitBounds(boundsAround(closest.lat, closest.lon, 700), { padding: 48 })
  }

  const board = sheet ? feed.boards.get(selectorKey(selectors[0]!)) : undefined

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      <FilterChips kinds={kinds} onToggle={toggleMapKind} />

      <Link
        to="/"
        search={shareSearch()}
        aria-label="Back to board"
        className="absolute left-[12px] top-[12px] z-10 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-edge bg-card/90 font-accent text-[18px] font-bold text-ink shadow-lg backdrop-blur"
      >
        ←
      </Link>

      <button
        type="button"
        onClick={recenter}
        aria-label="Recenter"
        className="absolute bottom-[16px] right-[16px] z-10 flex h-[42px] w-[42px] items-center justify-center rounded-full border border-edge bg-card/90 text-[18px] text-ink shadow-lg backdrop-blur"
      >
        ⌖
      </button>

      {focus === null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[80px] z-10 flex justify-center px-[16px]">
          <span className="rounded-[10px] border border-edge bg-card/90 px-[14px] py-[8px] text-center font-ui text-[13px] font-medium text-meta shadow-lg backdrop-blur">
            find your stop — tap a stop dot
          </span>
        </div>
      )}

      {feed.status !== "live" && (
        <div className="pointer-events-none absolute inset-x-0 top-[58px] z-10 flex justify-center px-[16px]">
          <span className="rounded-[8px] border border-edge bg-card/90 px-[12px] py-[6px] font-ui text-[12px] font-medium text-run shadow-lg backdrop-blur">
            live feed degraded — showing last known positions
          </span>
        </div>
      )}

      {sheet && (
        <PlatformSheet
          entry={sheet.entry}
          platform={sheet.platform}
          board={board}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
