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
