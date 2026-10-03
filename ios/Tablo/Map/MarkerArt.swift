import SwiftUI
import UIKit

/// Map marker artwork, drawn in SwiftUI and rasterised once into annotation
/// images. `anchor` is the image point that sits on the marker's coordinate.
struct MarkerImage {
    let image: UIImage
    let anchor: CGPoint
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
            bottomAnchored(PlatformPin(label: p.short, color: p.tier.color, dimmed: dimmed))
        }
    }

    static func vehicle(route: String, tier: Tier, big: Bool) -> MarkerImage {
        cached("vehicle|\(route)|\(tier)|\(big)") {
            centred(VehicleBadge(route: route, color: tier.color, big: big))
        }
    }

    static func user() -> MarkerImage {
        centred(UserDot())
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

    /// The current stop when none of its platforms can be placed: name tag over a bone pin.
    static func stopPin(name: String) -> MarkerImage {
        bottomAnchored(
            VStack(spacing: 5) {
                NameTag(name: name)
                ZStack {
                    PinShape()
                        .fill(Palette.card)
                        .overlay(PinShape().strokeBorder(Palette.ink, lineWidth: 2))
                        .frame(width: 30, height: 30)
                        .rotationEffect(.degrees(-45))
                        .shadow(color: .black.opacity(0.5), radius: 4, y: 3)
                    Circle().fill(Palette.ink).frame(width: 8, height: 8)
                }
                .frame(width: 30, height: 30)
            }
        )
    }
}

/// "50% 50% 50% 2px" — a disc with one sharp corner, rotated into a pin.
private struct PinShape: InsettableShape {
    var inset: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: inset, dy: inset)
        let big = r.width / 2
        return UnevenRoundedRectangle(
            topLeadingRadius: big, bottomLeadingRadius: max(0, 2 - inset),
            bottomTrailingRadius: big, topTrailingRadius: big
        ).path(in: r)
    }

    func inset(by amount: CGFloat) -> PinShape {
        PinShape(inset: inset + amount)
    }
}

private struct PlatformPin: View {
    let label: String
    let color: Color
    let dimmed: Bool

    var body: some View {
        ZStack {
            PinShape()
                .fill(Palette.card)
                .overlay(PinShape().strokeBorder(color, lineWidth: 2))
                .frame(width: 30, height: 30)
                .rotationEffect(.degrees(45))
                .shadow(color: color.opacity(0.4), radius: 6)
                .shadow(color: .black.opacity(0.5), radius: 4, y: 3)
            Text(label)
                .font(.hanken(14, .heavy))
                .foregroundStyle(color)
        }
        .frame(width: 30, height: 30)
        .grayscale(dimmed ? 0.5 : 0)
        .opacity(dimmed ? 0.55 : 1)
    }
}

private struct VehicleBadge: View {
    let route: String
    let color: Color
    let big: Bool

    var body: some View {
        let side: CGFloat = big ? 30 : 24
        let halo = side + 2 + (big ? 9 : 5) * 2
        let fontSize: CGFloat = route.count > 2 ? (big ? 12 : 10) : (big ? 14 : 12)
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [color.opacity(0.55), color.opacity(0)], center: .center, startRadius: 0, endRadius: halo / 2))
                .frame(width: halo, height: halo)
            RoundedRectangle(cornerRadius: big ? 9 : 8)
                .fill(Palette.vehicleFill)
                .overlay(RoundedRectangle(cornerRadius: big ? 9 : 8).strokeBorder(color, lineWidth: 2))
                .frame(width: side, height: side)
                .shadow(color: color.opacity(0.5), radius: 5)
                .shadow(color: .black.opacity(0.6), radius: 3, y: 2)
            Text(route)
                .font(.hanken(fontSize, .heavy))
                .tracking(-0.02 * fontSize)
                .foregroundStyle(Palette.ink)
        }
    }
}

private struct UserDot: View {
    var body: some View {
        ZStack {
            Circle().fill(Palette.ink.opacity(0.14)).frame(width: 38, height: 38)
            Circle()
                .fill(Palette.ink)
                .overlay(Circle().strokeBorder(Palette.bg, lineWidth: 2))
                .frame(width: 16, height: 16)
                .shadow(color: Palette.ink.opacity(0.7), radius: 5)
        }
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
