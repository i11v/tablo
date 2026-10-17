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

    /// The appearance art is drawn in; the map re-renders its markers when it changes.
    static var scheme: ColorScheme = .dark

    private static func render(_ view: some View) -> UIImage {
        let renderer = ImageRenderer(content: view.padding(pad).environment(\.colorScheme, scheme))
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
        let key = "\(scheme)|\(key)"
        if let hit = cache[key] { return hit }
        let art = make()
        if cache.count > 400 { cache.removeAll() }
        cache[key] = art
        return art
    }

    /// A platform plate: neutral at rest, never tier-coloured — reachability
    /// belongs to the vehicle, not the platform.
    static func platform(_ p: Platform, dimmed: Bool) -> MarkerImage {
        cached("platform|\(p.short)|\(dimmed)") {
            centred(PlatformPlate(label: p.short).grayscale(dimmed ? 0.5 : 0).opacity(dimmed ? 0.55 : 1))
        }
    }

    static func vehicle(route: String, tier: Tier, big: Bool) -> MarkerImage {
        cached("vehicle|\(route)|\(tier)|\(big)") {
            var art = centred(VehicleBadge(route: route, color: tier.color, big: big))
            art.head = render(VehicleHead(color: tier.color, big: big))
            return art
        }
    }

    /// Your stop on a journey: the selected plate (platform letter, or a pip
    /// when there's none) under its name tag. Anchored at the plate centre.
    static func journeyStop(name: String, label: String) -> MarkerImage {
        named(name, PlatformPlate(label: label, selected: true))
    }

    /// The current stop when none of its platforms can be placed: a pip plate under its name.
    static func stopPin(name: String) -> MarkerImage {
        named(name, PlatformPlate(label: ""))
    }

    private static func named(_ name: String, _ plate: PlatformPlate) -> MarkerImage {
        // the tag floats 7pt above the plate; a selected plate is scaled up beneath it
        let gap = 7 + (plate.selected ? PlatformPlate.side * (PlatformPlate.selectedScale - 1) / 2 : 0)
        return bottomAnchored(
            VStack(spacing: gap) {
                NameTag(name: name)
                plate
            },
            lift: PlatformPlate.side / 2
        )
    }
}

/// A square plate with the platform letter — static by design, no point or
/// tail, so it never reads as a heading (square = place, circle = vehicle).
/// No label = a whole-stop marker with a small square pip. Neutral at rest;
/// selected turns the stroke to ink.
private struct PlatformPlate: View {
    static let side: CGFloat = 28
    static let selectedScale: CGFloat = 1.18

    let label: String
    var selected = false

    var body: some View {
        let c = selected ? Palette.ink : Palette.neutral
        ZStack {
            if label.isEmpty {
                RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 8, height: 8)
            } else {
                Text(label)
                    .font(.hanken(14, .heavy))
                    .foregroundStyle(Palette.ink)
            }
        }
        .frame(width: Self.side, height: Self.side)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(c, lineWidth: 2))
        // box-shadow: 0 0 0 3px var(--color-halo), var(--marker-drop)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Palette.halo)
                .padding(-3)
                .shadow(color: Palette.markerDrop, radius: 3, y: 2)
        )
        .scaleEffect(selected ? Self.selectedScale : 1)
    }
}

private struct NameTag: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.hanken(12, .bold))
            .foregroundStyle(Palette.ink)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Palette.edge, lineWidth: 1))
            .shadow(color: Palette.markerDrop, radius: 3, y: 2)
            .fixedSize()
    }
}
