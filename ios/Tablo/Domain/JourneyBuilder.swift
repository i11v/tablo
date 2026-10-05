import Foundation

/// A trip prepared once for timing and drawing: its path with km, and each
/// stop's km along it.
struct TripPlan: Hashable {
    let trip: Trip
    let path: [PathPoint]
    let stopKm: [Double]
    /// `path` carries the shape's own km, so the vehicle's reported distance lines up with it.
    let usesShapeKm: Bool

    init(_ trip: Trip) {
        self.trip = trip
        let shape = trip.shape.map { PathPoint(coord: LngLat($0.lon, $0.lat), km: $0.km) }
        let ascending = shape.count > 1
            && zip(shape, shape.dropFirst()).allSatisfy { $0.km <= $1.km }
            && shape[shape.count - 1].km > shape[0].km
        if ascending {
            path = shape
            usesShapeKm = true
        } else if shape.count > 1 {
            // a shape without usable km: measure it ourselves
            path = Geo.path(through: shape.map(\.coord))
            usesShapeKm = false
        } else {
            // no shape at all: straight lines between the stops
            path = Geo.path(through: trip.stops.map(\.coord))
            usesShapeKm = false
        }

        let total = path.last?.km ?? 0
        var from = -Double.infinity
        var kms: [Double] = []
        for (i, s) in trip.stops.enumerated() {
            var km: Double
            if shape.count <= 1, path.indices.contains(i) {
                km = path[i].km
            } else if usesShapeKm, let d = s.distance, d >= from - 0.01, d <= total + 0.5 {
                km = d
            } else {
                km = Geo.project(s.coord, onto: path, fromKm: from) ?? max(from, 0)
            }
            km = max(km, from)
            kms.append(km)
            from = km
        }
        stopKm = kms
    }
}

/// Where a trip's vehicle is relative to its stops.
struct TripPosition: Equatable {
    /// Between stops[seg] and stops[seg + 1] (`frac` of the way), or at stops[seg] when `atStop`.
    let seg: Int
    let frac: Double
    let atStop: Bool
}

/// Builds the journey a departure makes through the current stop from its trip,
/// anchoring the trip's service-day seconds to the departure's absolute time.
enum JourneyBuilder {
    /// The trip stop that is "mine": the first at the current stop's node (and
    /// among its stop ids when the stop is platform-scoped). Several passes break
    /// ties on the departure's platform; a stop the trip lists under another
    /// node falls back to the nearest one within 400 m.
    static func mineIndex(_ stops: [TripStop], node: Int, scope: [Int]?, platform: String?, near: LngLat) -> Int? {
        let atNode = stops.indices.filter { stops[$0].node == node }
        let scoped = scope.map { ids in atNode.filter { stops[$0].stop.map(ids.contains) ?? false } } ?? atNode
        let pool = scoped.isEmpty ? atNode : scoped
        if pool.count > 1, let platform, let hit = pool.first(where: { stops[$0].platform == platform }) {
            return hit
        }
        if let first = pool.first { return first }
        let nearest = stops.indices.min { Geo.haversineMetres(stops[$0].coord, near) < Geo.haversineMetres(stops[$1].coord, near) }
        return nearest.flatMap { Geo.haversineMetres(stops[$0].coord, near) <= 400 ? $0 : nil }
    }

    /// The trip's service-day midnight as an absolute time: the tapped departure's
    /// scheduled time minus "my" stop's departure seconds.
    static func anchor(scheduled: Date, mineSeconds: Double) -> Date {
        scheduled.addingTimeInterval(-mineSeconds)
    }

    /// Scheduled time at each stop: departure up to and including mine, arrival after.
    static func scheduledTimes(_ stops: [TripStop], mine: Int, anchor: Date) -> [Date] {
        stops.indices.map { i in anchor.addingTimeInterval(i <= mine ? stops[i].departure : stops[i].arrival) }
    }

    /// The vehicle's segment: from the live position's stop sequences when
    /// tracked, else estimated from the predicted times.
    static func position(
        stops: [TripStop], stopKm: [Double], predicted: [Date], mine: Int,
        departureAtStop: Bool, vehicle: TripVehicle?, vehicleKm: Double?, now: Date
    ) -> TripPosition {
        let n = stops.count
        guard n > 1 else { return TripPosition(seg: 0, frac: 0, atStop: true) }

        func timeFrac(_ s: Int) -> Double {
            let span = predicted[s + 1].timeIntervalSince(predicted[s])
            return span > 0 ? now.timeIntervalSince(predicted[s]) / span : 0
        }
        func kmFrac(_ s: Int, _ km: Double) -> Double {
            let span = stopKm[s + 1] - stopKm[s]
            return span > 0 ? (km - stopKm[s]) / span : 0
        }
        func clamp(_ x: Double) -> Double { max(0, min(1, x)) }

        if let v = vehicle {
            let last = v.lastStopSequence.flatMap { q in stops.firstIndex { $0.sequence == q } }
            let next = v.nextStopSequence.flatMap { q in stops.firstIndex { $0.sequence == q } }
            switch v.state {
            case "at_stop":
                if let i = last ?? next { return TripPosition(seg: i, frac: 0, atStop: true) }
            case "before_track":
                return TripPosition(seg: 0, frac: 0, atStop: false)
            case "after_track":
                return TripPosition(seg: n - 1, frac: 0, atStop: true)
            default:
                break
            }
            var seg: Int?
            if let last { seg = last } else if let next { seg = next - 1 }
            if seg == nil, let km = vehicleKm {
                seg = stopKm.lastIndex { $0 <= km } ?? 0
            }
            if let raw = seg {
                let s = max(0, min(n - 2, raw))
                let frac = clamp(vehicleKm.map { kmFrac(s, $0) } ?? timeFrac(s))
                if departureAtStop, s == mine || s + 1 == mine {
                    return TripPosition(seg: mine, frac: 0, atStop: true)
                }
                return TripPosition(seg: s, frac: frac, atStop: false)
            }
        }

        if departureAtStop { return TripPosition(seg: mine, frac: 0, atStop: true) }
        if now < predicted[0] { return TripPosition(seg: 0, frac: 0, atStop: false) }
        if now >= predicted[n - 1] { return TripPosition(seg: n - 1, frac: 0, atStop: true) }
        let s = (0 ..< n - 1).last { predicted[$0] <= now } ?? 0
        return TripPosition(seg: s, frac: clamp(timeFrac(s)), atStop: false)
    }

