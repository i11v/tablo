import type { LinesV1, NetworkLine, VehicleKind } from "@app/contract"

/**
 * GTFS shapes → the city network as {@link LinesV1}: every distinct shape of
 * the city's tram, bus, trolleybus and metro routes, smoothed, then merged so
 * shared track is drawn once. Regional buses and trains are left out (they
 * add ~160,000 km of shapes to the city's ~20,000).
 *
 * Shapes are laid busiest first. Each one follows the stretches laid before
 * it wherever it runs alongside them (within {@link SNAP_M}, roughly
 * parallel), easing back to its own course out to {@link MERGE_M}; those
 * stretches take on its mode. What's left of it is new track, smoothed where
 * it parts from the old; short bits that only link laid track (turns at a
 * junction, stop bays) are dropped, as the streets they join already meet.
 * Metro merges only with metro. Output is deterministic for a given feed.
 */

/** Smoothing: kinks smaller than this are dropped, then corners rounded over at most CORNER_M. */
const SIMPLIFY_M = 2.5
const CORNER_M = 10
/**
 * Merging: on the other line within SNAP_M, easing over out to MERGE_M,
 * within MERGE_DEG of its heading. Wide enough for a whole street: trams in
 * the median and buses in each carriageway sit up to ~20 m apart.
 */
const SNAP_M = 15
const MERGE_M = 30
const MERGE_DEG = 35
/** New track shorter than this that only joins laid track (a turn through a junction, a stop bay) is left out. */
const STUB_M = 60
/** Shapes are walked in steps this long while merging. */
const STEP_M = 4
/** The merged stretches keep the fewest points within this of their course. */
const OUTPUT_M = 0.75

const KINDS: ReadonlyArray<VehicleKind> = ["tram", "bus", "metro"]

/** route_type → mode, for the routes drawn; others are skipped. */
const kindOf = (routeType: string): VehicleKind | null => {
  switch (routeType) {
    case "0":
      return "tram"
    case "1":
      return "metro"
    case "3":
    case "11": // trolleybus
      return "bus"
    default:
      return null
  }
}

/** GTFS tables as CSV rows, header first. */
export interface LinesTables {
  readonly routes: Iterable<ReadonlyArray<string>>
  readonly trips: Iterable<ReadonlyArray<string>>
  readonly shapes: Iterable<ReadonlyArray<string>>
}

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

// Local plane in metres around Prague: plenty accurate for metre-scale work.
const LAT0 = 50.08
const LON0 = 14.42
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111_320
const KY = 110_574

interface P {
  x: number
  y: number
}

const toP = (lat: number, lon: number): P => ({ x: (lon - LON0) * KX, y: (lat - LAT0) * KY })
const round5 = (v: number) => Math.round(v * 1e5) / 1e5

export const buildLines = (gtfs: LinesTables, generatedAt: string): LinesV1 => {
  const kinds = new Map<string, VehicleKind>()
  for (const r of rowsOf(gtfs.routes, "routes.txt", ["route_id", "route_type", "is_regional"])) {
    const kind = kindOf(r.route_type)
    if (kind !== null && r.is_regional !== "1") kinds.set(r.route_id, kind)
  }
  // shape → its mode and how many trips run it
  const shapes = new Map<string, { kind: VehicleKind; trips: number }>()
  for (const t of rowsOf(gtfs.trips, "trips.txt", ["route_id", "shape_id"])) {
    const kind = kinds.get(t.route_id)
    if (kind === undefined || t.shape_id === "") continue
    const s = shapes.get(t.shape_id)
    if (s === undefined) shapes.set(t.shape_id, { kind, trips: 1 })
    else s.trips++
  }
  const points = new Map<string, Array<[number, P]>>()
  for (const r of rowsOf(gtfs.shapes, "shapes.txt", [
    "shape_id",
    "shape_pt_lat",
    "shape_pt_lon",
    "shape_pt_sequence",
  ])) {
    if (!shapes.has(r.shape_id)) continue
    let list = points.get(r.shape_id)
    if (list === undefined) points.set(r.shape_id, (list = []))
    list.push([Number(r.shape_pt_sequence), toP(Number(r.shape_pt_lat), Number(r.shape_pt_lon))])
  }

  // busiest first, so the main track is laid before the variants that run along it
  const order = [...points.keys()].sort((a, b) => {
    const sa = shapes.get(a)!,
      sb = shapes.get(b)!
    return (
      KINDS.indexOf(sa.kind) - KINDS.indexOf(sb.kind) ||
      sb.trips - sa.trips ||
      (a < b ? -1 : a > b ? 1 : 0)
    )
  })
  const surface = new Merger(),
    metro = new Merger()
  for (const id of order) {
    const path = points
      .get(id)!
      .sort((a, b) => a[0] - b[0])
      .map(([, p]) => p)
    const kind = shapes.get(id)!.kind
    ;(kind === "metro" ? metro : surface).add(smooth(path), 1 << KINDS.indexOf(kind))
  }

  const lines: NetworkLine[] = []
  for (const stretch of [...surface.stretches(), ...metro.stretches()]) {
    const coords: number[] = []
    for (const p of simplify(stretch.points, OUTPUT_M)) {
      coords.push(round5(LAT0 + p.y / KY), round5(LON0 + p.x / KX))
    }
    if (coords.length < 4) continue
    lines.push({ kinds: KINDS.filter((_, i) => stretch.mask & (1 << i)), coords })
  }
  return { version: 1, generatedAt, lines }
}

