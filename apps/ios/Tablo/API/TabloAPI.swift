import Foundation
import OpenTelemetryApi

/// Where the backend lives. In order: a launch argument
/// `-TabloAPIBase http://localhost:1337` (NSArgumentDomain), then the
/// `TabloAPIBase` Info.plist value baked in at build time (the
/// `TABLO_API_BASE` build setting, e.g. a PR preview for a device build),
/// then production.
enum APIConfig {
    static let production = URL(string: "https://tablo.run")!

    static var base: URL {
        let candidates = [
            UserDefaults.standard.string(forKey: "TabloAPIBase"),
            Bundle.main.object(forInfoDictionaryKey: "TabloAPIBase") as? String,
        ]
        for case let text? in candidates {
            if let url = URL(string: text), url.scheme != nil, url.host != nil { return url }
        }
        return production
    }

    /// wss://host/api/ws?session=… (ws:// for a plain-http base).
    static func webSocketURL(base: URL, session: UUID) -> URL {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        parts.scheme = base.scheme == "http" ? "ws" : "wss"
        parts.path = "/api/ws"
        parts.queryItems = [URLQueryItem(name: "session", value: session.uuidString.lowercased())]
        return parts.url!
    }
}

/// A box the vehicles endpoint accepts: `minLat,minLon,maxLat,maxLon`, each side ≤ 1° (0.05° on older servers).
struct BBox: Equatable {
    let minLat: Double
    let minLon: Double
    let maxLat: Double
    let maxLon: Double

    /// ±0.006° lat × ±0.009° lon — about 1.3 km square around a Prague stop.
    static func around(_ c: LngLat, latSpan: Double = 0.006, lonSpan: Double = 0.009) -> BBox {
        BBox(minLat: c.lat - latSpan, minLon: c.lng - lonSpan, maxLat: c.lat + latSpan, maxLon: c.lng + lonSpan)
    }

    var query: String {
        String(format: "%.5f,%.5f,%.5f,%.5f", minLat, minLon, maxLat, maxLon)
    }
}

enum APIError: Error, Equatable {
    /// 404 — TripNotFound, or a route this backend doesn't have yet.
    case notFound
    /// 503 UpstreamUnavailable.
    case unavailable(String?)
    case status(Int)
    case decoding
}

/// The REST side of the backend. Each request is a client span under `parent`
/// (a trace of its own without one), carrying URLSession's timing breakdown.
struct TabloAPI: Sendable {
    let base: URL
    private let session: URLSession

    init(base: URL = APIConfig.base) {
        self.base = base
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    // MARK: Stop index

    /// The stop index: the manifest names a content-hashed (immutable) file,
    /// kept on disk under that name. Offline, the newest cached index serves.
    /// `parent` gets `index.source`: cache, network or offline (the newest cached).
    func stopIndex(parent: Span? = nil) async throws -> [IndexStop] {
        let cache = StopIndexCache()
        do {
            let manifest = try await get(StopsManifest.self, path: "/data/stops-manifest.json", parent: parent)
            if let data = cache.read(manifest.path), let file = try? Wire.decode(StopIndexFile.self, from: data) {
                parent?.setAttribute(key: "index.source", value: "cache")
                return file.stops
            }
            let data = try await data(path: manifest.path, query: [], route: "/data/{index}", parent: parent)
            let file = try decodeOrThrow(StopIndexFile.self, data)
            cache.write(data, for: manifest.path)
            parent?.setAttribute(key: "index.source", value: "network")
            return file.stops
        } catch {
            if let data = cache.newest(), let file = try? Wire.decode(StopIndexFile.self, from: data) {
                parent?.setAttribute(key: "index.source", value: "offline")
                return file.stops
            }
            throw error
        }
    }

    // MARK: Transit

    func trip(_ tripId: String, parent: Span? = nil) async throws -> Trip {
        try await get(Trip.self, path: "/api/trips/\(Self.escape(tripId))", route: "/api/trips/{id}", parent: parent)
    }

    /// nil when the trip's vehicle isn't being tracked (404).
    func tripVehicle(_ tripId: String, parent: Span? = nil) async throws -> TripVehicle? {
        do {
            return try await get(TripVehicle.self, path: "/api/trips/\(Self.escape(tripId))/vehicle", route: "/api/trips/{id}/vehicle", parent: parent)
        } catch APIError.notFound {
            return nil
        }
    }

    func vehicles(in box: BBox, parent: Span? = nil) async throws -> [LiveVehicle] {
        try await get(LiveVehicles.self, path: "/api/vehicles", query: [URLQueryItem(name: "bbox", value: box.query)], parent: parent).vehicles
    }

    // MARK: Plumbing

    private static func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }

