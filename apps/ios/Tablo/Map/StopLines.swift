import MapKit
import UIKit

/// One line serving the current stop: the path of one of its route's trips.
struct StopLine: Hashable {
    let route: String
    let kind: VehicleKind
    let path: [LngLat]
}

/// The stop lines on the map, as one stroke: the surface lines solid, the
/// metro dashed. One stroke paints shared track once, so routes running
/// together read as one line rather than doubling up where their shapes
/// differ by a metre.
final class StopLinesOverlay: MKMultiPolyline {
    private(set) var metro = false

    static func make(_ lines: [StopLine], metro: Bool) -> StopLinesOverlay {
        let overlay = StopLinesOverlay(lines.map { line in
            let coords = line.path.map(\.coordinate)
            return MKPolyline(coordinates: coords, count: coords.count)
        })
        overlay.metro = metro
        return overlay
    }
}

/// Every line serving the current stop, drawn on the board map as quiet
/// context under the markers (`StopLines` in the design system): one
/// direction per route, ink-dim and faint, metro (underground) dashed.
enum StopLines {
    static let width: CGFloat = 3
    static let opacity: CGFloat = 0.32
    static let metroDash: [NSNumber] = [5, 4]

    /// Drawn off the main thread, so the appearance is handed in rather than read from traits.
    static func renderer(for overlay: StopLinesOverlay, dark: Bool) -> MKMultiPolylineRenderer {
        let r = MKMultiPolylineRenderer(multiPolyline: overlay)
        // ink-dim
        r.strokeColor = UIColor(hex: dark ? 0xD8D6CF : 0x2E2D31, alpha: opacity)
        r.lineWidth = width
        r.lineCap = .round
        r.lineJoin = .round
        if overlay.metro { r.lineDashPattern = metroDash }
        return r
    }

    /// Kinks smaller than this (shape noise) are dropped.
    static let simplifyMetres = 2.5
    /// Corners are rounded off over at most this far along each side.
    static let cornerMetres = 10.0

