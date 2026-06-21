import type { StopPlatform, VehicleKind } from "@app/contract"
import type { DepartureVM } from "./departureVM.ts"

/**
 * A platform from the stop index, enriched with the next vehicle leaving from it
 * when a live board is available. The platform set comes from the index, so it's
 * stable regardless of what's currently on the board — a stop with eight
 * platforms always lists eight, even if only three have a departure right now.
 */
export interface PlatformPick {
  readonly code: string
  readonly stop: number
  /** The soonest departure from this platform, when a live board has arrived. */
  readonly lead?: DepartureVM
  readonly kind?: VehicleKind
}

/**
 * Join index platforms with an optional live board: each platform gets the
 * soonest vehicle leaving from it. Index order (by code) is preserved.
 *
 * The departure join is by raw `platform === code` — NOT `platformKey`, which
 * collapses metro to one "Metro" key and would never match the index's per-line
 * metro codes ("1"/"2"). Departures arrive sorted ascending (boardToDepartures),
 * so the first match is the soonest from that platform.
 */
export const buildPlatformPicks = (
  platforms: ReadonlyArray<StopPlatform>,
  departures?: ReadonlyArray<DepartureVM>,
): Array<PlatformPick> =>
  platforms.map((p) => {
    const lead = departures?.find((d) => d.platform === p.code)
    return lead === undefined
      ? { code: p.code, stop: p.stop }
      : { code: p.code, stop: p.stop, lead, kind: lead.kind }
  })
