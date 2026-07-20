import type { StopIndexEntry } from "@app/contract"
import { haversineMetres } from "../geo.ts"

/** Nearest stop index entry to (lat, lon) by crow-flies distance; null for an empty index. */
export const closestEntry = (
  stops: ReadonlyArray<StopIndexEntry>,
  lat: number,
  lon: number,
): StopIndexEntry | null => {
  let best: StopIndexEntry | null = null
  let bestDist = Infinity
  for (const s of stops) {
    const d = haversineMetres(lat, lon, s.lat, s.lon)
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return best
}
