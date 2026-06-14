import type { StopPlatform, VehicleKind } from "@app/contract"
import type { DepartureVM } from "./departureVM.ts"
import { haversineMetres, metresToWalkMinutes } from "./geo.ts"
import type { Origin } from "./ranker.ts"
import { reachTier } from "./reach.ts"

/**
 * A platform from the stop index, enriched with the user's walk time and (when a
 * live board is available) the next vehicle leaving from it. Geo comes from the
 * index, so a card narrowed to one platform can still re-open the picker and
 * switch — the canonical platform set never depends on what's currently on the
 * board.
 */
export interface PlatformPick {
  readonly code: string
  readonly stop: number
  readonly lat: number
  readonly lon: number
  readonly walkMinutes: number | null
  readonly lead?: DepartureVM
  readonly kind?: VehicleKind
}

/**
 * Join index platforms with an optional live board, sorted by walk time (nearest
 * first, then code). The departure join is by raw `platform === code` — NOT
 * `platformKey`, which collapses metro to one "Metro" key and would never match
 * the index's per-line metro codes ("1"/"2").
 */
export const buildPlatformPicks = (
  platforms: ReadonlyArray<StopPlatform>,
  origin: Origin | null,
  departures?: ReadonlyArray<DepartureVM>,
): Array<PlatformPick> =>
  [...platforms]
    .map((p): PlatformPick => {
      const walkMinutes =
        origin === null
          ? null
          : metresToWalkMinutes(haversineMetres(origin.lat, origin.lon, p.lat, p.lon))
      // departures arrive sorted ascending (boardToDepartures), so the first
      // non-miss is the soonest catchable vehicle; fall back to the soonest.
      const here = departures?.filter((d) => d.platform === p.code) ?? []
      const lead = here.find((d) => reachTier(d.inMinutes, walkMinutes) !== "miss") ?? here[0]
      return lead === undefined
        ? { code: p.code, stop: p.stop, lat: p.lat, lon: p.lon, walkMinutes }
        : { code: p.code, stop: p.stop, lat: p.lat, lon: p.lon, walkMinutes, lead, kind: lead.kind }
    })
    .sort(
      (a, b) =>
        (a.walkMinutes ?? Infinity) - (b.walkMinutes ?? Infinity) || a.code.localeCompare(b.code),
    )
