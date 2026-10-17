import Foundation
import OpenTelemetryApi

/// One trace per launch or return to the foreground: a root span held open
/// until the stop page has settled — its board, its vehicles and their trip
/// plans are all in — so every request it waited on nests under it. A stop
/// switch on the way (the first location fix) starts the wait over, and the
/// milestone times it records are for the stop it settled on.
@MainActor
final class PhaseTrace {
    enum Kind: String {
        case launch = "app.launch"
        case resume = "app.resume"
    }

    /// Giving up on settling: something never arrived.
    static let limit: Duration = .seconds(30)

    let span: Span
    private let start: Date
    private var vehicles = false
    private var plans = false
    private var board = false
    private var switches = 0
    private var ended = false
    private var timeout: Task<Void, Never>?
    private let onEnd: () -> Void

    init(_ kind: Kind, start: Date = Date(), attributes: [String: AttributeValue] = [:], onEnd: @escaping () -> Void) {
        self.start = start
        self.onEnd = onEnd
        span = Telemetry.span(kind.rawValue, parent: nil, attributes: attributes, start: start)
        timeout = Task { [weak self] in
            try? await Task.sleep(for: Self.limit)
            guard !Task.isCancelled else { return }
            self?.end("timeout")
        }
    }

    private func ms(_ key: String) {
        span.setAttribute(key: key, value: Int(Date().timeIntervalSince(start) * 1000))
    }

    func boardShown() {
        guard !ended, !board else { return }
        board = true
        ms("tablo.board_ms")
        settleIfDone()
    }

    func vehiclesShown(_ count: Int) {
        guard !ended, !vehicles else { return }
        vehicles = true
        ms("tablo.vehicles_ms")
        span.setAttribute(key: "tablo.vehicles", value: count)
        settleIfDone()
    }

    /// Every vehicle first shown has its trip plan (or none to fetch).
    func plansReady() {
        guard !ended, vehicles, !plans else { return }
        plans = true
        ms("tablo.plans_ms")
        settleIfDone()
    }

    /// Another stop: its board and vehicles are what's waited for now.
    func stopSwitched(from: String, to: String, reason: String) {
        guard !ended else { return }
        switches += 1
        span.addEvent(name: "stop.switch", attributes: [
            "stop.from": .string(from), "stop.to": .string(to), "reason": .string(reason),
        ])
        span.setAttribute(key: "tablo.stop_switches", value: switches)
        vehicles = false
        plans = false
        board = false
    }

    func event(_ name: String, _ attributes: [String: AttributeValue] = [:]) {
        guard !ended else { return }
        span.addEvent(name: name, attributes: attributes)
    }

    private func settleIfDone() {
        if vehicles, plans, board { end("settled") }
    }

    /// `settled`, `timeout`, or what cut it short (`background`, `search`, `journey`).
    func end(_ outcome: String) {
        guard !ended else { return }
        ended = true
        timeout?.cancel()
        span.setAttribute(key: "tablo.outcome", value: outcome)
        if outcome != "settled" {
            let missing = [("board", board), ("vehicles", vehicles), ("plans", plans)].filter { !$0.1 }.map(\.0)
            span.setAttribute(key: "tablo.missing", value: missing.joined(separator: ","))
        }
        span.end()
        onEnd()
    }
}
