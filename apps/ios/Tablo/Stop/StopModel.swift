import Observation
import OpenTelemetryApi
import SwiftUI

/// One row of the departures board, already resolved against your walk time.
struct BoardRow: Identifiable {
    let departure: Departure
    let tier: Tier
    /// "nást. A" when the board shows every platform.
    let platformMeta: String
    let delayText: String
    let delayColor: Color

    var id: String { departure.id }
    /// Only departures with a trip id have a journey to follow.
    var canFollow: Bool { departure.tripId != nil }
    var hasMeta: Bool { !platformMeta.isEmpty || !delayText.isEmpty }
    var separator: String { !platformMeta.isEmpty && !delayText.isEmpty ? " · " : "" }
}

struct PlatformTab: Identifiable {
    let key: String
    let label: String
    let isOn: Bool
    var id: String { key }
}

struct JourneyRow: Identifiable {
    enum Kind {
        case stop(index: Int)
        case vehicle
    }

    let id: String
    let kind: Kind
    var name = ""
    var time = ""
    var note = ""
    var isMine = false
    var isPast = false
    var railTop: Color = .clear
    var railBottom: Color = .clear
    /// vehicle row: "Between X and Y"
    var text = ""
}

struct SearchResult: Identifiable {
    let stop: IndexStop
    /// Platform codes ("A · B · 1 · 2"), or the zone.
    let detail: String
    let walk: Int?
    let isCurrent: Bool
    var id: String { stop.key }
}

enum IndexState: Equatable {
    case loading, ready, failed
}

enum TripLoad {
    case loading
    case ready(TripPlan)
    case failed
}

/// The departure being followed: its latest feed state, its trip and live vehicle.
struct Follow {
    var departure: WireDeparture
    var trip: TripLoad
    var vehicle: TripVehicle?
    /// The vehicle followed between its reports, once the trip is ready.
    var track: VehicleTrack?

    var id: String { departure.tripId ?? "" }
}

/// The stop screen's state and behaviour — the prototype's `Component`, on live data.
@MainActor
@Observable
final class StopModel {
    static let allPlatforms = "all"
    static let defaultSheet: CGFloat = 290
    static let minSheet: CGFloat = 130
    /// Seconds between /api/vehicles polls (and the glide between fixes).
    static let vehiclePoll: TimeInterval = 10
    static let journeyPoll: TimeInterval = 10
    /// Farther than this from every stop you're outside the network: don't jump to the "nearest".
    static let nearestRadius = 5000.0
    /// Trip plans for the vehicles a poll first shows load this many at a
    /// time, up to `planBurstLimit` requests; the rest, and later arrivals,
    /// one at a time, a second apart. Every trip the worker hasn't cached
    /// spends from Golemio's 20-calls-per-8-s budget, shared with the boards:
    /// past it the worker queues calls and sheds them (503) after 5 s.
    static let planBurst = 3
    static let planBurstLimit = 12
    /// How long the first vehicle poll waits for the first location fix to
    /// pick the stop it's for, rather than poll the saved stop and drop it.
    static let placementGrace: Duration = .milliseconds(1500)
    /// The cached stop index serves at once; the manifest is checked this long after.
    static let indexRefreshDelay: Duration = .seconds(3)

    /// Národní třída — the stop shown before anything better is known.
    static let fallbackStop = IndexStop(
        name: "Národní třída", norm: "narodni trida", node: 539, stops: nil,
        lat: 50.08069, lon: 14.41992, zone: "P", disambig: nil, platforms: []
    )

    var modes: [VehicleKind] = [.tram, .bus]
    var activePlatform = StopModel.allPlatforms
    var searchOpen = false
    var query = ""
    var sheetHeight: CGFloat = StopModel.defaultSheet {
        didSet { map.setBottomInset(sheetHeight) }
    }

    private(set) var stop: IndexStop
    private(set) var indexState: IndexState = .loading
    private(set) var entries: [IndexStop] = []
    /// The 1 Hz clock every countdown reads.
    private(set) var now = Date()
    private(set) var follow: Follow?
    /// The stop nearest your location.
    private(set) var nearestKey: String?
    private(set) var recents: [String]

    let feed: DeparturesFeed
    let location: LocationService

