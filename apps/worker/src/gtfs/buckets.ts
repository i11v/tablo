import {
  type ShapePoint,
  type TripBucketCall,
  type TripBucketStop,
  type TripBucketTrip,
  type TripBucketV1,
  tripBucketKey,
} from "@app/contract"
import { gtfsTimeToSeconds, parseAswStopId, round4, round5 } from "../golemio/normalize.ts"

/** GTFS tables as CSV rows, header first. */
export interface GtfsTables {
  readonly trips: Iterable<ReadonlyArray<string>>
  readonly stops: Iterable<ReadonlyArray<string>>
  readonly stopTimes: Iterable<ReadonlyArray<string>>
  readonly shapes: Iterable<ReadonlyArray<string>>
}

/** Read a table row by row, by column name. */
function* rowsOf<K extends string>(
  table: Iterable<ReadonlyArray<string>>,
  name: string,
  columns: ReadonlyArray<K>,
): Generator<Record<K, string>> {
  let index: Array<[K, number]> | undefined
  for (const row of table) {
    if (index === undefined) {
      index = columns.map((c) => {
        const i = row.indexOf(c)
        if (i === -1) throw new Error(`${name} is missing column ${c}`)
        return [c, i]
      })
      continue
    }
    if (row.length === 1 && row[0] === "") continue
    const out = {} as Record<K, string>
    for (const [c, i] of index) out[c] = row[i] ?? ""
    yield out
  }
}

const orNull = (s: string): string | null => (s === "" ? null : s)

/**
 * GTFS → one {@link TripBucketV1} per route prefix. Applies the same
 * normalization as the Golemio path (`toTrip`), so a plan served from a
 * bucket equals the one Golemio would have given. Output is deterministic
 * (sorted keys, stable indices): an unchanged route yields identical bytes.
 */
export const buildTripBuckets = (gtfs: GtfsTables): Map<string, TripBucketV1> => {
  const stops = new Map<string, TripBucketStop>()
  for (const s of rowsOf(gtfs.stops, "stops.txt", [
    "stop_id",
    "stop_name",
    "stop_lat",
    "stop_lon",
    "platform_code",
  ])) {
    const asw = parseAswStopId(s.stop_id)
    stops.set(s.stop_id, [
      s.stop_name,
      Number(s.stop_lat),
      Number(s.stop_lon),
      asw?.node ?? null,
      asw?.stop ?? null,
      orNull(s.platform_code),
    ])
  }

  type RawCall = {
    stopId: string
    sequence: number
    arrival: number
    departure: number
    distance: number
  }
  const calls = new Map<string, Array<RawCall>>()
  for (const st of rowsOf(gtfs.stopTimes, "stop_times.txt", [
    "trip_id",
    "arrival_time",
    "departure_time",
    "stop_id",
    "stop_sequence",
    "shape_dist_traveled",
  ])) {
    const arrival = gtfsTimeToSeconds(st.arrival_time) ?? gtfsTimeToSeconds(st.departure_time)
    const departure = gtfsTimeToSeconds(st.departure_time) ?? arrival
    if (arrival === null || departure === null || !stops.has(st.stop_id)) continue
    let list = calls.get(st.trip_id)
    if (list === undefined) calls.set(st.trip_id, (list = []))
    list.push({
      stopId: st.stop_id,
      sequence: Number(st.stop_sequence),
      arrival,
      departure,
      distance: st.shape_dist_traveled === "" ? 0 : Number(st.shape_dist_traveled),
    })
  }

  const rawShapes = new Map<
    string,
    Array<{ seq: number; lon: number; lat: number; dist: number }>
  >()
  for (const p of rowsOf(gtfs.shapes, "shapes.txt", [
    "shape_id",
    "shape_pt_lat",
    "shape_pt_lon",
    "shape_pt_sequence",
    "shape_dist_traveled",
  ])) {
    let list = rawShapes.get(p.shape_id)
    if (list === undefined) rawShapes.set(p.shape_id, (list = []))
    list.push({
      seq: Number(p.shape_pt_sequence),
      lon: Number(p.shape_pt_lon),
      lat: Number(p.shape_pt_lat),
      dist: Number(p.shape_dist_traveled),
    })
  }
  const shapeCache = new Map<string, Array<ShapePoint>>()
  const shapeOf = (id: string): Array<ShapePoint> | undefined => {
    const cached = shapeCache.get(id)
    if (cached !== undefined) return cached
    const raw = rawShapes.get(id)
    if (raw === undefined) return undefined
    const shape: Array<ShapePoint> = []
    for (const pt of raw.sort((a, b) => a.seq - b.seq)) {
      const lon = round5(pt.lon)
      const lat = round5(pt.lat)
      const prev = shape.at(-1)
      if (prev !== undefined && prev[0] === lon && prev[1] === lat) continue
      shape.push([lon, lat, round4(pt.dist)])
    }
    shapeCache.set(id, shape)
    return shape
  }

  const grouped = new Map<string, Array<{ id: string; headsign: string; shapeId: string }>>()
  for (const t of rowsOf(gtfs.trips, "trips.txt", ["trip_id", "trip_headsign", "shape_id"])) {
    const key = tripBucketKey(t.trip_id)
    if (key === null || !calls.has(t.trip_id)) continue
    let list = grouped.get(key)
    if (list === undefined) grouped.set(key, (list = []))
    list.push({ id: t.trip_id, headsign: t.trip_headsign, shapeId: t.shape_id })
  }

  const buckets = new Map<string, TripBucketV1>()
  for (const key of [...grouped.keys()].sort()) {
    const bucketStops: Array<TripBucketStop> = []
    const stopIndex = new Map<string, number>()
    const shapes: Record<string, ReadonlyArray<ShapePoint>> = {}
    const trips: Record<string, TripBucketTrip> = {}
    const list = grouped.get(key)!.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const t of list) {
      const tripCalls = calls
        .get(t.id)!
        .sort((a, b) => a.sequence - b.sequence)
        .map((c): TripBucketCall => {
          let i = stopIndex.get(c.stopId)
          if (i === undefined) {
            i = bucketStops.push(stops.get(c.stopId)!) - 1
            stopIndex.set(c.stopId, i)
          }
          return [i, c.sequence, c.arrival, c.departure, c.distance]
        })
      const shape = t.shapeId === "" ? undefined : shapeOf(t.shapeId)
      if (shape !== undefined) shapes[t.shapeId] = shape
      trips[t.id] = {
        headsign: t.headsign,
        shape: shape === undefined ? null : t.shapeId,
        calls: tripCalls,
      }
    }
    buckets.set(key, { version: 1, stops: bucketStops, shapes, trips })
  }
  return buckets
}
