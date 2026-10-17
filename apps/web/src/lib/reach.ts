import type { Tier } from "./tier.ts"

/**
 * Reachability: compare how long the vehicle is away (inMinutes) against how
 * long it takes YOU to walk to the stop (walkMinutes).
 *
 *   margin = inMinutes − walkMinutes
 *     margin < 0  → "miss"  you can't get there in time
 *     0..2        → "run"   tight — you'll need to hurry
 *     >= 2        → "make"  comfortable
 *
 * walkMinutes === null (location off/locating) → "neutral": the board stays
 * fully usable, just without urgency coloring.
 */
export const reachTier = (inMinutes: number, walkMinutes: number | null): Tier => {
  if (walkMinutes === null) return "neutral"
  const margin = inMinutes - walkMinutes
  if (margin < 0) return "miss"
  if (margin < 2) return "run"
  return "make"
}
