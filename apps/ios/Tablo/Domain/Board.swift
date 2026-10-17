import Foundation

/// The departures board's view-model logic — a port of the web's `departureVM.ts`
/// and the platform helpers in `stop.ts`.
enum Board {
    /// Departures this far in the past drop off the board.
    static let goneAfter: TimeInterval = 30

    /// One feed departure against the clock (kept even once it has gone).
    static func resolve(_ d: WireDeparture, now: Date) -> Departure {
        let time = d.predicted ?? d.scheduled
        let diff = time.timeIntervalSince(now)
        return Departure(
            route: d.route,
            kind: d.kind,
            headsign: d.headsign,
            platform: d.platform.flatMap { $0.isEmpty || $0 == "–" ? nil : $0 },
            scheduled: d.scheduled,
            time: time,
            // floor, not round: a departure 90 s out reads "1 min", and the reach
            // margin built on it never claims half a minute the rider doesn't have
            inMinutes: max(0, Int((diff / 60).rounded(.down))),
            atStop: d.isAtStop,
            delaySeconds: d.delaySeconds,
            delayMinutes: d.delaySeconds.map { Geo.jsRound($0 / 60) } ?? 0,
            tripId: d.tripId
        )
    }

    /// Board rows: canceled and gone (> 30 s past) dropped, sorted by predicted ?? scheduled.
    static func departures(_ feed: [WireDeparture], now: Date) -> [Departure] {
        feed.enumerated()
            .filter { !$0.element.isCanceled && ($0.element.predicted ?? $0.element.scheduled).timeIntervalSince(now) >= -goneAfter }
            .map { (offset: $0.offset, departure: resolve($0.element, now: now)) }
            .sorted { ($0.departure.time, $0.offset) < ($1.departure.time, $1.offset) }
            .map(\.departure)
    }

    /// "+2 min" / "-1 min"; empty when on time.
    static func delayText(_ minutes: Int) -> String {
        minutes > 0 ? "+\(minutes) min" : minutes < 0 ? "\(minutes) min" : ""
    }

    /// The key a departure files under in the platform filter: metro collapses
    /// to "Metro"; departures without a platform have none.
    static func platformKey(_ d: Departure) -> String? {
        d.kind == .metro ? "Metro" : d.platform
    }

    /// "nást. A", or "Metro".
    static func platformLabel(_ key: String) -> String {
        key == "Metro" ? "Metro" : "nást. \(key)"
    }

    /// The lead is the first departure you can still catch, else the first.
    static func lead(_ list: [Departure], walk: Int?) -> Departure? {
        list.first { Tier.reach(inMinutes: $0.inMinutes, walk: walk) != .miss } ?? list.first
    }

    /// Platform keys present on a board, letters and numbers in natural order, Metro last.
    static func platformKeys(_ list: [Departure]) -> [String] {
        let keys = Set(list.compactMap(platformKey))
        return keys.sorted { a, b in
            if (a == "Metro") != (b == "Metro") { return b == "Metro" }
            return a.localizedStandardCompare(b) == .orderedAscending
        }
    }
}