    /// Within this of a stop's km, a tracked vehicle is at that stop.
    static let atStopKm = 0.02

    /// The vehicle's segment from where its track has it along the path.
    static func position(stopKm: [Double], mine: Int, departureAtStop: Bool, km: Double) -> TripPosition {
        let n = stopKm.count
        guard n > 1 else { return TripPosition(seg: 0, frac: 0, atStop: true) }
        if let i = stopKm.indices.last(where: { abs(stopKm[$0] - km) <= atStopKm }) {
            if departureAtStop, abs(i - mine) <= 1 { return TripPosition(seg: mine, frac: 0, atStop: true) }
            return TripPosition(seg: i, frac: 0, atStop: true)
        }
        if km >= stopKm[n - 1] { return TripPosition(seg: n - 1, frac: 0, atStop: true) }
        let s = min(n - 2, stopKm.lastIndex { $0 <= km } ?? 0)
        if departureAtStop, s == mine || s + 1 == mine { return TripPosition(seg: mine, frac: 0, atStop: true) }
        let span = stopKm[s + 1] - stopKm[s]
        return TripPosition(seg: s, frac: span > 0 ? max(0, min(1, (km - stopKm[s]) / span)) : 0, atStop: false)
    }

    /// `trackKm`: where the vehicle's track has it now, when it's followed between reports.
    static func build(
        plan: TripPlan, departure: WireDeparture, vehicle: TripVehicle?, trackKm: Double? = nil,
        stop: IndexStop, walk: Int?, now: Date
    ) -> Journey? {
        let tripStops = plan.trip.stops
        guard tripStops.count > 1, plan.path.count > 1,
              let mine = mineIndex(tripStops, node: stop.node, scope: stop.stops, platform: departure.platform, near: stop.coord)
        else { return nil }

        let anchor = anchor(scheduled: departure.scheduled, mineSeconds: tripStops[mine].departure)
        let scheduled = scheduledTimes(tripStops, mine: mine, anchor: anchor)
        let delay = vehicle?.delaySeconds ?? departure.delaySeconds ?? 0
        let predicted = scheduled.map { $0.addingTimeInterval(delay) }

        let liveKm: Double? = vehicle.flatMap { v in
            if plan.usesShapeKm, let d = v.distance { return d }
            return Geo.project(v.coord, onto: plan.path)
        }
        let at = trackKm.map {
            position(stopKm: plan.stopKm, mine: mine, departureAtStop: departure.isAtStop, km: $0)
        } ?? position(
            stops: tripStops, stopKm: plan.stopKm, predicted: predicted, mine: mine,
            departureAtStop: departure.isAtStop, vehicle: vehicle, vehicleKm: liveKm, now: now
        )
        let km: Double
        if let trackKm, !(departure.isAtStop && at.atStop && at.seg == mine) {
            km = trackKm // smooth: not snapped to the stop it's within a few metres of
        } else if at.atStop || at.seg >= tripStops.count - 1 {
            km = plan.stopKm[at.seg]
        } else {
            km = plan.stopKm[at.seg] + at.frac * (plan.stopKm[at.seg + 1] - plan.stopKm[at.seg])
        }

        let stops = tripStops.indices.map { i in
            let passed = at.atStop ? i < at.seg : i <= at.seg
            return JourneyStop(
                name: tripStops[i].name,
                coord: tripStops[i].coord,
                time: passed ? scheduled[i] : predicted[i],
                km: plan.stopKm[i]
            )
        }
        let resolved = Board.resolve(departure, now: now)
        return Journey(
            departure: resolved,
            stops: stops,
            mine: mine,
            seg: at.seg,
            frac: at.frac,
            atStop: at.atStop,
            tier: Tier.reach(inMinutes: resolved.inMinutes, walk: walk),
            delay: Geo.jsRound(delay / 60),
            path: plan.path,
            vehicleKm: km
        )
    }

    private static let clockStyle = Date.VerbatimFormatStyle(
        format: "\(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)):\(minute: .twoDigits)",
        timeZone: TimeZone(identifier: "Europe/Prague") ?? .current,
        calendar: Calendar(identifier: .gregorian)
    )

    /// "HH:MM" on Prague's wall clock.
    static func clock(_ date: Date) -> String {
        date.formatted(clockStyle)
    }
}