// --- geometry -------------------------------------------------------------

const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y)

/** Distance from p to segment ab, and where along it (0…1) the nearest point is. */
const project = (p: P, a: P, b: P): { t: number; d: number; q: P } => {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  const q = { x: a.x + t * dx, y: a.y + t * dy }
  return { t, d: dist(p, q), q }
}

/** Douglas–Peucker: the fewest points within `tolerance` metres of the line. */
export const simplify = (points: ReadonlyArray<P>, tolerance: number): P[] => {
  if (points.length <= 2) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    if (last <= first + 1) continue
    let farthest = first,
      max = 0
    for (let i = first + 1; i < last; i++) {
      const d = project(points[i], points[first], points[last]).d
      if (d > max) {
        max = d
        farthest = i
      }
    }
    if (max <= tolerance) continue
    keep[farthest] = 1
    stack.push([first, farthest], [farthest, last])
  }
  return points.filter((_, i) => keep[i] === 1)
}

/**
 * A shape smoothed for drawing: its jitter dropped, then its corners rounded
 * by Chaikin's corner cutting, each cut bounded so a street corner stays on
 * the street.
 */
export const smooth = (path: ReadonlyArray<P>, iterations = 3): P[] => {
  let points = simplify(path, SIMPLIFY_M)
  let cut = CORNER_M
  for (let k = 0; k < iterations && points.length > 2; k++) {
    const next: P[] = [points[0]]
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1]
      const len = dist(a, b)
      if (len === 0) continue
      const f = Math.min(0.25, cut / len)
      if (i > 0) next.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
      if (i < points.length - 2) next.push({ x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f })
    }
    next.push(points[points.length - 1])
    points = next
    cut /= 2
  }
  return points
}

const length = (points: ReadonlyArray<P>) => {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i])
  return total
}

