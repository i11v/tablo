import Foundation
import OpenTelemetryApi

/// One trace per trip to the search screen: a root `search` span from
/// opening it until you're back on a stop page, with a `search.query` span for
/// each query matched against the index. Picking a stop keeps it open until
/// that stop's board is in, so the time from tap to departures is on it too.
@MainActor
final class SearchTrace {
    /// Giving up on the picked stop's board.
    static let limit: Duration = .seconds(30)

    let span: Span
    private let start = Date()
    private var pickedAt: Date?
    private var lastQuery: String?
    private var lastResults: [String] = []
    private var queries = 0
    private var slowest = 0.0
    private var ended = false
    private var timeout: Task<Void, Never>?
    private let onEnd: () -> Void

    init(stop: String, indexReady: Bool, onEnd: @escaping () -> Void) {
        self.onEnd = onEnd
        span = Telemetry.span("search", parent: nil, attributes: [
            "stop.name": .string(stop),
            "tablo.index_ready": .bool(indexReady),
        ])
    }

    private func ms(_ key: String, since: Date) {
        span.setAttribute(key: key, value: Int(Date().timeIntervalSince(since) * 1000))
    }

    /// The stop list arrived while the screen was open.
    func indexReady() {
        guard !ended, pickedAt == nil else { return }
        ms("tablo.index_wait_ms", since: start)
    }

    /// Times `match` as a `search.query` span — once per query, however
    /// often SwiftUI asks for the results.
    func query<T>(_ query: String, kind: String, keys: (T) -> [String], _ match: () -> T) -> T {
        guard !ended, pickedAt == nil, query != lastQuery else { return match() }
        let begun = Date()
        let child = Telemetry.span("search.query", parent: span, attributes: [
            "search.kind": .string(kind),
            "search.query": .string(query),
            "search.query_length": .int(query.count),
        ])
        let found = match()
        let results = keys(found)
        child.setAttribute(key: "search.results", value: results.count)
        child.end()
        lastQuery = query
        lastResults = results
        queries += 1
        slowest = max(slowest, Date().timeIntervalSince(begun) * 1000)
        span.setAttribute(key: "search.queries", value: queries)
        span.setAttribute(key: "search.slowest_query_ms", value: slowest)
        return found
    }

    /// A stop was picked: the trace now waits for its board.
    func picked(_ key: String, name: String) {
        guard !ended, pickedAt == nil else { return }
        pickedAt = Date()
        ms("tablo.pick_ms", since: start)
        span.setAttribute(key: "stop.to", value: name)
        span.setAttribute(key: "search.query_length", value: lastQuery?.count ?? 0)
        if let rank = lastResults.firstIndex(of: key) { span.setAttribute(key: "search.rank", value: rank) }
        timeout = Task { [weak self] in
            try? await Task.sleep(for: Self.limit)
            guard !Task.isCancelled else { return }
            self?.end("timeout")
        }
    }

    /// The picked stop's departures are on screen.
    func boardShown() {
        guard !ended, let pickedAt else { return }
        ms("tablo.board_ms", since: pickedAt)
        end("picked")
    }

    /// `picked`, `cancelled`, `background` or `timeout`.
    func end(_ outcome: String) {
        guard !ended else { return }
        ended = true
        timeout?.cancel()
        span.setAttribute(key: "tablo.outcome", value: outcome)
        span.end()
        onEnd()
    }
}