    /// `route`: the path template naming the span (default: `path`).
    private func get<T: Decodable>(_ type: T.Type, path: String, query: [URLQueryItem] = [], route: String? = nil, parent: Span?) async throws -> T {
        try decodeOrThrow(type, try await data(path: path, query: query, route: route, parent: parent))
    }

    private func decodeOrThrow<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try Wire.decode(type, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    private func data(path: String, query: [URLQueryItem], route: String? = nil, parent: Span?) async throws -> Data {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        parts.percentEncodedPath = path
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else { throw APIError.status(0) }
        let route = route ?? path
        let span = Telemetry.span("GET \(route)", parent: parent, kind: .client, attributes: [
            "http.request.method": .string("GET"),
            "http.route": .string(route),
            "url.full": .string(url.absoluteString),
            "server.address": .string(url.host ?? ""),
        ])
        defer { span.end() }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in Telemetry.headers(for: span) { request.setValue(value, forHTTPHeaderField: name) }
        do {
            let (data, response) = try await session.data(for: request, delegate: RequestMetrics(span))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            span.setAttribute(key: "http.response.status_code", value: status)
            span.setAttribute(key: "http.response.body.size", value: data.count)
            switch status {
            case 200 ..< 300: return data
            case 404: throw APIError.notFound
            case 503: throw APIError.unavailable((try? Wire.decode(APIErrorBody.self, from: data))?.reason)
            default: throw APIError.status(status)
            }
        } catch {
            // a 404 is an answer (no such trip / no vehicle), not a failure
            if error as? APIError != .notFound { span.fail(error) }
            throw error
        }
    }
}

/// URLSession's timing breakdown of a request, onto its span: where a slow
/// request spent its time — DNS, connecting, TLS, the server, the download.
private final class RequestMetrics: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let span: Span

    init(_ span: Span) {
        self.span = span
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let t = metrics.transactionMetrics.last else { return }
        func ms(_ key: String, _ from: Date?, _ to: Date?) {
            guard let from, let to else { return }
            span.setAttribute(key: key, value: Int((to.timeIntervalSince(from) * 1000).rounded()))
        }
        ms("http.dns_ms", t.domainLookupStartDate, t.domainLookupEndDate)
        ms("http.connect_ms", t.connectStartDate, t.connectEndDate)
        ms("http.tls_ms", t.secureConnectionStartDate, t.secureConnectionEndDate)
        ms("http.ttfb_ms", t.requestStartDate, t.responseStartDate)
        ms("http.download_ms", t.responseStartDate, t.responseEndDate)
        span.setAttribute(key: "http.reused_connection", value: t.isReusedConnection)
        span.setAttribute(key: "http.cellular", value: t.isCellular)
        if let proto = t.networkProtocolName { span.setAttribute(key: "network.protocol.name", value: proto) }
    }
}

/// The stop index on disk, one file per content-hashed path.
struct StopIndexCache: Sendable {
    private let dir: URL

    init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        dir = caches.appendingPathComponent("StopIndex", isDirectory: true)
    }

    private func file(for path: String) -> URL {
        let name = path.split(separator: "/").joined(separator: "_")
        return dir.appendingPathComponent(name.isEmpty ? "index.json" : name)
    }

    func read(_ path: String) -> Data? {
        try? Data(contentsOf: file(for: path))
    }

    /// Stores `data` under `path` and drops older indexes.
    func write(_ data: Data, for path: String) {
        let fm = FileManager.default
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = file(for: path)
        guard (try? data.write(to: target, options: .atomic)) != nil else { return }
        for old in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where old.lastPathComponent != target.lastPathComponent {
            try? fm.removeItem(at: old)
        }
    }

    func newest() -> Data? {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let latest = files.max { a, b in
            let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return da < db
        }
        return latest.flatMap { try? Data(contentsOf: $0) }
    }
}
