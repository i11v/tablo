import MapKit
import UIKit

/// Network lines on the map, as one stroke: the surface lines solid, the
/// metro dashed. One stroke paints each pixel once, so lines meeting or
/// overlapping don't stack up darker.
final class NetworkLinesOverlay: MKMultiPolyline {
    private(set) var metro = false

    static func make(_ lines: [NetworkLine], metro: Bool) -> NetworkLinesOverlay {
        let overlay = NetworkLinesOverlay(lines.map { line in
            let coords = line.path.map(\.coordinate)
            return MKPolyline(coordinates: coords, count: coords.count)
        })
        overlay.metro = metro
        return overlay
    }
}

/// The city network drawn behind the board as quiet context under the
/// markers, in the design system's `StopLines` style: ink-dim and faint,
/// metro (underground) dashed. Not interactive, no labels.
enum NetworkLines {
    static let width: CGFloat = 3
    static let opacity: CGFloat = 0.32
    static let metroDash: [NSNumber] = [5, 4]
    /// Zoomed out past this the network would bury the city: it hides.
    static let minZoom = 13.0

    /// The stretches shown for `modes`, split into the surface lines and the
    /// metro; a stretch shows while any mode running over it does.
    static func visible(_ lines: [NetworkLine], modes: Set<VehicleKind>) -> (surface: [NetworkLine], metro: [NetworkLine]) {
        let shown = lines.filter { $0.path.count > 1 && $0.kinds.contains { $0.isShown(in: Array(modes)) } }
        return (shown.filter { !$0.kinds.contains(.metro) }, shown.filter { $0.kinds.contains(.metro) })
    }

    /// Drawn off the main thread, so the appearance is handed in rather than read from traits.
    static func renderer(for overlay: NetworkLinesOverlay, dark: Bool) -> MKMultiPolylineRenderer {
        let r = MKMultiPolylineRenderer(multiPolyline: overlay)
        // ink-dim
        r.strokeColor = UIColor(hex: dark ? 0xD8D6CF : 0x2E2D31, alpha: opacity)
        r.lineWidth = width
        r.lineCap = .round
        r.lineJoin = .round
        if overlay.metro { r.lineDashPattern = metroDash }
        return r
    }
}
