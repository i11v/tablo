import type { Departure, StopBoard, VehicleKind } from "@app/contract"

/** View-model a board row renders from — the shape the design components want. */
export interface DepartureVM {
  readonly route: string
  readonly kind: VehicleKind
  readonly headsign: string
  readonly platform: string | null
  readonly inMinutes: number
  readonly atStop: boolean
  readonly delayMinutes: number // signed minutes vs schedule; 0 = on time
  readonly sortKey: number // epoch ms of predicted ?? scheduled
}

const GONE_MS = 30_000

/** Adapt one real Departure to a row VM, or drop it (canceled / already gone). */
export const departureVM = (dep: Departure, nowMs: number): DepartureVM | null => {
  if (dep.isCanceled) return null
  const t = Date.parse(dep.predicted ?? dep.scheduled)
  const diff = t - nowMs
  if (diff < -GONE_MS) return null
  return {
    route: dep.route,
    kind: dep.kind,
    headsign: dep.headsign,
    platform: dep.platform,
    inMinutes: Math.max(0, Math.round(diff / 60_000)),
    atStop: dep.isAtStop,
    delayMinutes: dep.delaySeconds === null ? 0 : Math.round(dep.delaySeconds / 60),
    sortKey: t,
  }
}

/** Map → drop → sort ascending. Order matters: lead = first non-miss. */
export const boardToDepartures = (
  board: StopBoard,
  nowMs: number,
): ReadonlyArray<DepartureVM> =>
  board.departures
    .map((d) => departureVM(d, nowMs))
    .filter((d): d is DepartureVM => d !== null)
    .sort((a, b) => a.sortKey - b.sortKey)
