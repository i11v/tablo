import Observation
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
    @ObservationIgnored private var boardHeight: CGFloat?
    /// You chose a stop yourself: location never moves you again.
    @ObservationIgnored private var userPicked = false
    @ObservationIgnored private var placedByLocation = false
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

    private enum Keys {
        static let stop = "tablo.currentStop"
        static let recents = "tablo.recentStops"
    }

    init(api: TabloAPI = TabloAPI(), defaults: UserDefaults = .standard) {
        let saved = defaults.data(forKey: Keys.stop).flatMap { try? JSONDecoder().decode(IndexStop.self, from: $0) }
        let initial = saved ?? Self.fallbackStop
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
        feed.subscribe(initial.selector)
        loadIndex()
        syncMap()
    }

    // MARK: - Lifecycle

    /// Foreground: live feed, location, clock and polling run. Background: all paused.
    func setActive(_ on: Bool) {
        guard on != active else { return }
        active = on
        if on {
            now = Date()
            feed.start()
            location.start()
            let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            clock = timer
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
        }
    }

    private func tick() {
        now = Date()
        syncMap()
    }

    func retryIndex() {
        loadIndex()
    }

    private func loadIndex() {
        indexTask?.cancel()
        indexState = .loading
        indexTask = Task { [weak self, api] in
            do {
                let stops = try await api.stopIndex()
                // the search expansion and key table are ~10k rows: build them off the main actor
                let (search, byKey) = await Task.detached(priority: .userInitiated) {
                    (StopSearch.Index(stops), Dictionary(stops.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first }))
                }.value
                guard !Task.isCancelled else { return }
                self?.indexLoaded(stops, search, byKey)
            } catch {
                guard !Task.isCancelled else { return }
                self?.indexState = .failed
            }
        }
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
        else { return }
        switchStop(to: nearest.stop, userInitiated: false)
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

    var pinLabel: String {
        isAllPlatforms ? "" : Board.platformLabel(activePlatform)
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
    /// platforms merge into one "M" pin at their mean. Coloured by each
    /// platform's lead departure.
    private func platformPins(_ deps: [Departure]) -> [Platform] {
        let shown = deps.filter { $0.kind.isShown(in: modes) }
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
            let lead = Board.lead(shown.filter { Board.platformKey($0) == key }, walk: walk)
            return Platform(
                key: key,
                short: key == "Metro" ? "M" : key,
                tier: lead.map { Tier.reach(inMinutes: $0.inMinutes, walk: walk) } ?? .neutral,
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
        return JourneyBuilder.build(plan: plan, departure: follow.departure, vehicle: follow.vehicle, stop: stop, walk: walk, now: now)
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
                railTop: first ? .clear : i <= j.seg ? Palette.railPast : Palette.railAhead,
                railBottom: last ? .clear : isPast ? Palette.railPast : Palette.railAhead
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
        guard active, follow == nil, !searchOpen else { return }
        let box = BBox.around(stop.coord)
        vehicleTask = Task { [weak self, api] in
            while !Task.isCancelled {
                var wait = Self.vehiclePoll
                do {
                    let list = try await api.vehicles(in: box)
                    guard !Task.isCancelled else { return }
                    self?.vehiclesLoaded(list)
                } catch {
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
        planTask?.cancel()
        planTask = nil
    }

    private func vehiclesLoaded(_ list: [LiveVehicle]) {
        map.setVehicles(
            list.map { MapVehicle(tripId: $0.tripId, route: $0.route, kind: $0.kind, coord: $0.coord) },
            glide: Self.vehiclePoll
        )
        mapTrips = Set(list.map(\.tripId))
        for v in list {
            if let plan = tripPlans[v.tripId] { attachPath(v.tripId, plan) }
        }
        loadVehiclePlans(list)
        syncMap()
    }

    /// Fetch the trips of the vehicles on the map so they glide along their
    /// lines — one at a time, a second apart, to leave the shared upstream
    /// budget to the boards. Trips on the board first, then nearest the stop.
    private func loadVehiclePlans(_ list: [LiveVehicle]) {
        guard planTask == nil else { return }
        let onBoard = Set(departures.compactMap(\.tripId))
        let here = stop.coord
        let wanted = list
            .filter { tripPlans[$0.tripId] == nil && !planless.contains($0.tripId) }
            .sorted { a, b in
                let ka = onBoard.contains(a.tripId), kb = onBoard.contains(b.tripId)
                if ka != kb { return ka }
                return Geo.haversineMetres(a.coord, here) < Geo.haversineMetres(b.coord, here)
            }
            .map(\.tripId)
        guard !wanted.isEmpty else { return }
        planRun += 1
        let run = planRun
        planTask = Task { [weak self, api] in
            for tripId in wanted {
                guard !Task.isCancelled, let self else { return }
                // gone from the map, or loaded meanwhile (a followed journey)
                guard mapTrips.contains(tripId), tripPlans[tripId] == nil else { continue }
                do {
                    let trip = try await api.trip(tripId)
                    guard !Task.isCancelled else { return }
                    vehiclePlanLoaded(tripId, TripPlan(trip))
                } catch APIError.notFound {
                    planless.insert(tripId)
                } catch {
                    break // transient: the next poll tries again
                }
                try? await Task.sleep(for: .seconds(1))
            }
            if self?.planRun == run { self?.planTask = nil }
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
        map.setVehiclePath(tripId, plan.path)
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
        if let j = journey { map.showJourney(j, id: tripId, sheetHeight: sheetHeight) }
    }

    private func tripFailed(_ tripId: String) {
        guard follow?.id == tripId else { return }
        follow?.trip = .failed
    }

    private func vehicleLoaded(_ tripId: String, _ vehicle: TripVehicle?) {
        guard follow?.id == tripId else { return }
        follow?.vehicle = vehicle
        if let j = journey { map.updateJourney(j) }
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
