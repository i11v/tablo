import CoreLocation
import SwiftUI

enum VehicleKind: String, CaseIterable, Hashable, Codable {
    case tram, bus, metro, train, other

    /// The modes the map's filter toggles. Trains and everything else always show.
    static let filterable: [VehicleKind] = [.tram, .bus, .metro]

    init(wire: String) {
        self = VehicleKind(rawValue: wire) ?? .other
    }

    func isShown(in modes: [VehicleKind]) -> Bool {
        !Self.filterable.contains(self) || modes.contains(self)
    }
}

/// Reachability: how the vehicle's arrival compares with your walk to the platform.
enum Tier: Hashable {
    case make, run, miss, neutral

    /// margin = minutes until the vehicle arrives − minutes you need to walk there.
    ///   margin ≥ 2 → make · 0 ..< 2 → run · < 0 → miss
    static func reach(margin: Int) -> Tier {
        margin < 0 ? .miss : margin < 2 ? .run : .make
    }

    /// No location (walk unknown) → neutral: no urgency colour at all.
    static func reach(inMinutes: Int, walk: Int?) -> Tier {
        guard let walk else { return .neutral }
        return reach(margin: inMinutes - walk)
    }

    var color: Color {
        switch self {
        case .make: Palette.make
        case .run: Palette.run
        case .miss: Palette.miss
        case .neutral: Palette.neutral
        }
    }

    var onColor: Color {
        switch self {
        case .make, .neutral: Palette.onMake
        case .run: Palette.onRun
        case .miss: Palette.onMiss
        }
    }

    /// The pill label; empty (pill hidden) for neutral.
    var verdict: String {
        switch self {
        case .make: "CATCH"
        case .run: "RUN"
        case .miss: "MISSED"
        case .neutral: ""
        }
    }

    var glows: Bool { self != .neutral }
}

/// A WGS-84 position in the prototype's `[lng, lat]` order.
struct LngLat: Hashable {
    var lng: Double
    var lat: Double

    init(_ lng: Double, _ lat: Double) {
        self.lng = lng
        self.lat = lat
    }

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

/// One live departure as the board shows it, resolved against the clock.
struct Departure: Identifiable, Hashable {
    let route: String
    let kind: VehicleKind
    let headsign: String
    /// Platform code from the feed ("A", "1"), nil when there is none.
    let platform: String?
    let scheduled: Date
    /// predicted ?? scheduled — what the board sorts and counts down to.
    let time: Date
    /// Whole minutes until `time`, floored, never negative.
    let inMinutes: Int
    let atStop: Bool
    let delaySeconds: Double?
    /// Signed minutes against the timetable; 0 = on time.
    let delayMinutes: Int
    let tripId: String?

    var id: String {
        tripId ?? [route, headsign, platform ?? "", String(Int(scheduled.timeIntervalSince1970))].joined(separator: "|")
    }
}

/// A map pin for one platform (or the merged metro platforms).
struct Platform: Identifiable, Hashable {
    let key: String
    let short: String
    let coord: LngLat
    /// Set for platforms that belong to a single mode (the metro entrance).
    let mode: VehicleKind?

    var id: String { key }
}

/// A vehicle on the stop map.
struct MapVehicle: Hashable {
    let tripId: String
    let route: String
    let kind: VehicleKind
    let coord: LngLat
    /// The position as a timed report, when the server says when it was made.
    var report: VehicleReport? = nil
}

/// A point on a trip's path with its distance along it.
struct PathPoint: Hashable {
    let coord: LngLat
    let km: Double
}

struct JourneyStop: Hashable {
    let name: String
    let coord: LngLat
    /// When the vehicle is (or was) here: scheduled for stops behind it, plus the live delay ahead.
    let time: Date
    /// km along the journey's path.
    let km: Double
}

/// One vehicle's run through the current stop.
struct Journey: Hashable {
    let departure: Departure
    let stops: [JourneyStop]
    /// Index of the current stop in `stops`.
    let mine: Int
    /// The vehicle is between `stops[seg]` and `stops[seg + 1]`, `frac` of the way
    /// (or at `stops[seg]` when `atStop`).
    let seg: Int
    let frac: Double
    let atStop: Bool
    let tier: Tier
    /// Live delay, minutes.
    let delay: Int
    /// The trip's path (its shape, or straight lines between stops without one).
    let path: [PathPoint]
    /// Where the vehicle is along `path`, km — live when tracked, else estimated from the timetable.
    let vehicleKm: Double

    var route: String { departure.route }

    /// The letter on your stop's map plate: the platform, "M" for metro, empty for a pip.
    var markLabel: String { departure.kind == .metro ? "M" : departure.platform ?? "" }

    /// The vehicle has left your stop.
    var hasDeparted: Bool { atStop ? seg > mine : seg >= mine }
}
