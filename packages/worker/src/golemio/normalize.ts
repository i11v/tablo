import type {
  Departure,
  LiveVehicles,
  ShapePoint,
  StopBoard,
  StopSelector,
  Trip,
  TripStop,
  TripVehicle,
  VehicleKind,
} from "@app/contract"
import { selectorKey } from "@app/contract"
import type {
  PidBoardResponse,
  PidDeparture,
  PidPublicVehicles,
  PidTripPosition,
  PidTripResponse,
} from "./schema.ts"

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
    tripId: d.trip.id,
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

/* ---- trips & vehicles ---- */

/** Public vehicle positions name route types instead of numbering them. */
export const publicRouteTypeToKind = (type: string | null): VehicleKind => {
  switch (type) {
    case "tram":
      return "tram"
    case "metro":
      return "metro"
    case "train":
      return "train"
    case "bus":
    case "trolleybus":
      return "bus"
    default:
      return "other" // ferry, funicular, unknown
  }
}

/** "HH:MM:SS" after service-day midnight → seconds. Hours may exceed 23. */
export const gtfsTimeToSeconds = (time: string): number | null => {
  const m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(time.trim())
  return m === null ? null : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** "U539Z1P" → node 539, stop 1; rail waypoints and other non-ASW ids → null. */
export const parseAswStopId = (stopId: string): { node: number; stop: number } | null => {
  const m = /^U(\d+)Z(\d+)/.exec(stopId)
  return m === null ? null : { node: Number(m[1]), stop: Number(m[2]) }
}

// 5 decimals ≈ 1 m: plenty for drawing a route, and keeps the payload small.
const round5 = (x: number) => Math.round(x * 1e5) / 1e5
const round4 = (x: number) => Math.round(x * 1e4) / 1e4
const finiteOrNull = (x: number | null | undefined): number | null =>
  x !== null && x !== undefined && Number.isFinite(x) ? x : null

export const toTrip = (data: PidTripResponse): Trip => {
  const stops = [...data.stop_times]
    .sort((a, b) => a.stop_sequence - b.stop_sequence)
    .flatMap((st): Array<TripStop> => {
      const arrival = gtfsTimeToSeconds(st.arrival_time) ?? gtfsTimeToSeconds(st.departure_time)
      const departure = gtfsTimeToSeconds(st.departure_time) ?? arrival
      if (arrival === null || departure === null) return []
      const [lon, lat] = st.stop.geometry.coordinates
      const asw = parseAswStopId(st.stop.properties.stop_id)
      return [
        {
          name: st.stop.properties.stop_name,
          lat,
          lon,
          node: asw?.node ?? null,
          stop: asw?.stop ?? null,
          platform: st.stop.properties.platform_code,
          sequence: st.stop_sequence,
          arrival,
          departure,
          distance: st.shape_dist_traveled ?? 0,
        },
      ]
    })

  const shape: Array<ShapePoint> = []
  for (const pt of [...data.shapes].sort(
    (a, b) => a.properties.shape_pt_sequence - b.properties.shape_pt_sequence,
  )) {
    const lon = round5(pt.geometry.coordinates[0])
    const lat = round5(pt.geometry.coordinates[1])
    const prev = shape.at(-1)
    if (prev !== undefined && prev[0] === lon && prev[1] === lat) continue
    shape.push([lon, lat, round4(pt.properties.shape_dist_traveled)])
  }

  return { tripId: data.trip_id, headsign: data.trip_headsign, stops, shape }
}

export const toTripVehicle = (data: PidTripPosition): TripVehicle => {
  const pos = data.properties.last_position
  const [lon, lat] = data.geometry.coordinates
  return {
    tripId: data.properties.trip.gtfs.trip_id,
    lat,
    lon,
    bearing: finiteOrNull(pos.bearing),
    delaySeconds: finiteOrNull(pos.delay?.actual),
    lastStopSequence: finiteOrNull(pos.last_stop?.sequence),
    nextStopSequence: finiteOrNull(pos.next_stop?.sequence),
    distance: finiteOrNull(pos.shape_dist_traveled), // Golemio sends a numeric string
    state: pos.state_position,
    updatedAt: pos.origin_timestamp,
  }
}

export const toLiveVehicles = (data: PidPublicVehicles, generatedAt: string): LiveVehicles => ({
  vehicles: data.features.flatMap((f) => {
    const p = f.properties
    if (p.gtfs_trip_id === null) return []
    const [lon, lat] = f.geometry.coordinates
    return [
      {
        tripId: p.gtfs_trip_id,
        route: p.gtfs_route_short_name ?? "?",
        kind: publicRouteTypeToKind(p.route_type),
        lat,
        lon,
        bearing: finiteOrNull(p.bearing),
        delaySeconds: finiteOrNull(p.delay),
      },
    ]
  }),
  generatedAt,
})
