import SwiftUI
import UIKit

/// tablo colour tokens — a port of `tokens/theme.css` (dark, the LED board)
/// and `tokens/light.css` (warm paper, for daylight). Every token follows the
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

    // strokes + control ink (themeable)
    static let strokeSoft = dynamic(.white.withAlphaComponent(0.05), UIColor(hex: 0x19181B, alpha: 0.06))   // secondary row divider
    static let stroke = dynamic(.white.withAlphaComponent(0.07), UIColor(hex: 0x19181B, alpha: 0.08))       // lead row divider, chip stroke
    static let strokeStrong = dynamic(.white.withAlphaComponent(0.12), UIColor(hex: 0x19181B, alpha: 0.16)) // control stroke, sheet grip
    static let ctlInk = dynamic(0xB7B5AD, 0x45434A)     // idle pill text, icon-button glyph
    static let field = dynamic(0x0C0C0F, 0xFFFFFF)      // text field + floating map controls
    static let fieldEdge = dynamic(0x2E2E36, 0xD4D0C6)
    static let fieldInk = dynamic(0x8A8A92, 0x6B6870)   // search glyph, trailing action

    // map markers
    static let halo = dynamic(UIColor(hex: 0x08080A, alpha: 0.75), UIColor(hex: 0xFBFAF6, alpha: 0.9))
    static let markerDrop = dynamic(UIColor(white: 0, alpha: 0.6), UIColor(hex: 0x3C301E, alpha: 0.22))

    /// `--shadow-overlay`: the one place depth is allowed (sheets, overlays).
    static let overlayShadow = dynamic(UIColor(white: 0, alpha: 0.8), UIColor(hex: 0x3C301E, alpha: 0.3))

    /// `--ground`'s glow colour: the top of the radial "screen is on" gradient.
    static let groundGlow = dynamic(0x101014, 0xFBFAF6)

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
