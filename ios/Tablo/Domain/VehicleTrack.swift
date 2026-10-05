import Foundation

/// One position report of a vehicle, as the feed gives it.
struct VehicleReport: Hashable {
    let coord: LngLat
    /// km along the trip's shape, when the feed knows it.
    let distance: Double?
    /// Golemio state_position: on_track, at_stop, before_track, after_track, off_track, …
    let state: String
    /// When the vehicle made the report — not when it was fetched.
    let at: Date
}

/// A trip's timetable as km over service-day seconds: standing at each stop
/// from its arrival to its departure, moving evenly between stops.
struct TripSchedule: Hashable {
    let km: [Double]
    let arrival: [Double]
    let departure: [Double]

    init?(_ plan: TripPlan) {
        let stops = plan.trip.stops
        guard stops.count > 1, plan.stopKm.count == stops.count else { return nil }
        km = plan.stopKm
        // times only grow along a trip; clamp so a bad row can't run the clock backwards
        var t = -Double.infinity
        var arrival: [Double] = [], departure: [Double] = []
        for s in stops {
            let a = max(s.arrival, t)
            let d = max(s.departure, a)
            arrival.append(a)
            departure.append(d)
            t = d
        }
        self.arrival = arrival
        self.departure = departure
    }

    /// The timetable second the vehicle passes `x` km (leaving, when it's a stop).
    func seconds(atKm x: Double) -> Double {
        let n = km.count
        guard x > km[0] else { return departure[0] }
        guard x < km[n - 1] else { return arrival[n - 1] }
        let i = km.lastIndex { $0 <= x } ?? 0
        let span = km[i + 1] - km[i]
        return departure[i] + (span > 0 ? (x - km[i]) / span : 0) * (arrival[i + 1] - departure[i])
    }

    /// Where the timetable has the vehicle at second `s`, km.
    func km(atSeconds s: Double) -> Double {
        let n = km.count
        if s <= departure[0] { return km[0] }
        for i in 1 ..< n {
            if s < arrival[i] {
                let span = arrival[i] - departure[i - 1]
                return km[i - 1] + (span > 0 ? (s - departure[i - 1]) / span : 1) * (km[i] - km[i - 1])
            }
            if s <= departure[i] { return km[i] }
        }
        return km[n - 1]
    }
}

/// A live vehicle's km along its trip between reports. The feed refreshes a
/// vehicle only every 30–90 s, so the track moves it on from its latest report
/// at the timetable's pace, keeping the delay that report showed. A report that
/// shows it hasn't moved since the one before halts it there for `haltHold`,
/// then it moves on again.
///
/// The hold is bounded on purpose. Replaying 10 minutes of rush-hour reports,
/// every vehicle that showed no progress between two reports had moved on
/// 110–790 m by the next one (it was at a stop or a light, not stuck): holding
/// until a report shows movement doubled the error there (323 m vs 120 m median).
struct VehicleTrack {
    /// Less progress than this between two reports: it hasn't moved.
    static let haltKm = 0.03
    /// How long a vehicle that hasn't moved is held where it reported, from the report's time.
    static let haltHold: TimeInterval = 15
    /// How long a vehicle reported at a stop is taken to stand there.
    static let dwell: TimeInterval = 15
    /// No projecting further than this past the latest report: the feed went quiet.
    static let maxAhead: TimeInterval = 150
    /// Corrections ease over this long.
    static let ease: TimeInterval = 1.5
    /// A marker at most this far ahead of where a new report puts it waits for
    /// the projection to catch up instead of sliding back.
    static let holdKm = 0.15

    let schedule: TripSchedule
    /// The latest report showed no progress: it's held at `anchorKm` for `haltHold`.
    private(set) var halted = false
    private var lastKm: Double
    private var lastAt: Date
    /// The projection runs from `anchorKm` (timetable second `anchorSeconds`) once it's `startAt`.
    private var anchorKm = 0.0
    private var anchorSeconds = 0.0
    private var startAt: Date
    private var smoothing = Smoothing.none

    private enum Smoothing {
        case none
        /// Stay at least here until the projection passes it.
        case hold(Double)
        case ease(from: Double, at: Date)
    }

    /// Reports in these states lie on the trip and can be followed along it.
    static func follows(_ state: String) -> Bool {
        state == "on_track" || state == "at_stop"
    }

    /// km along `plan.path` of a report; nil when it can't be placed on it.
    static func km(of report: VehicleReport, on plan: TripPlan) -> Double? {
        if plan.usesShapeKm, let d = report.distance { return d }
        guard let s = Geo.snap(report.coord, onto: plan.path), s.metres <= 60 else { return nil }
        return s.km
    }

    /// Nil when the report can't be followed on the trip. `shownKm`: where the
    /// marker is drawn now, to ease from.
    init?(plan: TripPlan, report: VehicleReport, shownKm: Double? = nil, now: Date) {
        guard Self.follows(report.state), let schedule = TripSchedule(plan),
              let km = Self.km(of: report, on: plan)
        else { return nil }
        self.schedule = schedule
        lastKm = km
        lastAt = report.at
        startAt = report.at
        anchor(at: km, report)
        if let shownKm { smooth(from: shownKm, now: now) }
    }

    /// Take a report; false when it can no longer be followed (off its track),
    /// so the caller drops the track. Reports no newer than the last change nothing.
    mutating func update(_ report: VehicleReport, plan: TripPlan, now: Date) -> Bool {
        guard report.at > lastAt else { return true }
        guard Self.follows(report.state), let km = Self.km(of: report, on: plan) else { return false }
        let shown = self.km(at: now)
        halted = km - lastKm < Self.haltKm
        lastKm = km
        lastAt = report.at
        anchor(at: km, report)
        smooth(from: shown, now: now)
        return true
    }

    private mutating func anchor(at km: Double, _ report: VehicleReport) {
        anchorKm = km
        anchorSeconds = schedule.seconds(atKm: km)
        let hold = halted ? Self.haltHold : report.state == "at_stop" ? Self.dwell : 0
        startAt = report.at.addingTimeInterval(hold)
    }

    private mutating func smooth(from shown: Double, now: Date) {
        let lead = shown - projected(at: now)
        if abs(lead) < 0.001 {
            smoothing = .none
        } else if !halted, lead > 0, lead <= Self.holdKm {
            smoothing = .hold(shown)
        } else {
            smoothing = .ease(from: shown, at: now)
        }
    }

    /// Where the timetable puts it now, going on from the latest report.
    func projected(at now: Date) -> Double {
        let elapsed = min(max(0, now.timeIntervalSince(startAt)), Self.maxAhead)
        return max(anchorKm, schedule.km(atSeconds: anchorSeconds + elapsed))
    }

    /// Where to draw it now, km along the trip's path.
    func km(at now: Date) -> Double {
        let p = projected(at: now)
        switch smoothing {
        case .none:
            return p
        case let .hold(k):
            return max(p, k)
        case let .ease(from, at):
            let f = now.timeIntervalSince(at) / Self.ease
            guard f < 1 else { return p }
            let e = max(0, f) * max(0, f) * (3 - 2 * max(0, f))
            return from + (p - from) * e
        }
    }
}
