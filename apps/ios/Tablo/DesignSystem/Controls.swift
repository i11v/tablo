import SwiftUI

/// `--ground`: the page ground with its fixed top-down radial glow — the
/// "screen is on" feeling (`radial-gradient(120% 80% at 50% 0%, glow, bg 72%)`).
struct Ground: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            Rectangle()
                .fill(RadialGradient(
                    stops: [.init(color: Palette.groundGlow, location: 0), .init(color: Palette.bg, location: 0.72)],
                    center: .top, startRadius: 0, endRadius: max(1, h * 0.8)
                ))
                // the CSS ellipse is 1.2w × 0.8h: stretch the circle to it
                .scaleEffect(x: max(1, w * 1.2) / max(1, h * 0.8), y: 1, anchor: .top)
        }
        .background(Palette.bg)
        .clipped()
    }
}

/// 42pt square button floating over the map (recenter). Floating-on-map rule:
/// opaque field fill + field-edge border, no blur, no shadow.
struct MapControl<Icon: View>: View {
    let label: String
    let action: () -> Void
    @ViewBuilder var icon: Icon

    var body: some View {
        Button(action: action) {
            icon
                .frame(width: 42, height: 42)
                .background(Palette.field, in: RoundedRectangle(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Palette.fieldEdge, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

/// Multi-select tram / bus / metro toggle floating on the map. On = paper fill
/// with a paper-ink pictogram; off = transparent with a meta pictogram.
struct ModeFilter: View {
    let value: [VehicleKind]
    var modes: [VehicleKind] = VehicleKind.filterable
    let onToggle: (VehicleKind) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(modes, id: \.self) { kind in
                let on = value.contains(kind)
                Button { onToggle(kind) } label: {
                    VehicleIcon(kind: kind, size: 18, color: on ? Palette.paperInk : Palette.meta)
                        .frame(width: 38, height: 34)
                        .background(on ? Palette.paper : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .animation(.easeOut(duration: 0.12), value: on)
                .accessibilityLabel("\(kind.rawValue) \(on ? "shown" : "hidden")")
            }
        }
        .padding(3)
        .background(Palette.field, in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Palette.fieldEdge, lineWidth: 1))
        .fixedSize()
    }
}

/// 32pt square control (back in the journey header): ctl fill, strong stroke,
/// ctl-ink glyph. Press = colour, never scale.
struct IconButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Glyph.back()
                .frame(width: 32, height: 32)
                .background(Palette.ctl, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.strokeStrong, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

/// The platform filter pill. Inactive: quiet ctl fill with a strong hairline.
/// Active: inverted to paper (the one "selected" affordance in the system).
struct PlatformChip: View {
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.hanken(12.5, .bold))
                .foregroundStyle(active ? Palette.paperInk : Palette.ctlInk)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(active ? Palette.paper : Palette.ctl, in: RoundedRectangle(cornerRadius: 9))
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .strokeBorder(active ? Palette.paper : Palette.strokeStrong, lineWidth: 1)
                )
                .fixedSize()
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.12), value: active)
    }
}

/// The stop tile: a hairline tram front in a ctl-filled rounded square.
struct StopGlyph: View {
    var size: CGFloat = 32

    var body: some View {
        Glyph.tramFront(size: (size * 0.5).rounded())
            .frame(width: size, height: size)
            .background(Palette.ctl, in: RoundedRectangle(cornerRadius: size * 0.3))
            .overlay(RoundedRectangle(cornerRadius: size * 0.3).strokeBorder(Palette.stroke, lineWidth: 1))
    }
}
