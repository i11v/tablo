import SwiftUI
import UIKit

/// tablo colour tokens — a port of `tokens/theme.css`, plus the handful of
/// one-off greys the stop prototype uses inline. Dark-only by design.
enum Palette {
    // surfaces (warm near-black stack)
    static let bg = Color(hex: 0x08080A)
    static let card = Color(hex: 0x0F0F12)
    static let chip = Color(hex: 0x1B1B20)
    static let ctl = Color(hex: 0x191920)
    static let edge = Color(hex: 0x1F1F25)

    // ink (warm bone, never blue-cold)
    static let ink = Color(hex: 0xECEAE3)
    static let inkDim = Color(hex: 0xD8D6CF)
    static let meta = Color(hex: 0x76767E)
    static let chipInk = Color(hex: 0xE7E5DE)
    static let paper = Color(hex: 0xE9E7E0)
    static let paperInk = Color(hex: 0x0A0A0A)

    // reachability (semantic — meaning, never decoration)
    static let make = Color(hex: 0x22E06B)
    static let run = Color(hex: 0xFFB02E)
    static let miss = Color(hex: 0xFF3B4E)
    static let neutral = Color(hex: 0xC9C7C0)
    static let onMake = Color(hex: 0x06210F)
    static let onRun = Color(hex: 0x2B1C00)
    static let onMiss = Color(hex: 0x2B060A)

    // supporting
    static let late = Color(hex: 0xE7A13A)
    static let early = Color(hex: 0x5FAE7A)
    static let icon = Color(hex: 0xA09A8F)

    // prototype one-offs
    static let pillInk = Color(hex: 0xB7B5AD)       // inactive tab text, upcoming stop time
    static let toggleOff = Color(hex: 0x6D6D75)     // mode toggle, off
    static let fabIcon = Color(hex: 0xCFCDC6)
    static let grip = Color(hex: 0x3A3A42)
    static let glass = Color(hex: 0x0C0C0F, opacity: 0.82)
    static let searchGround = Color(hex: 0x0C0C0F)
    static let searchEdge = Color(hex: 0x2E2E36)
    static let searchMuted = Color(hex: 0x8A8A92)
    static let vehicleFill = Color(hex: 0x141418)

    // journey rail
    static let railPast = Color(hex: 0x2C2C33)
    static let railAhead = Color(hex: 0x8A887F)
    static let timePast = Color(hex: 0x4A4A52)
    static let namePast = Color(hex: 0x55555C)
    static let routePast = Color(hex: 0x5C5A54)
    static let dotPastFill = Color(hex: 0x2A2A30)
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
