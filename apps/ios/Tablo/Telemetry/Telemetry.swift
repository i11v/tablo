import Foundation
import Honeycomb
import OpenTelemetryApi
import OpenTelemetrySdk
import UIKit

/// OpenTelemetry tracing. With a Honeycomb ingest key (launch argument
/// `-HoneycombAPIKey <key>`, else the `HONEYCOMB_API_KEY` build setting — see
/// `Tablo.xcconfig`) spans go to Honeycomb as service `tablo-ios` — at
/// `HONEYCOMB_API_HOST`, the account's region — each tagged
/// with the `session.id` of the app session. `-TabloTraceConsole YES` also
/// prints every finished span, and works without a key. With neither, the
/// tracer is OpenTelemetry's no-op one and spans cost next to nothing.
enum Telemetry {
    static let serviceName = "tablo-ios"

    static func configure() {
        // unit tests run inside the app: keep them off the network
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        let defaults = UserDefaults.standard
        let console = defaults.bool(forKey: "TabloTraceConsole")
        let key = [
            defaults.string(forKey: "HoneycombAPIKey"),
            Bundle.main.object(forInfoDictionaryKey: "HoneycombAPIKey") as? String,
        ].lazy.compactMap { $0?.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }

        if let key {
            let host = (Bundle.main.object(forInfoDictionaryKey: "HoneycombAPIHost") as? String)
                .flatMap { $0.isEmpty ? nil : $0 } ?? "api.honeycomb.io"
            do {
                var builder = HoneycombOptions.Builder()
                    .setAPIKey(key)
                    .setAPIEndpoint("https://\(host):443")
                    .setServiceName(serviceName)
                    .setResourceAttributes(["tablo.api_base": APIConfig.base.absoluteString])
                    // TabloAPI traces its own requests, nested under what waited on them
                    .setURLSessionInstrumentationEnabled(false)
                    // SwiftUI: the UIKit view events are hosting-controller noise
                    .setUIKitInstrumentationEnabled(false)
                if console { builder = builder.setSpanProcessor(SimpleSpanProcessor(spanExporter: ConsoleSpanExporter())) }
                try Honeycomb.configure(options: builder.build())
            } catch {
                NSLog("tablo: Honeycomb not configured: \(error)")
            }
        } else if console {
            let provider = TracerProviderBuilder()
                .add(spanProcessor: SimpleSpanProcessor(spanExporter: ConsoleSpanExporter()))
                .with(resource: Resource(attributes: ["service.name": .string(serviceName)]))
                .build()
            OpenTelemetry.registerTracerProvider(tracerProvider: provider)
        }
    }

    /// When the process started (from the kernel), so a launch trace covers
    /// the time before `main` too.
    static let processStart: Date = {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return Date() }
        let tv = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: Double(tv.tv_sec) + Double(tv.tv_usec) / 1_000_000)
    }()

    static var tracer: Tracer {
        OpenTelemetry.instance.tracerProvider.get(
            instrumentationName: "tablo",
            instrumentationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        )
    }

    /// A span under `parent`, or a trace of its own without one.
    static func span(
        _ name: String, parent: Span?, kind: SpanKind = .internal,
        attributes: [String: AttributeValue] = [:], start: Date? = nil
    ) -> Span {
        let builder = tracer.spanBuilder(spanName: name).setSpanKind(spanKind: kind)
        if let parent { builder.setParent(parent) } else { builder.setNoParent() }
        if let start { builder.setStartTime(time: start) }
        for (key, value) in attributes { builder.setAttribute(key: key, value: value) }
        return builder.startSpan()
    }

    /// The W3C `traceparent` for a request made under `span`.
    static func headers(for span: Span) -> [String: String] {
        var carrier: [String: String] = [:]
        W3CTraceContextPropagator().inject(spanContext: span.context, carrier: &carrier, setter: HeaderSetter())
        return carrier
    }

    /// Send what's buffered before iOS suspends the app (the batch exporter
    /// otherwise waits up to 5 s, and a suspended app sends nothing).
    @MainActor static func flushInBackground() {
        guard let provider = OpenTelemetry.instance.tracerProvider as? TracerProviderSdk else { return }
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "telemetry.flush") {
            UIApplication.shared.endBackgroundTask(task)
        }
        DispatchQueue.global(qos: .utility).async {
            provider.forceFlush(timeout: 10)
            DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) }
        }
    }
}

extension Span {
    /// An error, or a cancellation (a stop switch, the app backgrounding) — which isn't one.
    func fail(_ error: Error) {
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
            setAttribute(key: "tablo.outcome", value: "cancelled")
            return
        }
        status = .error(description: String(describing: error))
        setAttribute(key: "error", value: true)
    }
}

private struct HeaderSetter: Setter {
    func set(carrier: inout [String: String], key: String, value: String) {
        carrier[key] = value
    }
}

/// One line per finished span, for watching traces in the Xcode / `simctl` console.
private final class ConsoleSpanExporter: SpanExporter, @unchecked Sendable {
    func export(spans: [SpanData], explicitTimeout: TimeInterval?) -> SpanExporterResultCode {
        for s in spans {
            let ms = s.endTime.timeIntervalSince(s.startTime) * 1000
            let attrs = s.attributes
                .filter { !$0.key.hasPrefix("device.") && !$0.key.hasPrefix("network.") && $0.key != "session.id" }
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value.description)" }
                .joined(separator: " ")
            let events = s.events.map { "@\(Int($0.timestamp.timeIntervalSince(s.startTime) * 1000))ms \($0.name)" }
            print(String(
                format: "[span] trace %@ span %@ ← %@  %@ %.0fms %@%@",
                s.traceId.hexString.suffix(8).description, s.spanId.hexString.suffix(6).description,
                s.parentSpanId?.hexString.suffix(6).description ?? "root  ",
                s.name, ms, attrs, events.isEmpty ? "" : " | " + events.joined(separator: ", ")
            ))
        }
        return .success
    }

    func flush(explicitTimeout: TimeInterval?) -> SpanExporterResultCode { .success }
    func shutdown(explicitTimeout: TimeInterval?) {}
}