    /// Full screen height, for the sheet's upper bound.
    @ObservationIgnored var containerHeight: CGFloat = 806
    @ObservationIgnored let map: StopMapController
    @ObservationIgnored private let api: TabloAPI
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var searchIndex: StopSearch.Index?
    @ObservationIgnored private var byKey: [String: IndexStop] = [:]
    @ObservationIgnored private var tripPlans: [String: TripPlan] = [:]
    @ObservationIgnored private let planStore = TripPlanStore()
    /// The current vehicle set's first plans are in flight or done: later ones are paced.
    @ObservationIgnored private var plansPrimed = false
    @ObservationIgnored private var boardHeight: CGFloat?
    /// You chose a stop yourself: location never moves you again.
    @ObservationIgnored private var userPicked = false
    @ObservationIgnored private var placedByLocation = false
    /// The first fix had its chance to pick the stop: polling waits no longer.
    @ObservationIgnored private var placementGraceOver = false
    @ObservationIgnored private var placementGraceTask: Task<Void, Never>?
    @ObservationIgnored private var active = false
    @ObservationIgnored private var clock: Timer?
    @ObservationIgnored private var indexTask: Task<Void, Never>?
    @ObservationIgnored private var vehicleTask: Task<Void, Never>?
    @ObservationIgnored private var journeyTask: Task<Void, Never>?
    @ObservationIgnored private var planTask: Task<Void, Never>?
    @ObservationIgnored private var planRun = 0
    /// Trips with no plan upstream (404): not asked for again.
    @ObservationIgnored private var planless: Set<String> = []
    /// Trips of the vehicles on the map right now.
    @ObservationIgnored private var mapTrips: Set<String> = []
    /// The launch or resume being traced, until the page settles.
    @ObservationIgnored private var phase: PhaseTrace?
    /// Open while the phase waits for its first location fix / the stop's board.
    @ObservationIgnored private var fixWait: Span?
    @ObservationIgnored private var boardWait: Span?
    @ObservationIgnored private var backgroundAt: Date?

    private enum Keys {
        static let stop = "tablo.currentStop"
        static let recents = "tablo.recentStops"
    }

    init(api: TabloAPI = TabloAPI(), defaults: UserDefaults = .standard) {
        let saved = defaults.data(forKey: Keys.stop).flatMap { try? JSONDecoder().decode(IndexStop.self, from: $0) }
        let initial = saved ?? Self.fallbackStop
        let prewarmed = ProcessInfo.processInfo.environment["ActivePrewarm"] == "1"
        // a prewarmed process started long before you tapped the icon
        let launched = prewarmed ? Date() : Telemetry.processStart
        self.api = api
        self.defaults = defaults
        stop = initial
        recents = defaults.stringArray(forKey: Keys.recents) ?? []
        feed = DeparturesFeed(base: api.base)
        location = LocationService()
        map = StopMapController(activeModes: [.tram, .bus], center: initial.coord)

        map.setBottomInset(sheetHeight)
        map.setStop(initial.coord, name: initial.name)
        map.onSelectPlatform = { [weak self] key in
            guard let self, follow == nil else { return }
            selectPlatform(key)
        }
        map.onVehicle = { [weak self] tripId in
            guard let self, let d = departures.first(where: { $0.tripId == tripId }) else { return }
            openJourney(d)
        }
        feed.onUpdate = { [weak self] in self?.feedUpdated() }
        location.onChange = { [weak self] in self?.locationChanged() }
        phase = PhaseTrace(.launch, start: launched, attributes: [
            "tablo.prewarmed": .bool(prewarmed),
            "tablo.saved_stop": .bool(saved != nil),
            "stop.name": .string(initial.name),
        ]) { [weak self] in self?.phaseEnded() }
        phase?.event("model.init")
        feed.subscribe(initial.selector)
        loadIndex()
        syncMap()
        Task.detached(priority: .utility) { [planStore] in planStore.prune() }
    }

    // MARK: - Lifecycle

    /// Foreground: live feed, location, clock and polling run. Background: all paused.
    func setActive(_ on: Bool) {
        guard on != active else { return }
        active = on
        if on {
            now = Date()
            beginPhase()
            feed.start()
            location.start()
            let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            clock = timer
            startPlacementGrace()
            restartVehiclePolling()
            startJourneyPolling()
            if indexState == .failed { loadIndex() }
            syncMap()
        } else {
            feed.stop()
            location.stop()
            clock?.invalidate()
            clock = nil
            stopVehiclePolling()
            journeyTask?.cancel()
            phase?.end("background")
            backgroundAt = Date()
            Telemetry.flushInBackground()
        }
    }

    // MARK: - Tracing

    /// Coming to the foreground: the launch trace is already open; a return
    /// from the background starts a resume trace.
    private func beginPhase() {
        if let backgroundAt {
            phase = PhaseTrace(.resume, attributes: [
                "tablo.background_s": .int(Int(Date().timeIntervalSince(backgroundAt))),
                "stop.name": .string(stop.name),
                "tablo.has_location": .bool(location.coordinate != nil),
            ]) { [weak self] in self?.phaseEnded() }
        } else {
            phase?.event("active")
        }
        guard let phase else { return }
        if location.coordinate == nil {
            fixWait = Telemetry.span("location.first_fix", parent: phase.span)
        }
        awaitBoard()
    }

