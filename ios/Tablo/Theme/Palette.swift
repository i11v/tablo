import SwiftUI
import UIKit

/// tablo colour tokens — a port of `tokens/theme.css` (dark, the LED board)
/// and `tokens/light.css` (warm paper, for daylight), plus the handful of
/// one-off greys the stop prototype uses inline. Every token follows the
/// system appearance.
enum Palette {
    // surfaces (dark: warm near-black stack · light: warm paper, never stark white)
    static let bg = dynamic(0x08080A, 0xF2F0EA)
    static let card = dynamic(0x0F0F12, 0xFBFAF6)
    static let chip = dynamic(0x1B1B20, 0xE8E5DE)
    static let ctl = dynamic(0x191920, 0xEFEDE7)
    static let edge = dynamic(0x1F1F25, 0xDFDBD2)

    // ink (warm bone / warm near-black, never blue-cold)
    static let ink = dynamic(0xECEAE3, 0x19181B)
    static let inkDim = dynamic(0xD8D6CF, 0x2E2D31)
    static let meta = dynamic(0x76767E, 0x6B6870)
    static let chipInk = dynamic(0xE7E5DE, 0x1C1B1F)
    static let paper = dynamic(0xE9E7E0, 0x19181B)
    static let paperInk = dynamic(0x0A0A0A, 0xF6F4EE)
    static let faint = dynamic(0x5E5E66, 0x8A8790)

    // reachability (semantic — meaning, never decoration); deepened on paper to hold 4.5:1
    static let make = dynamic(0x22E06B, 0x0D8442)
    static let run = dynamic(0xFFB02E, 0xA65C00)
    static let miss = dynamic(0xFF3B4E, 0xCC1D33)
    static let neutral = dynamic(0xC9C7C0, 0x5D5A61)
    static let onMake = dynamic(0x06210F, 0xFFFFFF)
    static let onRun = dynamic(0x2B1C00, 0xFFFFFF)
    static let onMiss = dynamic(0x2B060A, 0xFFFFFF)

    // supporting
    static let late = dynamic(0xE7A13A, 0xA65C00)
    static let early = dynamic(0x5FAE7A, 0x2C7A4D)
    static let icon = dynamic(0xA09A8F, 0x77716A)

    // prototype one-offs
    static let pillInk = dynamic(0xB7B5AD, 0x45434A)       // inactive tab text, upcoming stop time
    static let toggleOff = dynamic(0x6D6D75, 0x6B6870)     // mode toggle, off
    static let toggleOnFill = dynamic(.white.withAlphaComponent(0.14), UIColor(hex: 0x19181B))
    static let toggleOnInk = dynamic(0xECEAE3, 0xF6F4EE)
    static let fabIcon = dynamic(0xCFCDC6, 0x77716A)
    static let grip = dynamic(UIColor(hex: 0x3A3A42), UIColor(hex: 0x19181B, alpha: 0.16))
    static let glass = dynamic(UIColor(hex: 0x0C0C0F, alpha: 0.82), UIColor(white: 1, alpha: 0.94))
    static let glassEdge = dynamic(.white.withAlphaComponent(0.09), UIColor(hex: 0xD4D0C6))
    static let searchGround = dynamic(0x0C0C0F, 0xF2F0EA)
    static let searchField = dynamic(0x0C0C0F, 0xFFFFFF)
    static let searchEdge = dynamic(0x2E2E36, 0xD4D0C6)
    static let searchMuted = dynamic(0x8A8A92, 0x6B6870)
    static let vehicleFill = dynamic(0x141418, 0xE8E5DE)
    static let sheetShadow = dynamic(UIColor(white: 0, alpha: 0.6), UIColor(hex: 0x19181B, alpha: 0.16))

    // map markers
    static let halo = dynamic(UIColor(hex: 0x08080A, alpha: 0.75), UIColor(hex: 0xFBFAF6, alpha: 0.9))
    static let markerDrop = dynamic(UIColor(white: 0, alpha: 0.6), UIColor(hex: 0x3C301E, alpha: 0.22))
    static let tag = dynamic(UIColor(hex: 0x0C0C0F, alpha: 0.88), UIColor(white: 1, alpha: 0.94))

    // journey rail
    static let railPast = dynamic(0x2C2C33, 0xDFDBD2)
    static let railAhead = dynamic(0x8A887F, 0x6B6870)
    static let timePast = dynamic(0x4A4A52, 0x8A8790)
    static let namePast = dynamic(0x55555C, 0x8A8790)
    static let dotPastFill = dynamic(0x2A2A30, 0xE8E5DE)
    static let dotPastEdge = dynamic(0x3A3A42, 0xDFDBD2)

    /// A hairline / wash: bone-white over the dark board, warm ink over paper
    /// (a touch stronger, as in `light.css`'s strokes).
    static func wash(_ opacity: Double) -> Color {
        dynamic(.white.withAlphaComponent(opacity), UIColor(hex: 0x19181B, alpha: opacity * 1.2))
    }

    /// A glow in `color`'s hue: an LED bloom on the dark board, only a faint
    /// tint on paper (a bloom reads as a smudge on light).
    static func glow(_ color: Color, dark: Double, light: Double) -> Color {
        let base = UIColor(color)
        return Color(uiColor: UIColor { traits in
            base.resolvedColor(with: traits).withAlphaComponent(traits.userInterfaceStyle == .dark ? dark : light)
        })
    }

    private static func dynamic(_ dark: UInt32, _ light: UInt32) -> Color {
        dynamic(UIColor(hex: dark), UIColor(hex: light))
    }

    private static func dynamic(_ dark: UIColor, _ light: UIColor) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
