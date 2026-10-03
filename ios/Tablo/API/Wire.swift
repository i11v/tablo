import Foundation

// Every payload the app reads from or sends to the tablo backend
// (packages/contract/src). Field names live only in this file, so a backend
// rename is a CodingKeys change here and nowhere else.

// MARK: - Stop index

/// GET /data/stops-manifest.json — points at the current content-hashed index.
struct StopsManifest: Decodable, Equatable {
    let path: String
    let generatedAt: String
    let count: Int
}

/// GET <manifest.path> — every stop the app can show, ~8.5k entries.
struct StopIndexFile: Decodable {
    let version: Int
    let generatedAt: String
    let stops: [IndexStop]

    private enum CodingKeys: String, CodingKey { case version, generatedAt, stops }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        generatedAt = try c.decode(String.self, forKey: .generatedAt)
        // one malformed entry shouldn't cost the whole index
        stops = try c.decode(Lossy<IndexStop>.self, forKey: .stops).values
    }
}

/// One named stop (an ASW node, or the stops of a node that share a name).
struct IndexStop: Codable, Hashable, Identifiable {
    let name: String
    /// fold(name) — the search field.
    let norm: String
    let node: Int
    /// nil = the whole node; else the stop ids this name covers.
    let stops: [Int]?
    let lat: Double
    let lon: Double
    let zone: String?
    let disambig: String?
    let platforms: [IndexPlatform]

    var id: String { key }
    var selector: StopSelector { StopSelector(node: node, stops: stops) }
    /// The selector key — the board's id on the wire.
    var key: String { selector.key }
    var coord: LngLat { LngLat(lon, lat) }
}

struct IndexPlatform: Codable, Hashable {
    /// platform_code: "A".."H", "1", "2"
    let code: String
    /// asw_stop_id within the node.
    let stop: Int
    /// Where the platform is. Newer indexes only — absent until production's is rebuilt.
    let lat: Double?
    let lon: Double?

    var coord: LngLat? {
        guard let lat, let lon else { return nil }
        return LngLat(lon, lat)
    }
}

// MARK: - Live departures (WebSocket /api/ws)

/// A whole ASW node, or specific stops (platforms) within it.
struct StopSelector: Codable, Hashable {
    let node: Int
    let stops: [Int]?

    /// Canonical board key: "539", or "539:1,2" with the stop ids sorted.
    var key: String {
        guard let stops else { return String(node) }
        return "\(node):" + stops.sorted().map(String.init).joined(separator: ",")
    }

    private enum CodingKeys: String, CodingKey { case node, stops }

    init(node: Int, stops: [Int]?) {
        self.node = node
        self.stops = stops
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(node, forKey: .node)
        // the contract wants an explicit null for "whole node"
        if let stops { try c.encode(stops, forKey: .stops) } else { try c.encodeNil(forKey: .stops) }
    }
}

enum ClientMessage: Encodable, Equatable {
    case subscribe([StopSelector])
    case unsubscribe

    private enum CodingKeys: String, CodingKey {
        case tag = "_tag"
        case selectors
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .subscribe(selectors):
            try c.encode("Subscribe", forKey: .tag)
            try c.encode(selectors, forKey: .selectors)
        case .unsubscribe:
            try c.encode("Unsubscribe", forKey: .tag)
        }
    }

    /// The frame as sent on the socket.
    var json: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = (try? encoder.encode(self)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

enum ServerMessage: Decodable {
    case departures(DeparturesUpdate)
    case serverError(String)

    private enum CodingKeys: String, CodingKey {
        case tag = "_tag"
        case message
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let tag = try c.decode(String.self, forKey: .tag)
        switch tag {
        case "DeparturesUpdate": self = try .departures(DeparturesUpdate(from: decoder))
        case "ServerError": self = try .serverError(c.decode(String.self, forKey: .message))
        default: throw DecodingError.dataCorruptedError(forKey: .tag, in: c, debugDescription: "unknown _tag \(tag)")
        }
    }
}

struct DeparturesUpdate: Decodable {
    let boards: [StopBoard]
    let generatedAt: String
    let degraded: Bool
    let reason: String?
}

struct StopBoard: Decodable {
    let key: String
    let departures: [WireDeparture]

    private enum CodingKeys: String, CodingKey { case key, departures }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        departures = try c.decode(Lossy<WireDeparture>.self, forKey: .departures).values
    }
}

struct WireDeparture: Decodable, Hashable {
    let route: String
    let kind: VehicleKind
    let headsign: String
    let scheduled: Date
    let predicted: Date?
    let delaySeconds: Double?
    let isCanceled: Bool
    let isAtStop: Bool
    let platform: String?
    /// GTFS trip id, the key for journeys. Not in production yet — absent there.
    let tripId: String?

    private enum CodingKeys: String, CodingKey {
        case route, kind, headsign, scheduled, predicted, delaySeconds, isCanceled, isAtStop, platform, tripId
    }

