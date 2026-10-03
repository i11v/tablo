import Foundation

/// Where the backend lives. Production by default; a launch argument
/// `-TabloAPIBase http://localhost:1337` (NSArgumentDomain) points the app
/// at a local dev server.
enum APIConfig {
    static let production = URL(string: "https://tablo.run")!

    static var base: URL {
        guard let text = UserDefaults.standard.string(forKey: "TabloAPIBase"),
              let url = URL(string: text), url.scheme != nil, url.host != nil
        else { return production }
        return url
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

/// A box the vehicles endpoint accepts: `minLat,minLon,maxLat,maxLon`, each side ≤ 0.05°.
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

/// The REST side of the backend.
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
    func stopIndex() async throws -> [IndexStop] {
        let cache = StopIndexCache()
        do {
            let manifest = try await get(StopsManifest.self, path: "/data/stops-manifest.json")
            if let data = cache.read(manifest.path), let file = try? Wire.decode(StopIndexFile.self, from: data) {
                return file.stops
            }
            let data = try await data(path: manifest.path, query: [])
            let file = try decodeOrThrow(StopIndexFile.self, data)
            cache.write(data, for: manifest.path)
            return file.stops
        } catch {
            if let data = cache.newest(), let file = try? Wire.decode(StopIndexFile.self, from: data) {
                return file.stops
            }
            throw error
        }
    }

    // MARK: Transit

    func trip(_ tripId: String) async throws -> Trip {
        try await get(Trip.self, path: "/api/trips/\(Self.escape(tripId))")
    }

    /// nil when the trip's vehicle isn't being tracked (404).
    func tripVehicle(_ tripId: String) async throws -> TripVehicle? {
        do {
            return try await get(TripVehicle.self, path: "/api/trips/\(Self.escape(tripId))/vehicle")
        } catch APIError.notFound {
            return nil
        }
    }

    func vehicles(in box: BBox) async throws -> [LiveVehicle] {
        try await get(LiveVehicles.self, path: "/api/vehicles", query: [URLQueryItem(name: "bbox", value: box.query)]).vehicles
    }

    // MARK: Plumbing

    private static func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }

    private func get<T: Decodable>(_ type: T.Type, path: String, query: [URLQueryItem] = []) async throws -> T {
        try decodeOrThrow(type, try await data(path: path, query: query))
    }

    private func decodeOrThrow<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try Wire.decode(type, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    private func data(path: String, query: [URLQueryItem]) async throws -> Data {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        parts.percentEncodedPath = path
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else { throw APIError.status(0) }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200 ..< 300: return data
        case 404: throw APIError.notFound
        case 503: throw APIError.unavailable((try? Wire.decode(APIErrorBody.self, from: data))?.reason)
        default: throw APIError.status(status)
        }
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