    /// A span from now until the current stop's board arrives.
    private func awaitBoard() {
        guard let phase, boardWait == nil else { return }
        boardWait = Telemetry.span("feed.board", parent: phase.span, attributes: ["stop.name": .string(stop.name)])
    }

    private func phaseEnded() {
        for wait in [fixWait, boardWait].compactMap({ $0 }) {
            wait.setAttribute(key: "tablo.outcome", value: "unfinished")
            wait.end()
        }
        fixWait = nil
        boardWait = nil
        phase = nil
    }

    private func tick() {
        now = Date()
        syncMap()
    }

    func retryIndex() {
        loadIndex()
    }

    /// The newest cached index serves at once; the network only when there's
    /// none. A cached one is checked against the manifest a little later.
    private func loadIndex() {
        indexTask?.cancel()
        indexState = .loading
        let span = Telemetry.span("index.load", parent: phase?.span)
        indexTask = Task { [weak self, api] in
            var cached = false
            do {
                var stops = await api.cachedStopIndex(parent: span)
                cached = stops != nil
                if stops == nil { stops = try await api.stopIndex(parent: span) }
                let all = stops ?? []
                span.setAttribute(key: "index.stops", value: all.count)
                let (search, byKey) = await Self.buildIndex(all, parent: span)
                span.end()
                guard !Task.isCancelled else { return }
                self?.indexLoaded(all, search, byKey)
            } catch {
                span.fail(error)
                span.end()
                guard !Task.isCancelled else { return }
                self?.indexState = .failed
                return
            }
            guard cached, !Task.isCancelled else { return }
            try? await Task.sleep(for: Self.indexRefreshDelay)
            guard !Task.isCancelled else { return }
            await self?.refreshIndex()
        }
    }

    /// Swap in a newer index if the manifest names one; the cached one stays otherwise.
    private func refreshIndex() async {
        let span = Telemetry.span("index.refresh", parent: phase?.span)
        defer { span.end() }
        do {
            guard let stops = try await api.stopIndex(unlessCached: true, parent: span) else {
                span.setAttribute(key: "index.changed", value: false)
                return
            }
            span.setAttribute(key: "index.changed", value: true)
            span.setAttribute(key: "index.stops", value: stops.count)
            let (search, byKey) = await Self.buildIndex(stops, parent: span)
            guard !Task.isCancelled else { return }
            indexLoaded(stops, search, byKey)
        } catch {
            span.fail(error)
        }
    }