    init(
        route: String, kind: VehicleKind, headsign: String, scheduled: Date, predicted: Date? = nil,
        delaySeconds: Double? = nil, isCanceled: Bool = false, isAtStop: Bool = false,
        platform: String? = nil, tripId: String? = nil
    ) {
        self.route = route
        self.kind = kind
        self.headsign = headsign
        self.scheduled = scheduled
        self.predicted = predicted
        self.delaySeconds = delaySeconds
        self.isCanceled = isCanceled
        self.isAtStop = isAtStop
        self.platform = platform
        self.tripId = tripId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        route = try c.decode(String.self, forKey: .route)
        kind = VehicleKind(wire: try c.decode(String.self, forKey: .kind))
        headsign = try c.decode(String.self, forKey: .headsign)
        let scheduledText = try c.decode(String.self, forKey: .scheduled)
        guard let scheduled = ISODate.parse(scheduledText) else {
            throw DecodingError.dataCorruptedError(forKey: .scheduled, in: c, debugDescription: "bad date \(scheduledText)")
        }
        self.scheduled = scheduled
        predicted = try c.decodeIfPresent(String.self, forKey: .predicted).flatMap(ISODate.parse)
        delaySeconds = try c.decodeIfPresent(Double.self, forKey: .delaySeconds)
        isCanceled = try c.decodeIfPresent(Bool.self, forKey: .isCanceled) ?? false
        isAtStop = try c.decodeIfPresent(Bool.self, forKey: .isAtStop) ?? false
        platform = try c.decodeIfPresent(String.self, forKey: .platform)
        tripId = try c.decodeIfPresent(String.self, forKey: .tripId)
    }
}

// MARK: - Trips and vehicles (REST)

/// GET /api/trips/:tripId — a trip's stops and the path between them.
struct Trip: Decodable, Hashable {
    let tripId: String
    let headsign: String
    let stops: [TripStop]
    let shape: [ShapePoint]

    private enum CodingKeys: String, CodingKey { case tripId, headsign, stops, shape }

    init(tripId: String, headsign: String, stops: [TripStop], shape: [ShapePoint]) {
        self.tripId = tripId
        self.headsign = headsign
        self.stops = stops
        self.shape = shape
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tripId = try c.decode(String.self, forKey: .tripId)
        headsign = try c.decodeIfPresent(String.self, forKey: .headsign) ?? ""
        stops = try c.decode(Lossy<TripStop>.self, forKey: .stops).values
        shape = try c.decodeIfPresent(Lossy<ShapePoint>.self, forKey: .shape)?.values ?? []
    }
}

struct TripStop: Decodable, Hashable {
    let name: String
    let lat: Double
    let lon: Double
    /// ASW ids; nil for stops outside the registry (rail waypoints).
    let node: Int?
    let stop: Int?
    let platform: String?
    let sequence: Int
    /// Seconds after the trip's service-day midnight; can exceed 86 400.
    let arrival: Double
    let departure: Double
    /// km along the shape.
    let distance: Double?

    var coord: LngLat { LngLat(lon, lat) }

    private enum CodingKeys: String, CodingKey {
        case name, lat, lon, node, stop, platform, sequence, arrival, departure, distance
    }

    init(
        name: String, lat: Double, lon: Double, node: Int?, stop: Int? = nil, platform: String? = nil,
        sequence: Int, arrival: Double, departure: Double, distance: Double? = nil
    ) {
        self.name = name
        self.lat = lat
        self.lon = lon
        self.node = node
        self.stop = stop
        self.platform = platform
        self.sequence = sequence
        self.arrival = arrival
        self.departure = departure
        self.distance = distance
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        lat = try c.decode(Double.self, forKey: .lat)
        lon = try c.decode(Double.self, forKey: .lon)
        node = try c.decodeLenientIntIfPresent(forKey: .node)
        stop = try c.decodeLenientIntIfPresent(forKey: .stop)
        platform = try c.decodeIfPresent(String.self, forKey: .platform)
        sequence = try c.decodeLenientInt(forKey: .sequence)
        let arrival = try c.decodeIfPresent(Double.self, forKey: .arrival)
        let departure = try c.decodeIfPresent(Double.self, forKey: .departure)
        guard let either = departure ?? arrival else {
            throw DecodingError.keyNotFound(CodingKeys.departure, .init(codingPath: c.codingPath, debugDescription: "no stop time"))
        }
        self.arrival = arrival ?? either
        self.departure = departure ?? either
        distance = try c.decodeIfPresent(Double.self, forKey: .distance)
    }
}

/// A shape vertex, `[lon, lat, km along the shape]` on the wire.
struct ShapePoint: Decodable, Hashable {
    let lon: Double
    let lat: Double
    let km: Double

    init(lon: Double, lat: Double, km: Double) {
        self.lon = lon
        self.lat = lat
        self.km = km
    }

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        lon = try c.decode(Double.self)
        lat = try c.decode(Double.self)
        km = try c.decode(Double.self)
    }
}

/// GET /api/trips/:tripId/vehicle — where that trip's vehicle is now (404: not tracked).
struct TripVehicle: Decodable, Hashable {
    let tripId: String
    let lat: Double
    let lon: Double
    let bearing: Double?
    let delaySeconds: Double?
    let lastStopSequence: Int?
    let nextStopSequence: Int?
    /// km along the shape.
    let distance: Double?
    /// Golemio state_position: on_track, at_stop, before_track, after_track, off_track, canceled, …
    let state: String
    let updatedAt: Date?

