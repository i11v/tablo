import L from "leaflet"
import { useEffect, useRef } from "react"
import type { PlatformPick } from "../lib/platforms.ts"
import type { Origin } from "../lib/ranker.ts"
import "leaflet/dist/leaflet.css"

/**
 * Dark, static Leaflet map: one tappable pin per platform, a "you" marker, and a
 * dashed line to the selected pin. Default-exported so it can be `React.lazy`'d —
 * Leaflet's JS + CSS land in a separate chunk loaded only when a picker opens.
 *
 * Pins are `divIcon`s (HTML styled with theme tokens), so there's no dependency
 * on Leaflet's default marker PNGs (which break under bundlers). The map itself
 * is created once; only pin styling and the dashed line react to selection, and
 * markers are rebuilt only when the platform geometry actually changes — never on
 * a per-second countdown tick.
 */
export default function RealMap({
  picks,
  sel,
  onSelect,
  origin,
  center,
}: {
  picks: ReadonlyArray<PlatformPick>
  sel: string | null
  onSelect: (code: string) => void
  origin: Origin | null
  center: { lat: number; lon: number }
}) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef(new Map<string, L.Marker>())
  const lineRef = useRef<L.Polyline | null>(null)
  // Latest props for handlers/effects that shouldn't re-subscribe on every change.
  const picksRef = useRef(picks)
  picksRef.current = picks
  const selRef = useRef(sel)
  selRef.current = sel
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Map lifecycle — created once.
  useEffect(() => {
    const el = elRef.current
    if (el === null) return
    const map = L.map(el, {
      dragging: false,
      zoomControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: false,
    })
    map.setView([center.lat, center.lon], 16)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
      detectRetina: true,
    }).addTo(map)
    mapRef.current = map

    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      lineRef.current = null
    }
    // center is only a seed for the initial view; bounds are fit by the markers
    // effect. Re-running on center changes would fight that fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // (Re)build pins + the "you" marker, and fit bounds — only when the platform
  // geometry or the origin changes (not on countdown ticks).
  const geoKey =
    picks.map((p) => `${p.code}:${p.lat},${p.lon}`).join("|") +
    (origin ? `#${origin.lat},${origin.lon}` : "")
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return
    for (const m of markersRef.current.values()) m.remove()
    markersRef.current.clear()

    const cur = picksRef.current
    for (const p of cur) {
      const marker = L.marker([p.lat, p.lon], {
        icon: platformIcon(p.code, p.code === selRef.current),
        keyboard: false,
      })
      marker.on("click", () => onSelectRef.current(p.code))
      marker.addTo(map)
      markersRef.current.set(p.code, marker)
    }

    const pts: Array<[number, number]> = cur.map((p) => [p.lat, p.lon])
    if (origin !== null) {
      L.marker([origin.lat, origin.lon], { icon: youIcon(), keyboard: false, interactive: false }).addTo(map)
      pts.push([origin.lat, origin.lon])
    }
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts), { padding: [34, 34], maxZoom: 17 })
    } else if (pts.length === 1) {
      map.setView(pts[0], 16)
    }
    drawLine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey])

  // Restyle pins + redraw the dashed line on selection change.
  useEffect(() => {
    for (const [code, m] of markersRef.current) m.setIcon(platformIcon(code, code === sel))
    drawLine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  function drawLine(): void {
    const map = mapRef.current
    if (map === null) return
    if (lineRef.current !== null) {
      lineRef.current.remove()
      lineRef.current = null
    }
    const s = selRef.current
    const target = s === null ? undefined : picksRef.current.find((p) => p.code === s)
    if (origin === null || target === undefined) return
    lineRef.current = L.polyline(
      [
        [origin.lat, origin.lon],
        [target.lat, target.lon],
      ],
      { color: "#e9e7e0", weight: 1.5, opacity: 0.45, dashArray: "4 5" },
    ).addTo(map)
  }

  return <div ref={elRef} className="h-full w-full" />
}

const platformIcon = (code: string, active: boolean): L.DivIcon =>
  L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="
      width:28px;height:28px;border-radius:9px;
      display:flex;align-items:center;justify-content:center;
      font-family:var(--font-ui);font-weight:800;font-size:13px;line-height:1;
      box-shadow:0 1px 4px rgba(0,0,0,.55);
      ${
        active
          ? "background:var(--color-paper);color:var(--color-paper-ink);border:1px solid var(--color-paper);"
          : "background:var(--color-ctl);color:var(--color-chip-muted);border:1px solid rgba(255,255,255,.16);"
      }
    ">${code}</div>`,
  })

const youIcon = (): L.DivIcon =>
  L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      background:var(--color-make);border:2px solid var(--color-bg);
      box-shadow:0 0 8px color-mix(in srgb, var(--color-make) 60%, transparent);
    "></div>`,
  })
