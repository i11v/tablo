import Foundation

/// Trip plans on disk, as `/api/trips/{id}` sent them, so a relaunch attaches
/// the map's vehicles to their lines without asking again. A trip id names a
/// scheduled run, so its plan holds for the service day; each day gets its own
/// folder and older days are dropped.
struct TripPlanStore: Sendable {
    private let root: URL
    private let day: String

    init(root: URL? = nil, now: Date = Date()) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TripPlans", isDirectory: true)
        day = Self.serviceDay(now)
    }

    private static let prague = TimeZone(identifier: "Europe/Prague")!
    /// Night services past midnight still run on the previous day's timetable.
    static let dayStartHour = 4

    /// The PID service day `date` falls in, "yyyy-MM-dd" in Prague time.
    static func serviceDay(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = prague
        let shifted = date.addingTimeInterval(-Double(dayStartHour) * 3600)
        let c = calendar.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private var dir: URL { root.appendingPathComponent(day, isDirectory: true) }

    private func file(_ tripId: String) -> URL {
        let safe = tripId.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_."))) ?? tripId
        return dir.appendingPathComponent(safe + ".json")
    }

    func read(_ tripId: String) -> Data? {
        try? Data(contentsOf: file(tripId))
    }

    /// The plans on disk for `tripIds`; the ones missing or unreadable are left out.
    func plans(_ tripIds: [String]) -> [String: TripPlan] {
        var found: [String: TripPlan] = [:]
        for id in tripIds {
            if let data = read(id), let trip = try? Wire.decode(Trip.self, from: data), trip.tripId == id {
                found[id] = TripPlan(trip)
            }
        }
        return found
    }

    func write(_ data: Data, for tripId: String) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: file(tripId), options: .atomic)
    }

    /// Drops every service day but this one.
    func prune() {
        let fm = FileManager.default
        for old in (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [] where old.lastPathComponent != day {
            try? fm.removeItem(at: old)
        }
    }
}
