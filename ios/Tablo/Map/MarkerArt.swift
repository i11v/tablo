import SwiftUI
import UIKit

/// Map marker artwork, drawn in SwiftUI and rasterised once into annotation
/// images. `anchor` is the image point that sits on the marker's coordinate.
struct MarkerImage {
    let image: UIImage
    let anchor: CGPoint
    /// A direction wedge, same canvas as `image`, pointing up; rotated about the centre to the heading.
    var head: UIImage?
}

@MainActor
enum MarkerArt {
    /// Room around each marker for rotation overflow and glow.
    private static let pad: CGFloat = 18

    private static func render(_ view: some View) -> UIImage {
        let renderer = ImageRenderer(content: view.padding(pad))
        renderer.scale = 3
        renderer.isOpaque = false
        return renderer.uiImage ?? UIImage()
    }

    /// Bottom-centre of the unpadded content, nudged up by `lift`.
    private static func bottomAnchored(_ view: some View, lift: CGFloat = 0) -> MarkerImage {
        let image = render(view)
        return MarkerImage(image: image, anchor: CGPoint(x: image.size.width / 2, y: image.size.height - pad - lift))
    }

    private static func centred(_ view: some View) -> MarkerImage {
        let image = render(view)
        return MarkerImage(image: image, anchor: CGPoint(x: image.size.width / 2, y: image.size.height / 2))
    }

    /// Rendered art by content, so live updates only rasterise what changed.
    private static var cache: [String: MarkerImage] = [:]

    private static func cached(_ key: String, _ make: () -> MarkerImage) -> MarkerImage {
        if let hit = cache[key] { return hit }
        let art = make()
        if cache.count > 400 { cache.removeAll() }
        cache[key] = art
        return art
    }

    static func platform(_ p: Platform, dimmed: Bool) -> MarkerImage {
        cached("platform|\(p.short)|\(p.tier)|\(dimmed)") {
            centred(PlatformTile(label: p.short, color: p.tier.color, dimmed: dimmed))
        }
    }

    static func vehicle(route: String, tier: Tier, big: Bool) -> MarkerImage {
        cached("vehicle|\(route)|\(tier)|\(big)") {
            var art = centred(VehicleBadge(route: route, color: tier.color, big: big))
            art.head = render(VehicleHead(color: tier.color, big: big))
            return art
        }
    }

    /// The current stop on a journey: name tag over a tier-coloured ring.
    static func journeyStop(name: String, tier: Tier) -> MarkerImage {
        bottomAnchored(
            VStack(spacing: 5) {
                NameTag(name: name)
                ZStack {
                    Circle().fill(Palette.card)
                        .overlay(Circle().strokeBorder(tier.color, lineWidth: 3))
                        .shadow(color: tier.color.opacity(0.6), radius: 7)
                    Circle().fill(tier.color).frame(width: 6, height: 6)
                }
                .frame(width: 20, height: 20)
            },
            lift: 12
        )
    }

    /// The current stop when none of its platforms can be placed: name tag over a bone tile.
    static func stopPin(name: String) -> MarkerImage {
        bottomAnchored(
            VStack(spacing: 5) {
                NameTag(name: name)
                Tile(side: 26, color: Palette.ink) {
                    RoundedRectangle(cornerRadius: 2).fill(Palette.ink).frame(width: 8, height: 8)
                }
            }
        )
    }
}

/// A rounded square with a tier-coloured border, set off from the map by a dark ring.
private struct Tile<Content: View>: View {
    let side: CGFloat
    let color: Color
    var glow = false
    @ViewBuilder let content: Content

    var body: some View {
        ZStack {
            // box-shadow: 0 0 0 3px rgba(8,8,10,.75)
            RoundedRectangle(cornerRadius: 10)
                .fill(Palette.bg.opacity(0.75))
                .frame(width: side + 6, height: side + 6)
            RoundedRectangle(cornerRadius: 7)
                .fill(Palette.card)
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(color, lineWidth: 2))
                .frame(width: side, height: side)
                .shadow(color: glow ? color.opacity(0.4) : .clear, radius: 6)
            content
        }
    }
}

private struct PlatformTile: View {
    let label: String
    let color: Color
    let dimmed: Bool

    var body: some View {
        Tile(side: 28, color: color, glow: true) {
            Text(label)
                .font(.hanken(14, .heavy))
                .foregroundStyle(color)
        }
        .grayscale(dimmed ? 0.5 : 0)
        .opacity(dimmed ? 0.55 : 1)
    }
}

/// Vehicle geometry shared by the badge and its heading wedge, so both rasterise to one canvas.
private struct VehicleMetrics {
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

private struct VehicleBadge: View {
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
                .shadow(color: color.opacity(0.55), radius: m.haloBlur / 2)
                .shadow(color: .black.opacity(0.6), radius: 3, y: 2)
            Text(route)
                .font(.hanken(fontSize, .heavy))
                .tracking(-0.02 * fontSize)
                .foregroundStyle(Palette.chipInk)
        }
        .frame(width: m.canvas, height: m.canvas)
    }
}

/// The direction wedge on a vehicle's ring, drawn pointing up.
private struct VehicleHead: View {
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

private struct NameTag: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.hanken(11.5, .bold))
            .foregroundStyle(Palette.ink)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color(hex: 0x0C0C0F, opacity: 0.88), in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(.white.opacity(0.1), lineWidth: 1))
            .fixedSize()
    }
}
