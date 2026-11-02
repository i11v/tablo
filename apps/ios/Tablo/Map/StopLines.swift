import MapKit
import UIKit

/// One line serving the current stop: the path of one of its route's trips.
struct StopLine: Hashable {
    let route: String
    let kind: VehicleKind
    let path: [LngLat]
}

/// A `StopLine` on the map.
final class StopLineOverlay: MKPolyline {
    private(set) var line = StopLine(route: "", kind: .other, path: [])
    var isOnMap = false

    static func make(_ line: StopLine) -> StopLineOverlay {
        let coords = line.path.map(\.coordinate)
        let overlay = StopLineOverlay(coordinates: coords, count: coords.count)
        overlay.line = line
        return overlay
    }
}

/// Every line serving the current stop, drawn on the board map as quiet
/// context under the markers (`StopLines` in the design system): one
/// direction per route, ink-dim and faint, metro (underground) dashed.
enum StopLines {
    static let width: CGFloat = 3
    static let opacity: CGFloat = 0.32
    static let metroDash: [NSNumber] = [5, 4]

    /// Drawn off the main thread, so the appearance is handed in rather than read from traits.
    static func renderer(for overlay: StopLineOverlay, dark: Bool) -> MKPolylineRenderer {
        let r = MKPolylineRenderer(polyline: overlay)
        // ink-dim
        r.strokeColor = UIColor(hex: dark ? 0xD8D6CF : 0x2E2D31, alpha: opacity)
        r.lineWidth = width
        r.lineCap = .round
        r.lineJoin = .round
        if overlay.line.kind == .metro { r.lineDashPattern = metroDash }
        return r
    }
}