    /// A GTFS shape smoothed for drawing: its jitter dropped, then its corners
    /// rounded by Chaikin's corner cutting, each cut bounded so a street corner
    /// stays on the street.
    static func smooth(_ path: [LngLat], iterations: Int = 3) -> [LngLat] {
        guard path.count > 2 else { return path }
        let perMetre = MKMapPointsPerMeterAtLatitude(path[0].lat)
        var points = simplify(path.map { MKMapPoint($0.coordinate) }, tolerance: simplifyMetres * perMetre)
        var cut = cornerMetres * perMetre
        for _ in 0 ..< iterations {
            guard points.count > 2 else { break }
            var next = [points[0]]
            next.reserveCapacity(points.count * 2)
            for i in 0 ..< points.count - 1 {
                let a = points[i], b = points[i + 1]
                let length = hypot(b.x - a.x, b.y - a.y)
                guard length > 0 else { continue }
                let f = min(0.25, cut / length)
                if i > 0 { next.append(MKMapPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f)) }
                if i < points.count - 2 { next.append(MKMapPoint(x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f)) }
            }
            next.append(points[points.count - 1])
            points = next
            cut /= 2
        }
        var smooth = points.map { LngLat($0.coordinate.longitude, $0.coordinate.latitude) }
        // the ends exactly where they were, not a round trip through map points
        smooth[0] = path[0]
        smooth[smooth.count - 1] = path[path.count - 1]
        return smooth
    }

    /// Closer than this to a line already drawn, running alongside it, a line
    /// is drawn on top of it; from here out to `mergeMetres` it eases over.
    static let snapMetres = 6.0
    static let mergeMetres = 12.0
    /// Running alongside: within this angle of the other line, either way.
    static let mergeDegrees = 35.0
    /// Lines are walked in steps this long, so they ease onto and off each other.
    static let stepMetres = 4.0

    /// Lines running together drawn as one: the other track of the street, a
    /// second route over the same rails. Each line in turn is laid onto the
    /// lines before it wherever it runs alongside them, following their exact
    /// vertices there, and eases off where it parts. Metro merges only with metro.
    static func merge(_ lines: [StopLine]) -> [StopLine] {
        guard let first = lines.first(where: { !$0.path.isEmpty }) else { return lines }
        let perMetre = MKMapPointsPerMeterAtLatitude(first.path[0].lat)
        var surface = Merger(perMetre: perMetre), metro = Merger(perMetre: perMetre)
        return lines.map { line in
            line.kind == .metro ? metro.add(line) : surface.add(line)
        }
    }

    private struct Snap {
        let line: Int
        let along: Double
        let point: MKMapPoint
        let metres: Double
    }

    /// The lines laid so far, their segments bucketed in a grid for nearby lookups.
    private struct Merger {
        let perMetre: Double
        private var lines: [(points: [MKMapPoint], along: [Double])] = []
        private var grid: [Int64: [(line: Int, seg: Int)]] = [:]
        private let cell: Double

        init(perMetre: Double) {
            self.perMetre = perMetre
            cell = 25 * perMetre
        }

        mutating func add(_ line: StopLine) -> StopLine {
            guard line.path.count > 1 else { return line }
            let points = densify(line.path.map { MKMapPoint($0.coordinate) }, step: stepMetres * perMetre)
            var merged: [MKMapPoint] = []
            merged.reserveCapacity(points.count)
            var last: Snap?
            var touches = false
            for i in points.indices {
                let p = points[i]
                let a = points[max(0, i - 1)], b = points[min(points.count - 1, i + 1)]
                guard let s = snap(p, heading: (b.x - a.x, b.y - a.y)) else {
                    merged.append(p)
                    last = nil
                    continue
                }
                touches = true
                if s.metres <= snapMetres {
                    // fully on the other line: follow its vertices, not a chord across them
                    if let last, last.line == s.line { merged += between(last, s) }
                    merged.append(s.point)
                    last = s
                } else {
                    let w = (mergeMetres - s.metres) / (mergeMetres - snapMetres)
                    merged.append(MKMapPoint(x: p.x + (s.point.x - p.x) * w, y: p.y + (s.point.y - p.y) * w))
                    last = nil
                }
            }
            guard touches else {
                // runs alongside nothing laid so far: as it came
                insert(line.path.map { MKMapPoint($0.coordinate) })
                return line
            }
            merged = merged.enumerated().filter { $0.offset == 0 || !same($0.element, merged[$0.offset - 1]) }.map(\.element)
            insert(merged)
            var path = merged.map { LngLat($0.coordinate.longitude, $0.coordinate.latitude) }
            if same(merged[0], points[0]) { path[0] = line.path[0] }
            if same(merged[merged.count - 1], points[points.count - 1]) { path[path.count - 1] = line.path[line.path.count - 1] }
            return StopLine(route: line.route, kind: line.kind, path: path)
        }

        /// The other line's vertices strictly between two places on it, in order.
        private func between(_ from: Snap, _ to: Snap) -> [MKMapPoint] {
            let ref = lines[from.line]
            let lo = min(from.along, to.along), hi = max(from.along, to.along)
            // binary search for the first vertex past `lo`
            var i = 0, j = ref.along.count
            while i < j {
                let m = (i + j) / 2
                if ref.along[m] <= lo { i = m + 1 } else { j = m }
            }
            var inside: [MKMapPoint] = []
            while i < ref.along.count, ref.along[i] < hi {
                inside.append(ref.points[i])
                i += 1
            }
            return from.along <= to.along ? inside : inside.reversed()
        }

        /// The nearest place on a laid line within `mergeMetres` of `p` running
        /// alongside `heading`.
        private func snap(_ p: MKMapPoint, heading: (x: Double, y: Double)) -> Snap? {
            let hLen = hypot(heading.x, heading.y)
            guard hLen > 0, !lines.isEmpty else { return nil }
            let reach = mergeMetres * perMetre
            let minCos = cos(mergeDegrees * .pi / 180)
            var best: Snap?
            var seen = Set<Int64>()
            for key in keys(minX: p.x - reach, maxX: p.x + reach, minY: p.y - reach, maxY: p.y + reach) {
                for (li, si) in grid[key] ?? [] {
                    guard seen.insert(Int64(li) << 32 | Int64(si)).inserted else { continue }
                    let ref = lines[li]
                    let a = ref.points[si], b = ref.points[si + 1]
                    let dx = b.x - a.x, dy = b.y - a.y
                    let len = hypot(dx, dy)
                    guard len > 0, abs(dx * heading.x + dy * heading.y) / (len * hLen) >= minCos else { continue }
                    let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)))
                    let q = MKMapPoint(x: a.x + t * dx, y: a.y + t * dy)
                    let d = hypot(p.x - q.x, p.y - q.y)
                    guard d <= reach, d < (best.map { $0.metres * perMetre } ?? .infinity) else { continue }
                    best = Snap(line: li, along: ref.along[si] + t * len, point: q, metres: d / perMetre)
                }
            }
            return best
        }

        private mutating func insert(_ points: [MKMapPoint]) {
            guard points.count > 1 else { return }
            var along = [0.0]
            for i in 1 ..< points.count {
                along.append(along[i - 1] + hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
            }
            let li = lines.count
            lines.append((points, along))
            for si in 0 ..< points.count - 1 {
                let a = points[si], b = points[si + 1]
                for key in keys(minX: min(a.x, b.x), maxX: max(a.x, b.x), minY: min(a.y, b.y), maxY: max(a.y, b.y)) {
                    grid[key, default: []].append((li, si))
                }
            }
        }

        private func keys(minX: Double, maxX: Double, minY: Double, maxY: Double) -> [Int64] {
            let x0 = Int64(floor(minX / cell)), x1 = Int64(floor(maxX / cell))
            let y0 = Int64(floor(minY / cell)), y1 = Int64(floor(maxY / cell))
            var out: [Int64] = []
            for x in x0 ... x1 {
                for y in y0 ... y1 { out.append(x << 32 | (y & 0xFFFF_FFFF)) }
            }
            return out
        }

        private func same(_ a: MKMapPoint, _ b: MKMapPoint) -> Bool { a.x == b.x && a.y == b.y }

        /// No two points further apart than `step`.
        private func densify(_ points: [MKMapPoint], step: Double) -> [MKMapPoint] {
            var out = [points[0]]
            for i in 1 ..< points.count {
                let a = points[i - 1], b = points[i]
                let n = Int(ceil(hypot(b.x - a.x, b.y - a.y) / step))
                if n > 1 {
                    for k in 1 ..< n {
                        let f = Double(k) / Double(n)
                        out.append(MKMapPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f))
                    }
                }
                out.append(b)
            }
            return out
        }
    }

    /// Douglas–Peucker: the fewest points within `tolerance` of the line.
    private static func simplify(_ points: [MKMapPoint], tolerance: Double) -> [MKMapPoint] {
        guard points.count > 2 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        var stack = [(0, points.count - 1)]
        while let (first, last) = stack.popLast() {
            guard last > first + 1 else { continue }
            let a = points[first], b = points[last]
            var farthest = first, distance = 0.0
            for i in first + 1 ..< last {
                let d = segmentDistance(points[i], a, b)
                if d > distance { distance = d; farthest = i }
            }
            guard distance > tolerance else { continue }
            keep[farthest] = true
            stack.append((first, farthest))
            stack.append((farthest, last))
        }
        return points.indices.filter { keep[$0] }.map { points[$0] }
    }

    private static func segmentDistance(_ p: MKMapPoint, _ a: MKMapPoint, _ b: MKMapPoint) -> Double {
        let dx = b.x - a.x, dy = b.y - a.y
        let lengthSq = dx * dx + dy * dy
        guard lengthSq > 0 else { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
}
