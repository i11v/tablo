import SwiftUI

/// The route badge worn by every departure: a line number or metro letter in a
/// quiet inset chip. Mode is told by the VehicleIcon beside it, never by colour.
struct RouteChip: View {
    enum Size {
        case sm, lg, xl

        var frame: CGSize {
            switch self {
            case .sm: CGSize(width: 38, height: 28)
            case .lg: CGSize(width: 46, height: 36)
            case .xl: CGSize(width: 62, height: 48)
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .sm: 15
            case .lg: 19
            case .xl: 26
            }
        }
    }

    var route: String
    var size: Size = .sm

    var body: some View {
        Text(route)
            .font(.hanken(size.fontSize, .heavy))
            .foregroundStyle(Palette.chipInk)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: size.frame.width, height: size.frame.height)
            .background(Palette.chip, in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Palette.stroke, lineWidth: 1))
            .accessibilityLabel("Line \(route)")
    }
}

/// The verdict, spelled out: CATCH / RUN / MISSED on a filled reachability hue.
struct TierPill: View {
    var tier: Tier
    var label: String?

    var body: some View {
        Text(label ?? tier.verdict)
            .font(.hanken(11, .bold))
            .tracking(11 * 0.06)
            .foregroundStyle(tier.onColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(tier.color, in: RoundedRectangle(cornerRadius: 4))
            .fixedSize()
    }
}

/// The loudest element on every surface: a Doto LED numeral glowing in its
/// reachability hue. "<1" under a minute, "NOW" at the stop. Glow only from
/// ~28pt up and never for the neutral tier.
struct Countdown: View {
    var tier: Tier
    var minutes: Int?
    var atStop = false
    var size: CGFloat = 38

    private var text: String {
        if atStop { return "NOW" }
        guard let minutes, minutes != 0 else { return "<1" }
        return String(minutes)
    }

    var body: some View {
        let glow = size >= 28 && tier != .neutral
        let showUnit = size >= 30 && !atStop && minutes != nil && minutes != 0
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(text)
                .font(.doto(size, .bold))
                .tracking(size * 0.04)
                .shadow(color: glow ? Palette.glow(tier.color, dark: 0.47, light: 0.22) : .clear, radius: 7)
            if showUnit {
                Text("min").font(.hanken(size * 0.34, .bold))
            }
        }
        .foregroundStyle(tier.color)
        .lineLimit(1)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(atStop ? "At the stop now" : "In \(minutes ?? 0) minutes")
    }
}
