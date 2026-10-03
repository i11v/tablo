import MapKit
import UIKit

/// A world-sized overlay the journey route is drawn into: the travelled part
/// dotted, the part ahead a bone line on a dark casing, stops as rings.
final class JourneyOverlay: NSObject, MKOverlay {
    let coordinate = CLLocationCoordinate2D(latitude: 50.08, longitude: 14.42)
    let boundingMapRect = MKMapRect.world
}

/// Warms and darkens Apple's dark map toward tablo's near-black board
/// ground; sits above roads, below labels.
final class GroundScrim: NSObject, MKOverlay {
    let coordinate = CLLocationCoordinate2D(latitude: 50.08, longitude: 14.42)
    let boundingMapRect = MKMapRect.world
}

final class GroundScrimRenderer: MKOverlayRenderer {
    private static let tint = UIColor(hex: 0x0B0A08, alpha: 0.38).cgColor

    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in ctx: CGContext) {
        ctx.setFillColor(Self.tint)
        ctx.fill(rect(for: mapRect))
    }
}

struct JourneySnapshot {
    /// Identifies `path` (the trip id), so the renderer converts it once.
    var pathID: String
    /// The trip's path and each vertex's km along it.
    var path: [MKMapPoint]
    var pathKm: [Double]
    /// Where the vehicle is, km along `path`: the line is cut here.
    var vehicleKm: Double
    var vehicle: MKMapPoint
    var stops: [MKMapPoint]
    var seg: Int
    var mine: Int
    var focus: Int
    var atStop: Bool
}

final class JourneyRenderer: MKOverlayRenderer {
    private let lock = NSLock()
    private var snapshot: JourneySnapshot?
    /// The path in renderer points, converted once per trip rather than per tile.
    private var line: [CGPoint] = []
    private var lineID: String?

    private static let past = UIColor(hex: 0x5C5A54)
    private static let casing = UIColor(hex: 0x08080A, alpha: 0.55)
    private static let ahead = UIColor(hex: 0xECEAE3)
    private static let pastFill = UIColor(hex: 0x2A2A30)
    private static let aheadFill = UIColor(hex: 0x0F0F12)

    func update(_ next: JourneySnapshot?) {
        lock.lock()
        snapshot = next
        if let next, next.pathID != lineID {
            lineID = next.pathID
            line = next.path.map { point(for: $0) }
        }
        lock.unlock()
        setNeedsDisplay()
    }

    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in ctx: CGContext) {
        lock.lock()
        let snap = snapshot
        let line = line
        lock.unlock()
        guard let s = snap, line.count > 1, line.count == s.pathKm.count else { return }

        let vehicle = point(for: s.vehicle)
        // last vertex at or before the vehicle (pathKm ascends)
        var lo = 0, hi = s.pathKm.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if s.pathKm[mid] <= s.vehicleKm { lo = mid } else { hi = mid - 1 }
        }
        let cut = s.vehicleKm <= s.pathKm[0] ? -1 : lo
        let travelled = cut < 0 ? [] : Array(line[0 ... cut]) + [vehicle]
        let upcoming = [vehicle] + Array(line[(cut + 1)...])
        let pts = s.stops.map { point(for: $0) }

        func stroke(_ line: [CGPoint], _ color: UIColor, width: CGFloat, dash: [CGFloat] = []) {
            guard line.count > 1 else { return }
            ctx.beginPath()
            ctx.addLines(between: line)
            ctx.setStrokeColor(color.cgColor)
            ctx.setLineWidth(width / zoomScale)
            ctx.setLineCap(.round)
            ctx.setLineJoin(.round)
            ctx.setLineDash(phase: 0, lengths: dash.map { $0 / zoomScale })
            ctx.strokePath()
        }

        stroke(travelled, Self.past, width: 3, dash: [1, 6])
        stroke(upcoming, Self.casing, width: 8)
        stroke(upcoming, Self.ahead, width: 3.5)

        ctx.setLineDash(phase: 0, lengths: [])
        for (i, p) in pts.enumerated() where i != s.mine {
            let isPast = i <= s.seg && !(s.atStop && i == s.seg)
            let r = (i == s.focus ? 6.5 : 4.2) / zoomScale
            let circle = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            ctx.setFillColor((isPast ? Self.pastFill : Self.aheadFill).cgColor)
            ctx.fillEllipse(in: circle)
            ctx.setStrokeColor((isPast ? Self.past : Self.ahead).cgColor)
            ctx.setLineWidth(2 / zoomScale)
            ctx.strokeEllipse(in: circle)
        }
    }
}
