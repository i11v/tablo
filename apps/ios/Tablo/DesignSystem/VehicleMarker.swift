import SwiftUI

/// Vehicle geometry shared by the badge and its heading wedge, so both draw on one canvas.
struct VehicleMetrics {
    let big: Bool
    var side: CGFloat { big ? 30 : 24 }
    /// Halo blur (CSS px); SwiftUI's shadow radius is about half of it.
    var haloBlur: CGFloat { big ? 14 : 9 }
    var wedgeHalfWidth: CGFloat { big ? 6 : 5 }
    var wedgeLength: CGFloat { big ? 8 : 7 }
    /// The wedge's base sits this far inside the ring's outer edge.
    var wedgeOverlap: CGFloat { 1 }
    var canvas: CGFloat { side + (wedgeLength - wedgeOverlap) * 2 }
}

/// A live vehicle: round chip-filled body with the route number and a tier
/// ring glowing in its hue. Circle = moving vehicle (square = fixed place).
struct VehicleBadge: View {
    let route: String
    let color: Color
    let big: Bool

    var body: some View {
        let m = VehicleMetrics(big: big)
        let fontSize: CGFloat = route.count > 2 ? (big ? 12 : 10) : (big ? 14 : 12)
        ZStack {
            Circle()
                .fill(Palette.chip)
                .overlay(Circle().strokeBorder(color, lineWidth: 2))
                .frame(width: m.side, height: m.side)
                .shadow(color: Palette.glow(color, dark: 0.55, light: 0.3), radius: m.haloBlur / 2)
                .shadow(color: Palette.markerDrop, radius: 3, y: 2)
            Text(route)
                .font(.hanken(fontSize, .heavy))
                .tracking(-0.02 * fontSize)
                .foregroundStyle(Palette.chipInk)
        }
        .frame(width: m.canvas, height: m.canvas)
    }
}

/// The direction wedge on a vehicle's ring, drawn pointing up.
struct VehicleHead: View {
    let color: Color
    let big: Bool

    var body: some View {
        let m = VehicleMetrics(big: big)
        let base = (m.canvas - m.side) / 2 + m.wedgeOverlap
        Path { p in
            let mid = m.canvas / 2
            p.move(to: CGPoint(x: mid, y: base - m.wedgeLength))
            p.addLine(to: CGPoint(x: mid + m.wedgeHalfWidth, y: base))
            p.addLine(to: CGPoint(x: mid - m.wedgeHalfWidth, y: base))
            p.closeSubpath()
        }
        .fill(color)
        .frame(width: m.canvas, height: m.canvas)
    }
}

/// Badge + wedge as one view, for in-sheet use (the journey's NOW row). The
/// map rasterises the two parts separately so the wedge can turn on its own.
struct VehicleMarker: View {
    let route: String
    let tier: Tier
    /// Screen-space degrees, 0 = up, clockwise.
    var heading: Double = 0
    var big = false

    var body: some View {
        ZStack {
            VehicleHead(color: tier.color, big: big).rotationEffect(.degrees(heading))
            VehicleBadge(route: route, color: tier.color, big: big)
        }
        .accessibilityHidden(true)
    }
}