    /// The search expansion and key table are ~10k rows: built off the main actor.
    private nonisolated static func buildIndex(_ stops: [IndexStop], parent: Span) async -> (StopSearch.Index, [String: IndexStop]) {
        let build = Telemetry.span("index.build", parent: parent)
        defer { build.end() }
        return await Task.detached(priority: .userInitiated) {
            (StopSearch.Index(stops), Dictionary(stops.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first }))
        }.value
    }

    private func indexLoaded(_ stops: [IndexStop], _ search: StopSearch.Index, _ byKey: [String: IndexStop]) {
        entries = stops
        searchIndex = search
        self.byKey = byKey
        indexState = .ready
        // the index's copy of the current stop is fresher (platforms, coordinates)
        if let fresh = byKey[stop.key], fresh != stop {
            stop = fresh
            save(fresh)
            map.setStop(fresh.coord, name: fresh.name)
        }
        updateNearest()
        placeByLocation()
        syncMap()
    }

    // MARK: - Location

    private func locationChanged() {
        if let fixWait, location.coordinate != nil {
            fixWait.end()
            self.fixWait = nil
        }
        updateNearest()
        placeByLocation()
        syncMap()
    }

    private func updateNearest() {
        guard let here = location.coordinate, !entries.isEmpty else {
            nearestKey = nil
            return
        }
        let key = StopSearch.nearest(entries, to: here, limit: 1).first?.stop.key
        if key != nearestKey { nearestKey = key }
    }

    /// On the first fix, start at the stop nearest you — unless you've already picked one.
    private func placeByLocation() {
        guard !userPicked, !placedByLocation, let here = location.coordinate, !entries.isEmpty else { return }
        placedByLocation = true
        guard let nearest = StopSearch.nearest(entries, to: here, limit: 1).first,
              nearest.metres <= Self.nearestRadius, nearest.stop.key != stop.key
        else {
            // staying put: the poll held back for this can start
            if vehicleTask == nil { restartVehiclePolling() }
            return
        }
        switchStop(to: nearest.stop, userInitiated: false)
    }

    /// The first fix may still move you to another stop, so a poll for this
    /// one would be thrown away.
    private var awaitingPlacement: Bool {
        !userPicked && !placedByLocation && !placementGraceOver && location.mayLocate
    }

    /// Bounds how long the first poll waits on placement (no fix, no index yet).
    private func startPlacementGrace() {
        guard !placementGraceOver, placementGraceTask == nil else { return }
        placementGraceTask = Task { [weak self] in
            try? await Task.sleep(for: Self.placementGrace)
            guard let self, !placementGraceOver else { return }
            placementGraceOver = true
            if vehicleTask == nil { restartVehiclePolling() }
        }
    }

    // MARK: - Derived

    var currentStop: IndexStop { stop }
    var walk: Int? { location.coordinate.map { Geo.walkMinutes(from: $0, to: stop.coord) } }
    var isNearest: Bool { nearestKey == stop.key }
    var isAllPlatforms: Bool { activePlatform == Self.allPlatforms }
    var hasBoard: Bool { feed.boards[stop.key] != nil }

    var departures: [Departure] {
        Board.departures(feed.boards[stop.key] ?? [], now: now)
    }

    /// Under a filtered board: "nást. A only · Bílá Hora · Zvonařka".
    var filterNote: String {
        guard !isAllPlatforms else { return "" }
        let (lead, rest) = board
        var dests: [String] = []
        for row in [lead].compactMap({ $0 }) + rest where !dests.contains(row.departure.headsign) && dests.count < 3 {
            dests.append(row.departure.headsign)
        }
        guard !dests.isEmpty else { return "" }
        return (["\(Board.platformLabel(activePlatform)) only"] + dests).joined(separator: " · ")
    }

    private var modeFiltered: [Departure] {
        departures.filter { $0.kind.isShown(in: modes) }
    }

    private func row(_ d: Departure) -> BoardRow {
        let showPlatform = isAllPlatforms && d.kind != .metro && d.platform != nil
        return BoardRow(
            departure: d,
            tier: Tier.reach(inMinutes: d.inMinutes, walk: walk),
            platformMeta: showPlatform ? "nást. \(d.platform ?? "")" : "",
            delayText: Board.delayText(d.delayMinutes),
            delayColor: d.delayMinutes > 0 ? Palette.late : Palette.early
        )
    }

    /// The lead departure is the first one you can still catch; up to eight follow.
    var board: (lead: BoardRow?, rest: [BoardRow]) {
        let all = modeFiltered
        let list = isAllPlatforms ? all : all.filter { Board.platformKey($0) == activePlatform }
        let lead = Board.lead(list, walk: walk)
        let rest = list.filter { $0.id != lead?.id }.prefix(8).map(row)
        return (lead.map(row), rest)
    }

    /// The quiet line the board shows instead of (or above) its rows — never a blank sheet.
    var boardMessage: String? {
        guard hasBoard else {
            return feed.status == .reconnecting ? "Reconnecting to live departures…" : "Loading departures…"
        }
        let list = modeFiltered
        let shown = isAllPlatforms ? list : list.filter { Board.platformKey($0) == activePlatform }
        if !shown.isEmpty {
            switch feed.status {
            case .reconnecting: return "Reconnecting · showing the last update"
            case .degraded: return "Live times may be delayed"
            default: return nil
            }
        }
        if departures.isEmpty { return "No departures in the next 90 minutes." }
        if list.isEmpty { return "Nothing for the modes you've picked right now." }
        return "No departures from \(Board.platformLabel(activePlatform)) right now."
    }

    var platformTabs: [PlatformTab] {
        var keys = Board.platformKeys(modeFiltered)
        if !isAllPlatforms, !keys.contains(activePlatform) { keys.append(activePlatform) }
        guard keys.count > 1 || !isAllPlatforms else { return [] }
        return ([Self.allPlatforms] + keys).map { k in
            PlatformTab(
                key: k,
                label: k == Self.allPlatforms ? "All" : Board.platformLabel(k),
                isOn: k == activePlatform
            )
        }
    }

    /// Pins for the current stop's platforms that have coordinates; metro
    /// platforms merge into one "M" pin at their mean.
    private func platformPins(_ deps: [Departure]) -> [Platform] {
        // metro platforms: seen with metro departures, or in ASW's metro stop-id range (101–199)
        let metro = Set(deps.filter { $0.kind == .metro }.compactMap(\.platform))
            .union(stop.platforms.filter { (101 ... 199).contains($0.stop) }.map(\.code))
        var order: [String] = []
        var coords: [String: [LngLat]] = [:]
        for p in stop.platforms {
            guard let c = p.coord else { continue }
            let key = metro.contains(p.code) ? "Metro" : p.code
            if coords[key] == nil { order.append(key) }
            coords[key, default: []].append(c)
        }
        return order.compactMap { key in
            guard let coord = Geo.mean(coords[key] ?? []) else { return nil }
            return Platform(
                key: key,
                short: key == "Metro" ? "M" : key,
                coord: coord,
                mode: key == "Metro" ? .metro : nil
            )
        }
    }

    // MARK: Journey

    /// The followed departure, live.
    var followDeparture: Departure? {
        follow.map { Board.resolve($0.departure, now: now) }
    }

    var journey: Journey? {
        guard let follow, case let .ready(plan) = follow.trip else { return nil }
        return JourneyBuilder.build(
            plan: plan, departure: follow.departure, vehicle: follow.vehicle, trackKm: follow.track?.km(at: now),
            stop: stop, walk: walk, now: now
        )
    }

    var journeyMessage: String? {
        guard let follow else { return nil }
        switch follow.trip {
        case .loading: return "Loading journey…"
        case .failed: return "Journey unavailable"
        case .ready: return journey == nil ? "Journey unavailable" : nil
        }
    }

    func journeyRows(_ j: Journey) -> [JourneyRow] {
        let d = j.departure
        var rows: [JourneyRow] = []
        for (i, s) in j.stops.enumerated() {
            let isMine = i == j.mine
            let isPast = j.atStop ? i < j.seg : i <= j.seg
            let first = i == 0, last = i == j.stops.count - 1
            var note = ""
            if isMine {
                let here = j.atStop && j.seg == j.mine
                note = here
                    ? "Your stop · at the platform now"
                    : ["Your stop", d.kind == .metro ? "metro" : d.platform.map { "nást. \($0)" } ?? "", walk.map { "\($0) min walk" } ?? ""]
                    .filter { !$0.isEmpty }.joined(separator: " · ")
            } else if last {
                note = "Terminus"
            }
            rows.append(JourneyRow(
                id: "stop-\(i)", kind: .stop(index: i), name: s.name, time: JourneyBuilder.clock(s.time), note: note,
                isMine: isMine, isPast: isPast,
                railTop: first ? .clear : i <= j.seg ? Palette.edge : Palette.meta,
                railBottom: last ? .clear : isPast ? Palette.edge : Palette.meta
            ))
            // the vehicle's row: between two stops, or standing at one (your stop says so itself)
            if i == j.seg, !(j.atStop && i == j.mine) {
                let next = j.stops.indices.contains(i + 1) ? j.stops[i + 1].name : nil
                rows.append(JourneyRow(
                    id: "vehicle", kind: .vehicle,
                    text: j.atStop ? "At \(s.name)" : next.map { "Between \(s.name) and \($0)" } ?? "At \(s.name)"
                ))
            }
        }
        return rows
    }

    func journeySummary(_ j: Journey) -> (text: String, delay: String, delayColor: Color) {
        let terminus = j.stops[j.stops.count - 1]
        let ahead = j.stops.count - 1 - j.mine
        let stops = ahead == 1 ? "1 stop" : "\(ahead) stops"
        let text = "Here \(JourneyBuilder.clock(j.stops[j.mine].time)) · \(stops) to \(terminus.name), \(JourneyBuilder.clock(terminus.time))"
        let delay = j.delay != 0 ? " · \(j.delay > 0 ? "+" : "")\(j.delay) min" : ""
        return (text, delay, j.delay > 0 ? Palette.late : Palette.early)
    }

    // MARK: Search

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var searchTitle: String {
        guard trimmedQuery.isEmpty else { return "RESULTS" }
        return location.coordinate != nil ? "NEARBY STOPS" : "RECENT"
    }

    /// Nearby stops (or recents) for an empty query; ranked matches otherwise.
    var searchResults: [SearchResult] {
        guard indexState == .ready, let searchIndex else { return [] }
        let here = location.coordinate
        let q = trimmedQuery
        let found: [IndexStop]
        if !q.isEmpty {
            found = StopSearch.search(searchIndex, query: q, recents: recents, origin: here)
        } else if let here {
            found = StopSearch.nearest(entries, to: here, limit: 8).map(\.stop)
        } else {
            found = recents.compactMap { byKey[$0] }
        }
        return found.map { s in
            SearchResult(
                stop: s,
                detail: Self.detail(s),
                walk: here.map { Geo.walkMinutes(from: $0, to: s.coord) },
                isCurrent: s.key == stop.key
            )
        }
    }

    nonisolated static func detail(_ s: IndexStop) -> String {
        var codes: [String] = []
        for p in s.platforms where !codes.contains(p.code) { codes.append(p.code) }
        if !codes.isEmpty { return codes.joined(separator: " · ") }
        return s.zone.map { "Zone \($0)" } ?? ""
    }

    /// The line under the results when there's nothing to list.
    func searchMessage(resultCount: Int) -> String? {
        switch indexState {
        case .loading: return "Loading the stop list…"
        case .failed: return nil
        case .ready:
            guard resultCount == 0 else { return nil }
            let q = trimmedQuery
            return q.isEmpty ? "Recent stops appear here." : "No stops match \u{201C}\(q)\u{201D}."
        }
    }

    var maxSheet: CGFloat { containerHeight - 62 }

    // MARK: - Actions

    func openSearch() {
        query = ""
        searchOpen = true
        phase?.end("search")
        stopVehiclePolling()
    }

    func closeSearch() {
        searchOpen = false
        query = ""
        restartVehiclePolling()
    }

    func pickStop(_ entry: IndexStop) {
        switchStop(to: entry, userInitiated: true)
    }

    /// `sheet` overrides the sheet height the switch would otherwise pick.
    private func switchStop(to entry: IndexStop, userInitiated: Bool, sheet: CGFloat? = nil) {
        if userInitiated {
            userPicked = true
            recents = Array(([entry.key] + recents.filter { $0 != entry.key }).prefix(8))
            defaults.set(recents, forKey: Keys.recents)
            searchOpen = false
            query = ""
        }
        phase?.stopSwitched(from: stop.name, to: entry.name, reason: userInitiated ? "user" : "location")
        // size the sheet first: the map frames the stop against its final height
        if let sheet {
            setSheet(sheet)
        } else if let boardHeight, follow != nil {
            setSheet(boardHeight)
        } else {
            setSheet(sheetHeight > 520 ? Self.defaultSheet : sheetHeight)
        }
        journeyTask?.cancel()
        follow = nil
        map.clearJourney(silent: true)
        map.setSelected(nil)
        activePlatform = Self.allPlatforms
        stop = entry
        save(entry)
        feed.subscribe(entry.selector)
        if let boardWait {
            boardWait.addEvent(name: "stop.switch", attributes: ["stop.to": .string(entry.name)])
        } else {
            awaitBoard()
        }
        map.setStop(entry.coord, name: entry.name)
        map.flyToStop(duration: 0.9)
        map.setVehicles([], glide: 0)
        restartVehiclePolling()
        syncMap()
    }

    private func save(_ entry: IndexStop) {
        if let data = try? JSONEncoder().encode(entry) { defaults.set(data, forKey: Keys.stop) }
    }

    func toggleMode(_ kind: VehicleKind) {
        if let i = modes.firstIndex(of: kind) { modes.remove(at: i) } else { modes.append(kind) }
        map.setModes(modes)
        syncMap()
    }

    func selectPlatform(_ key: String) {
        activePlatform = key
        map.setSelected(key == Self.allPlatforms ? nil : key)
        guard key != Self.allPlatforms else { return }
        // size the sheet first: the map centres the platform above its final height
        if sheetHeight < 460 { setSheet(460) }
        map.focusPlatform(key)
    }

    func tapTab(_ tab: PlatformTab) {
        selectPlatform(tab.isOn ? Self.allPlatforms : tab.key)
    }

    func openJourney(_ d: Departure) {
        guard let tripId = d.tripId,
              let wire = feed.boards[stop.key]?.first(where: { $0.tripId == tripId })
        else { return }
        boardHeight = sheetHeight
        let h = max(380, min(sheetHeight, 520))
        let trip: TripLoad = tripPlans[tripId].map { .ready($0) } ?? .loading
        withAnimation(.easeOut(duration: 0.18)) { follow = Follow(departure: wire, trip: trip, vehicle: nil) }
        setSheet(h)
        map.setSelected(nil)
        phase?.end("journey")
        stopVehiclePolling()
        if let j = journey { map.showJourney(j, id: tripId, sheetHeight: h) }
        startJourneyPolling()
    }

    func closeJourney() {
        journeyTask?.cancel()
        withAnimation(.easeOut(duration: 0.18)) { follow = nil }
        setSheet(boardHeight ?? Self.defaultSheet)
        map.clearJourney()
        map.setSelected(isAllPlatforms ? nil : activePlatform)
        restartVehiclePolling()
        syncMap()
    }

    func focusJourneyStop(_ index: Int) {
        map.focusStop(index)
    }

    /// The locate button: jump to the stop nearest you; already there (or no fix), frame it again.
    /// Either way the sheet drops to its minimum so the map move is visible.
    func recenter() {
        if let here = location.coordinate, !entries.isEmpty,
           let nearest = StopSearch.nearest(entries, to: here, limit: 1).first,
           nearest.metres <= Self.nearestRadius, nearest.stop.key != stop.key {
            switchStop(to: nearest.stop, userInitiated: true, sheet: Self.minSheet)
        } else {
            setSheet(Self.minSheet)
            map.recenter(sheetHeight: sheetHeight)
        }
    }

    // MARK: - Live data

    private func feedUpdated() {
        if let board = feed.boards[stop.key] {
            if let boardWait {
                boardWait.setAttribute(key: "departures", value: board.count)
                boardWait.end()
                self.boardWait = nil
            }
            phase?.boardShown()
        }
        // keep the followed departure fresh while it's on the board (it may leave once it departs)
        if let tripId = follow?.departure.tripId,
           let fresh = feed.boards[stop.key]?.first(where: { $0.tripId == tripId }) {
            follow?.departure = fresh
        }
        syncMap()
    }

    /// Push the derived state the map draws: pins, vehicle tiers, the journey.
    private func syncMap() {
        let deps = departures
        map.setPlatforms(platformPins(deps))
        let walk = walk
        var tiers: [String: Tier] = [:]
        for d in deps {
            if let id = d.tripId, tiers[id] == nil { tiers[id] = Tier.reach(inMinutes: d.inMinutes, walk: walk) }
        }
        map.setVehicleTiers(tiers)
        if let j = journey { map.updateJourney(j) }
    }

    /// Vehicles around the stop every 10 s while the board is up; none on failure
    /// (production before the endpoint ships answers 404/500).
    private func restartVehiclePolling() {
        stopVehiclePolling()
        guard active, follow == nil, !searchOpen, !awaitingPlacement else { return }
        plansPrimed = false
        let box = BBox.around(stop.coord)
        let stopName = stop.name
        vehicleTask = Task { [weak self, api] in
            while !Task.isCancelled {
                var wait = Self.vehiclePoll
                let span = Telemetry.span("vehicles.poll", parent: self?.phase?.span, attributes: ["stop.name": .string(stopName)])
                do {
                    let list = try await api.vehicles(in: box, parent: span)
                    span.setAttribute(key: "vehicles", value: list.count)
                    span.end()
                    guard !Task.isCancelled else { return }
                    self?.phase?.vehiclesShown(list.count)
                    self?.vehiclesLoaded(list)
                } catch {
                    span.fail(error)
                    span.end()
                    guard !Task.isCancelled else { return }
                    self?.vehiclesLoaded([])
                    wait = 30
                }
                try? await Task.sleep(for: .seconds(wait))
            }
        }
    }

    private func stopVehiclePolling() {
        vehicleTask?.cancel()
        vehicleTask = nil
        planTask?.cancel()
        planTask = nil
    }

    private func vehiclesLoaded(_ list: [LiveVehicle]) {
        map.setVehicles(
            list.map { MapVehicle(tripId: $0.tripId, route: $0.route, kind: $0.kind, coord: $0.coord, report: $0.report) },
            glide: Self.vehiclePoll
        )
        mapTrips = Set(list.map(\.tripId))
        for v in list {
            if let plan = tripPlans[v.tripId] { attachPath(v.tripId, plan) }
        }
        loadVehiclePlans(list)
        syncMap()
    }

    /// Board trips first, then the vehicles nearest the stop.
    nonisolated static func planOrder(_ vehicles: [LiveVehicle], onBoard: Set<String>, near here: LngLat) -> [String] {
        vehicles
            .sorted { a, b in
                let ka = onBoard.contains(a.tripId), kb = onBoard.contains(b.tripId)
                if ka != kb { return ka }
                return Geo.haversineMetres(a.coord, here) < Geo.haversineMetres(b.coord, here)
            }
            .map(\.tripId)
    }

    private enum PlanFetch {
        case plan(TripPlan)
        case planless
        case failed
    }

    /// Fetch the trips of the vehicles on the map so they glide along their
    /// lines, in `planOrder`. Plans fetched earlier today come off disk. The
    /// first vehicles a poll shows load `planBurst` at a time; later arrivals
    /// one at a time, a second apart, to leave the shared upstream budget to
    /// the boards.
    private func loadVehiclePlans(_ list: [LiveVehicle]) {
        guard planTask == nil else { return }
        let onBoard = Set(departures.compactMap(\.tripId))
        let wanted = Self.planOrder(
            list.filter { tripPlans[$0.tripId] == nil && !planless.contains($0.tripId) },
            onBoard: onBoard, near: stop.coord
        )
        let first = !plansPrimed
        plansPrimed = true
        guard !wanted.isEmpty else {
            phase?.plansReady()
            return
        }
        planRun += 1
        let run = planRun
        let span = Telemetry.span("plans.load", parent: phase?.span, attributes: [
            "plans.wanted": .int(wanted.count), "plans.on_board": .int(wanted.filter(onBoard.contains).count),
            "plans.concurrency": .int(first ? Self.planBurst : 1),
        ])
        planTask = Task { [weak self, api, planStore] in
            var loaded = 0, planless = 0, stored = 0, outcome = "done"
            var width = first ? Self.planBurst : 1
            var burst = first ? Self.planBurstLimit : 0
            defer {
                span.setAttribute(key: "plans.loaded", value: loaded)
                span.setAttribute(key: "plans.planless", value: planless)
                span.setAttribute(key: "plans.stored", value: stored)
                span.setAttribute(key: "tablo.outcome", value: Task.isCancelled ? "cancelled" : outcome)
                span.end()
            }
            let onDisk = await Task.detached(priority: .userInitiated) { planStore.plans(wanted) }.value
            guard !Task.isCancelled, let self else { return }
            for id in wanted {
                guard let plan = onDisk[id], mapTrips.contains(id), tripPlans[id] == nil else { continue }
                vehiclePlanLoaded(id, plan)
                stored += 1
            }
            var queue = wanted.filter { onDisk[$0] == nil }[...]
            await withTaskGroup(of: (String, PlanFetch).self) { group in
                var running = 0
                var failed = false
                while true {
                    while !failed, running < width, let id = queue.popFirst() {
                        // gone from the map, or loaded meanwhile (a followed journey)
                        guard self.mapTrips.contains(id), self.tripPlans[id] == nil else { continue }
                        running += 1
                        burst -= 1
                        if burst <= 0 { width = 1 }
                        group.addTask {
                            do {
                                let (trip, data) = try await api.tripResponse(id, parent: span)
                                planStore.write(data, for: id)
                                return (id, .plan(TripPlan(trip)))
                            } catch APIError.notFound {
                                return (id, .planless)
                            } catch {
                                return (id, .failed)
                            }
                        }
                    }
                    guard let (id, result) = await group.next() else { return }
                    running -= 1
                    guard !Task.isCancelled else { return }
                    switch result {
                    case let .plan(plan):
                        self.vehiclePlanLoaded(id, plan)
                        loaded += 1
                    case .planless:
                        self.planless.insert(id)
                        planless += 1
                    case .failed:
                        outcome = "error"
                        failed = true // transient: the next poll tries again
                    }
                    if width == 1, !failed, !queue.isEmpty { try? await Task.sleep(for: .seconds(1)) }
                }
            }
            guard !Task.isCancelled else { return }
            if outcome == "done" { phase?.plansReady() }
            if planRun == run { planTask = nil }
        }
    }

    private func vehiclePlanLoaded(_ tripId: String, _ plan: TripPlan) {
        if tripPlans.count >= 300 {
            // keep what's on the map or followed; let the rest go
            tripPlans = tripPlans.filter { mapTrips.contains($0.key) || $0.key == follow?.id }
        }
        tripPlans[tripId] = plan
        attachPath(tripId, plan)
    }

    /// Only a real shape: a plan drawn stop to stop would cut corners too.
    private func attachPath(_ tripId: String, _ plan: TripPlan) {
        guard plan.trip.shape.count > 1 else { return }
        map.setVehiclePlan(tripId, plan)
    }

    /// Load the followed trip (cached by id), then poll its vehicle every 10 s.
    private func startJourneyPolling() {
        journeyTask?.cancel()
        guard active, let follow, let tripId = follow.departure.tripId else { return }
        let needsTrip: Bool
        if case .ready = follow.trip { needsTrip = false } else { needsTrip = true }
        journeyTask = Task { [weak self, api] in
            if needsTrip {
                do {
                    let trip = try await api.trip(tripId)
                    guard !Task.isCancelled else { return }
                    self?.tripLoaded(tripId, TripPlan(trip))
                } catch {
                    guard !Task.isCancelled else { return }
                    self?.tripFailed(tripId)
                    return
                }
            }
            while !Task.isCancelled {
                do {
                    let vehicle = try await api.tripVehicle(tripId)
                    guard !Task.isCancelled else { return }
                    self?.vehicleLoaded(tripId, vehicle)
                } catch {
                    // transient: keep the last fix
                }
                try? await Task.sleep(for: .seconds(Self.journeyPoll))
            }
        }
    }

    private func tripLoaded(_ tripId: String, _ plan: TripPlan) {
        tripPlans[tripId] = plan
        guard follow?.id == tripId else { return }
        follow?.trip = .ready(plan)
        updateFollowTrack()
        if let j = journey { map.showJourney(j, id: tripId, sheetHeight: sheetHeight) }
    }

    private func tripFailed(_ tripId: String) {
        guard follow?.id == tripId else { return }
        follow?.trip = .failed
    }

    private func vehicleLoaded(_ tripId: String, _ vehicle: TripVehicle?) {
        guard follow?.id == tripId else { return }
        follow?.vehicle = vehicle
        updateFollowTrack()
        if let j = journey { map.updateJourney(j) }
    }

    /// Carry the followed vehicle's track over to its latest report (or start one).
    private func updateFollowTrack() {
        guard case let .ready(plan)? = follow?.trip, let report = follow?.vehicle?.report else {
            follow?.track = nil
            return
        }
        let now = Date()
        if var track = follow?.track, track.update(report, plan: plan, now: now) {
            follow?.track = track
        } else {
            follow?.track = VehicleTrack(plan: plan, report: report, now: now)
        }
    }

    // MARK: - Sheet

    func setSheet(_ h: CGFloat) {
        withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.34)) {
            sheetHeight = min(max(h, Self.minSheet), maxSheet)
        }
    }

    func dragSheet(to h: CGFloat) {
        sheetHeight = min(max(h, Self.minSheet), maxSheet)
    }
}
