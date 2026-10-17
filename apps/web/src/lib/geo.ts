/** Great-circle distance between two WGS-84 points, in metres. */
export const haversineMetres = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const R = 6_371_000
  const toRad = (d: number): number => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Walking pace ≈ 4.8 km/h. */
export const WALK_METRES_PER_MIN = 80
/** Streets aren't straight lines — inflate the crow-flies distance. */
export const DETOUR_FACTOR = 1.3

/**
 * Estimated minutes to walk a straight-line distance. An estimate, surfaced to
 * the user as "min walk" — not a routed time.
 */
export const metresToWalkMinutes = (metres: number): number =>
  Math.max(0, Math.round((metres / WALK_METRES_PER_MIN) * DETOUR_FACTOR))
