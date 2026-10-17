import { haversineMetres } from "./geo.ts"
import type { Candidate } from "./matcher.ts"

/** A device location to rank against; null when no fix is available. */
export interface Origin {
  readonly lat: number
  readonly lon: number
}

/** Peak boost for a stop right at the user's feet. */
const PROXIMITY_MAX_BOOST = 30
/** Characteristic distance (m) over which the boost falls off ~e-fold. */
const PROXIMITY_SCALE_METRES = 1000

/**
 * Closer stops score higher; the boost decays smoothly with distance so it
 * orders stops within a text-relevance tier without overruling a clearly
 * better textual match (peak 30 < the 40-point exact-vs-substring gap).
 */
const proximityBoost = (entry: Candidate["entry"], origin: Origin | null): number => {
  if (origin === null) return 0
  const metres = haversineMetres(origin.lat, origin.lon, entry.lat, entry.lon)
  return PROXIMITY_MAX_BOOST * Math.exp(-metres / PROXIMITY_SCALE_METRES)
}

/**
 * Composable scorer pipeline (spec §5.5): text relevance + recents boost +
 * geo-proximity. Proximity is active only when an origin is known; the matcher
 * and index stay untouched.
 */
export const rank = (
  candidates: ReadonlyArray<Candidate>,
  recentNodes: ReadonlyArray<string>,
  origin: Origin | null = null,
): Array<Candidate> =>
  [...candidates]
    .map((c) => ({
      ...c,
      score:
        c.score +
        (recentNodes.includes(String(c.entry.node)) ? 25 : 0) +
        proximityBoost(c.entry, origin),
    }))
    .sort((a, b) => b.score - a.score)
