import Foundation

enum Geo {
    /// Great-circle distance between two WGS-84 points, in metres.
    static func haversineMetres(_ a: LngLat, _ b: LngLat) -> Double {
        let r = 6_371_000.0
        let rad = Double.pi / 180
        let dLat = (b.lat - a.lat) * rad
        let dLon = (b.lng - a.lng) * rad
        let s = pow(sin(dLat / 2), 2) + cos(a.lat * rad) * cos(b.lat * rad) * pow(sin(dLon / 2), 2)
        return 2 * r * asin(min(1, s.squareRoot()))
    }

    /// Walking pace ≈ 4.8 km/h.
    static let walkMetresPerMinute = 80.0
    /// Streets aren't straight lines — inflate the crow-flies distance.
    static let detourFactor = 1.3

    /// Estimated minutes to walk a straight-line distance (an estimate, not a routed time).
    static func walkMinutes(metres: Double) -> Int {
        max(0, jsRound(metres / walkMetresPerMinute * detourFactor))
    }

    static func walkMinutes(from a: LngLat, to b: LngLat) -> Int {
        walkMinutes(metres: haversineMetres(a, b))
    }

    /// JavaScript's Math.round: halves round up (toward +∞), so -1.5 → -1.
    static func jsRound(_ x: Double) -> Int {
        Int((x + 0.5).rounded(.down))
    }

    static func lerp(_ a: LngLat, _ b: LngLat, _ f: Double) -> LngLat {
        LngLat(a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f)
    }

    static func mean(_ coords: [LngLat]) -> LngLat? {
        guard !coords.isEmpty else { return nil }
        let n = Double(coords.count)
        return LngLat(coords.map(\.lng).reduce(0, +) / n, coords.map(\.lat).reduce(0, +) / n)
    }

    // MARK: - Paths (km along a polyline)

    /// The point `km` along `path`, clamped to its ends.
    static func point(on path: [PathPoint], atKm km: Double) -> LngLat? {
        guard let first = path.first, let last = path.last else { return nil }
        if km <= first.km { return first.coord }
        if km >= last.km { return last.coord }
        let i = lastIndex(in: path, atOrBefore: km)
        let a = path[i], b = path[min(i + 1, path.count - 1)]
        let span = b.km - a.km
        return lerp(a.coord, b.coord, span > 0 ? (km - a.km) / span : 0)
    }

    /// Index of the last vertex at or before `km` (binary search; `path` is km-ascending).
    static func lastIndex(in path: [PathPoint], atOrBefore km: Double) -> Int {
        var lo = 0, hi = path.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if path[mid].km <= km { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// km along `path` of the point on it nearest `coord`, searching only from `fromKm` on
    /// (so a stop on a looping route lands on the right pass).
    static func project(_ coord: LngLat, onto path: [PathPoint], fromKm: Double = -.infinity) -> Double? {
        guard path.count > 1 else { return path.first?.km }
        let cosLat = cos(coord.lat * .pi / 180)
        var best: (d: Double, km: Double)?
        for i in 0 ..< path.count - 1 where path[i + 1].km >= fromKm {
            let a = path[i], b = path[i + 1]
            let ax = (a.coord.lng - coord.lng) * cosLat, ay = a.coord.lat - coord.lat
            let bx = (b.coord.lng - coord.lng) * cosLat, by = b.coord.lat - coord.lat
            let dx = bx - ax, dy = by - ay
            let len2 = dx * dx + dy * dy
            let t = len2 > 0 ? max(0, min(1, -(ax * dx + ay * dy) / len2)) : 0
            let px = ax + dx * t, py = ay + dy * t
            let d = px * px + py * py
            let km = max(fromKm, a.km + (b.km - a.km) * t)
            if d < (best?.d ?? .infinity) { best = (d, km) }
        }
        return best?.km
    }

    /// A polyline through `coords` with cumulative great-circle km.
    static func path(through coords: [LngLat]) -> [PathPoint] {
        var out: [PathPoint] = []
        var km = 0.0
        for (i, c) in coords.enumerated() {
            if i > 0 { km += haversineMetres(coords[i - 1], c) / 1000 }
            out.append(PathPoint(coord: c, km: km))
        }
        return out
    }
}
