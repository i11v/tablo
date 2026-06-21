import type { Departure, StopBoard, StopSelector, VehicleKind } from "@app/contract"
import { selectorKey } from "@app/contract"
import type { PidBoardResponse, PidDeparture } from "./schema.ts"

export const routeTypeToKind = (type: number | null): VehicleKind => {
  switch (type) {
    case 0:
      return "tram"
    case 1:
      return "metro"
    case 2:
      return "train"
    case 3:
    case 11:
      return "bus"
    default:
      return "other"
  }
}

const toDeparture = (d: PidDeparture): Departure | null => {
  const scheduled = d.departure_timestamp.scheduled ?? d.departure_timestamp.predicted
  if (scheduled === null) return null
  // Validate every timestamp we ship, not just the effective one — an
  // unparseable string NaNs the sort comparator (here and in the web client)
  // and scrambles board ordering. A garbage scheduled drops the row; a
  // garbage predicted degrades to schedule-only.
  if (!Number.isFinite(Date.parse(scheduled))) return null
  const predicted =
    d.departure_timestamp.predicted !== null &&
    Number.isFinite(Date.parse(d.departure_timestamp.predicted))
      ? d.departure_timestamp.predicted
      : null
  const delaySeconds = d.delay.is_available
    ? (d.delay.seconds ?? (d.delay.minutes === null ? null : d.delay.minutes * 60))
    : null
  return {
    route: d.route.short_name ?? "?",
    kind: routeTypeToKind(d.route.type),
    headsign: d.trip.headsign,
    scheduled,
    predicted,
    delaySeconds,
    isCanceled: d.trip.is_canceled,
    isAtStop: d.trip.is_at_stop,
    platform: d.stop.platform_code,
  }
}

const matches = (sel: StopSelector, asw: { node: number; stop: number }): boolean =>
  asw.node === sel.node && (sel.stops === null || sel.stops.includes(asw.stop))

/** Group a departureboards response into one board per requested selector. */
export const toBoards = (
  selectors: ReadonlyArray<StopSelector>,
  data: PidBoardResponse,
): Array<StopBoard> => {
  const aswByStopId = new Map(
    data.stops.flatMap((s) => (s.asw_id === null ? [] : [[s.stop_id, s.asw_id] as const])),
  )
  const boards = selectors.map((sel) => ({
    sel,
    key: selectorKey(sel),
    departures: [] as Array<Departure>,
  }))
  for (const raw of data.departures) {
    const asw = aswByStopId.get(raw.stop.id)
    if (asw === undefined) continue
    const dep = toDeparture(raw)
    if (dep === null) continue
    for (const board of boards) {
      if (matches(board.sel, asw)) board.departures.push(dep)
    }
  }
  for (const board of boards) {
    board.departures.sort(
      (a, b) => Date.parse(a.predicted ?? a.scheduled) - Date.parse(b.predicted ?? b.scheduled),
    )
  }
  return boards.map(({ key, departures }) => ({ key, departures }))
}