    var coord: LngLat { LngLat(lon, lat) }

    private enum CodingKeys: String, CodingKey {
        case tripId, lat, lon, bearing, delaySeconds, lastStopSequence, nextStopSequence, distance, state, updatedAt
    }

    init(
        tripId: String, lat: Double, lon: Double, bearing: Double? = nil, delaySeconds: Double? = nil,
        lastStopSequence: Int? = nil, nextStopSequence: Int? = nil, distance: Double? = nil,
        state: String = "on_track", updatedAt: Date? = nil
    ) {
        self.tripId = tripId
        self.lat = lat
        self.lon = lon
        self.bearing = bearing
        self.delaySeconds = delaySeconds
        self.lastStopSequence = lastStopSequence
        self.nextStopSequence = nextStopSequence
        self.distance = distance
        self.state = state
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tripId = try c.decode(String.self, forKey: .tripId)
        lat = try c.decode(Double.self, forKey: .lat)
        lon = try c.decode(Double.self, forKey: .lon)
        bearing = try c.decodeIfPresent(Double.self, forKey: .bearing)
        delaySeconds = try c.decodeIfPresent(Double.self, forKey: .delaySeconds)
        lastStopSequence = try c.decodeLenientIntIfPresent(forKey: .lastStopSequence)
        nextStopSequence = try c.decodeLenientIntIfPresent(forKey: .nextStopSequence)
        distance = try c.decodeIfPresent(Double.self, forKey: .distance)
        state = try c.decodeIfPresent(String.self, forKey: .state) ?? "on_track"
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt).flatMap(ISODate.parse)
    }
}

/// GET /api/vehicles?bbox=minLat,minLon,maxLat,maxLon
struct LiveVehicles: Decodable {
    let vehicles: [LiveVehicle]
    let generatedAt: String?

    private enum CodingKeys: String, CodingKey { case vehicles, generatedAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vehicles = try c.decode(Lossy<LiveVehicle>.self, forKey: .vehicles).values
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
    }
}

struct LiveVehicle: Decodable, Hashable {
    let tripId: String
    let route: String
    let kind: VehicleKind
    let lat: Double
    let lon: Double
    let bearing: Double?
    let delaySeconds: Double?

    var coord: LngLat { LngLat(lon, lat) }

    private enum CodingKeys: String, CodingKey { case tripId, route, kind, lat, lon, bearing, delaySeconds }

    init(tripId: String, route: String, kind: VehicleKind, lat: Double, lon: Double, bearing: Double? = nil, delaySeconds: Double? = nil) {
        self.tripId = tripId
        self.route = route
        self.kind = kind
        self.lat = lat
        self.lon = lon
        self.bearing = bearing
        self.delaySeconds = delaySeconds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tripId = try c.decode(String.self, forKey: .tripId)
        route = try c.decodeIfPresent(String.self, forKey: .route) ?? ""
        kind = VehicleKind(wire: try c.decodeIfPresent(String.self, forKey: .kind) ?? "other")
        lat = try c.decode(Double.self, forKey: .lat)
        lon = try c.decode(Double.self, forKey: .lon)
        bearing = try c.decodeIfPresent(Double.self, forKey: .bearing)
        delaySeconds = try c.decodeIfPresent(Double.self, forKey: .delaySeconds)
    }
}

/// The tagged error body of a failed REST call: TripNotFound, UpstreamUnavailable, …
struct APIErrorBody: Decodable {
    let tag: String
    let reason: String?

    private enum CodingKeys: String, CodingKey {
        case tag = "_tag"
        case reason
    }
}

// MARK: - Decoding helpers

enum Wire {
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }
}

/// ISO 8601 with offset ("2026-10-03T11:11:00+02:00") or Z, with or without fractional seconds.
enum ISODate {
    private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let whole = Date.ISO8601FormatStyle()

    static func parse(_ text: String) -> Date? {
        (try? Date(text, strategy: fractional)) ?? (try? Date(text, strategy: whole))
    }
}

/// Decodes the elements that decode and skips the rest.
struct Lossy<Element: Decodable>: Decodable {
    let values: [Element]

    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        out.reserveCapacity(c.count ?? 0)
        while !c.isAtEnd {
            if let value = try? c.decode(Element.self) {
                out.append(value)
            } else {
                _ = try c.decode(Skip.self)
            }
        }
        values = out
    }
}

extension KeyedDecodingContainer {
    /// An integer that may arrive as `3` or `3.0`.
    func decodeLenientIntIfPresent(forKey key: Key) throws -> Int? {
        if let int = try? decodeIfPresent(Int.self, forKey: key) { return int }
        return try decodeIfPresent(Double.self, forKey: key).map { Int($0) }
    }

    func decodeLenientInt(forKey key: Key) throws -> Int {
        guard let value = try decodeLenientIntIfPresent(forKey: key) else {
            throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "missing \(key.stringValue)"))
        }
        return value
    }
}