const densify = (points: ReadonlyArray<P>, step: number): P[] => {
  const out: P[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    const n = Math.ceil(dist(a, b) / step)
    for (let k = 1; k < n; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
    out.push(b)
  }
  return out
}

// --- merging --------------------------------------------------------------

/** A stretch of laid track: its points, the distance along it at each, and each segment's modes. */
interface Stretch {
  points: P[]
  along: number[]
  masks: number[]
}

interface Snap {
  stretch: number
  seg: number
  along: number
  q: P
  d: number
}

const CELL = 25

class Merger {
  private laid: Stretch[] = []
  private grid = new Map<number, Array<[number, number]>>()

  private static key = (ix: number, iy: number) => (ix + 100_000) * 200_000 + (iy + 100_000)

  /** Lay `path`, run by mode bit `mask`. */
  add(path: ReadonlyArray<P>, mask: number): void {
    if (path.length < 2) return
    const points = densify(path, STEP_M)
    const fresh: P[][] = []
    let piece: P[] | null = null
    let joined = false // the open piece starts on laid track
    let last: Snap | null = null
    const close = (end: boolean) => {
      // where it parts from laid track it bends: round that off too
      const done = piece !== null && piece.length > 1 ? smooth(piece) : null
      piece = null
      if (done === null) return
      // measured smoothed: the jitter of a raw piece would pass it off as longer
      const len = length(done)
      const stub =
        len < STUB_M &&
        // a spur off laid track, or a link between laid track that wanders (a
        // turn through a junction); a short straight link carries a line on
        (joined && end ? len > 1.3 * dist(done[0], done[done.length - 1]) : joined || end)
      if (!stub) fresh.push(done)
    }
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)]
      const s = this.snap(p, b.x - a.x, b.y - a.y)
      if (s !== null && s.d <= SNAP_M) {
        // on laid track: it takes on this mode; an open piece joins it here
        this.mark(s, last !== null && last.stretch === s.stretch ? last : s, mask)
        if (piece !== null) {
          piece.push(s.q)
          close(true)
        }
        last = s
        continue
      }
      const at =
        s === null
          ? p
          : (() => {
              const w = (MERGE_M - s.d) / (MERGE_M - SNAP_M)
              return { x: p.x + (s.q.x - p.x) * w, y: p.y + (s.q.y - p.y) * w }
            })()
      if (piece === null) {
        joined = last !== null
        piece = joined ? [last!.q] : []
      }
      piece.push(at)
      last = null
    }
    close(false)
    for (const f of fresh) this.insert(f, mask)
  }

  /** Every laid stretch, cut where its modes change. */
  *stretches(): Generator<{ mask: number; points: P[] }> {
    for (const s of this.laid) {
      let start = 0
      for (let i = 1; i <= s.masks.length; i++) {
        if (i < s.masks.length && s.masks[i] === s.masks[start]) continue
        yield { mask: s.masks[start], points: s.points.slice(start, i + 1) }
        start = i
      }
    }
  }

  /** Give the segments of a laid stretch between two snaps the mode `mask`. */
  private mark(to: Snap, from: Snap, mask: number): void {
    const s = this.laid[to.stretch]
    const lo = Math.min(from.along, to.along),
      hi = Math.max(from.along, to.along)
    for (let i = Math.min(from.seg, to.seg); i <= Math.max(from.seg, to.seg); i++) {
      if (s.along[i] <= hi && s.along[i + 1] >= lo) s.masks[i] |= mask
    }
  }

  /** The nearest place on laid track within MERGE_M of `p`, running alongside its heading. */
  private snap(p: P, hx: number, hy: number): Snap | null {
    const hl = Math.hypot(hx, hy)
    if (hl === 0 || this.laid.length === 0) return null
    const minCos = Math.cos((MERGE_DEG * Math.PI) / 180)
    let best: Snap | null = null
    const x0 = Math.floor((p.x - MERGE_M) / CELL),
      x1 = Math.floor((p.x + MERGE_M) / CELL)
    const y0 = Math.floor((p.y - MERGE_M) / CELL),
      y1 = Math.floor((p.y + MERGE_M) / CELL)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (const [si, seg] of this.grid.get(Merger.key(ix, iy)) ?? []) {
          const s = this.laid[si]
          const a = s.points[seg],
            b = s.points[seg + 1]
          const dx = b.x - a.x,
            dy = b.y - a.y
          const len = Math.hypot(dx, dy)
          if (len === 0 || Math.abs(dx * hx + dy * hy) / (len * hl) < minCos) continue
          const { t, d, q } = project(p, a, b)
          if (d > MERGE_M || (best !== null && d >= best.d)) continue
          best = { stretch: si, seg, along: s.along[seg] + t * len, q, d }
        }
      }
    }
    return best
  }

  private insert(points: P[], mask: number): void {
    const along = [0]
    for (let i = 1; i < points.length; i++)
      along.push(along[i - 1] + dist(points[i - 1], points[i]))
    const si = this.laid.length
    this.laid.push({ points, along, masks: Array.from({ length: points.length - 1 }, () => mask) })
    for (let seg = 0; seg < points.length - 1; seg++) {
      const a = points[seg],
        b = points[seg + 1]
      const x0 = Math.floor(Math.min(a.x, b.x) / CELL),
        x1 = Math.floor(Math.max(a.x, b.x) / CELL)
      const y0 = Math.floor(Math.min(a.y, b.y) / CELL),
        y1 = Math.floor(Math.max(a.y, b.y) / CELL)
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const k = Merger.key(ix, iy)
          const cell = this.grid.get(k)
          if (cell === undefined) this.grid.set(k, [[si, seg]])
          else cell.push([si, seg])
        }
      }
    }
  }
}
