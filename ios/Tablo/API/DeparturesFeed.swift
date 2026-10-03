import Foundation
import Observation

/// The live departures socket — a port of the web's `useDepartures`: connect,
/// subscribe, reconnect with jittered exponential backoff, and re-send the
/// subscription on every connect (the server session outlives sockets).
@MainActor
@Observable
final class DeparturesFeed {
    enum Status: Equatable {
        /// Not running (backgrounded).
        case idle
        case connecting
        case live
        /// The server says its data is stale or failing.
        case degraded
        case reconnecting
    }

    private(set) var status: Status = .idle
    /// Departures per board key, from the latest update.
    private(set) var boards: [String: [WireDeparture]] = [:]
    private(set) var reason: String?

    /// Fires after every server frame.
    @ObservationIgnored var onUpdate: (() -> Void)?

    @ObservationIgnored private let base: URL
    @ObservationIgnored private let session = URLSession(configuration: .default)
    /// One server session per app launch.
    @ObservationIgnored private let sessionID = UUID()
    @ObservationIgnored private var selector: StopSelector?
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var running = false
    @ObservationIgnored private var attempt = 0
    @ObservationIgnored private var lastSent: String?
    @ObservationIgnored private var lastFrame = Date.distantPast
    @ObservationIgnored private var reconnectTask: Task<Void, Never>?
    @ObservationIgnored private var stableTask: Task<Void, Never>?
    @ObservationIgnored private var watchdog: Task<Void, Never>?

    /// How long a connection must stay up before the backoff resets.
    static let stableAfter: Duration = .seconds(10)
    /// Updates arrive every ~15 s; this much silence means a dead socket.
    static let silenceLimit: TimeInterval = 45

    init(base: URL = APIConfig.base) {
        self.base = base
    }

    /// Exponential backoff with jitter: 50–100% of 1 s·2^attempt, capped at 30 s.
    nonisolated static func reconnectDelay(attempt: Int, random: Double = Double.random(in: 0 ..< 1)) -> TimeInterval {
        let base = min(30, pow(2, Double(min(attempt, 16))))
        return base / 2 + random * (base / 2)
    }

    // MARK: Control

    func start() {
        guard !running else { return }
        running = true
        attempt = 0
        status = .connecting
        connect()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                self?.checkSilence()
            }
        }
    }

    func stop() {
        running = false
        reconnectTask?.cancel()
        stableTask?.cancel()
        stableTask = nil
        watchdog?.cancel()
        let old = socket
        socket = nil
        old?.cancel(with: .goingAway, reason: nil)
        status = .idle
    }

    /// Follow one stop (nil unsubscribes). Sent now if connected, and on every reconnect.
    func subscribe(_ next: StopSelector?) {
        guard next != selector else { return }
        selector = next
        if let next {
            boards = boards.filter { $0.key == next.key }
        } else {
            boards = [:]
        }
        sendSubscription()
    }

    // MARK: Socket lifecycle

    private func connect() {
        guard running else { return }
        let task = session.webSocketTask(with: APIConfig.webSocketURL(base: base, session: sessionID))
        socket = task
        lastSent = nil
        lastFrame = Date()
        task.resume()
        // URLSession queues frames until the handshake completes
        sendSubscription()
        listen(task)
    }

    private func listen(_ task: URLSessionWebSocketTask) {
        Task { [weak self] in
            while true {
                let message: URLSessionWebSocketTask.Message
                do {
                    message = try await task.receive()
                } catch {
                    self?.dropped(task)
                    return
                }
                guard let self, socket === task else { return }
                handle(message)
            }
        }
    }

    private func dropped(_ task: URLSessionWebSocketTask) {
        guard socket === task else { return }
        socket = nil
        stableTask?.cancel()
        stableTask = nil
        task.cancel(with: .abnormalClosure, reason: nil)
        guard running else { return }
        status = .reconnecting
        let delay = Self.reconnectDelay(attempt: attempt)
        attempt += 1
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.connect()
        }
    }

    private func checkSilence() {
        guard running, let socket, Date().timeIntervalSince(lastFrame) > Self.silenceLimit else { return }
        dropped(socket)
    }

    private func sendSubscription() {
        guard let socket else { return }
        let message: ClientMessage = selector.map { .subscribe([$0]) } ?? .unsubscribe
        let payload = message.json
        guard payload != lastSent else { return }
        lastSent = payload
        socket.send(.string(payload)) { _ in
            // a failed send surfaces as a receive error, which reconnects
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case let .string(text): data = Data(text.utf8)
        case let .data(raw): data = raw
        @unknown default: return
        }
        lastFrame = Date()
        if stableTask == nil {
            // first frame on this socket: reset the backoff once it has stayed up
            stableTask = Task { [weak self] in
                try? await Task.sleep(for: Self.stableAfter)
                guard !Task.isCancelled else { return }
                self?.attempt = 0
            }
        }
        guard let decoded = try? Wire.decode(ServerMessage.self, from: data) else { return }
        apply(decoded)
        onUpdate?()
    }

    func apply(_ message: ServerMessage) {
        switch message {
        case let .departures(update):
            var next: [String: [WireDeparture]] = [:]
            for board in update.boards { next[board.key] = board.departures }
            boards = next
            status = update.degraded ? .degraded : .live
            reason = update.reason
        case let .serverError(text):
            status = .degraded
            reason = text
        }
    }
}
