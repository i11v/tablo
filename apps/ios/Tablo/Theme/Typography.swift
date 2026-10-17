import SwiftUI
import UIKit

/// Hanken Grotesk (UI) + Doto (LED accent). Both ship as variable fonts, so a
/// weight is applied through the `wght` axis rather than a named instance.
enum Typeface {
    case ui
    case led

    fileprivate var postScriptName: String {
        switch self {
        case .ui: "HankenGrotesk-Regular"
        case .led: "Doto-Black"
        }
    }
}

enum FontWeight: CGFloat {
    case regular = 400
    case medium = 500
    case semibold = 600
    case bold = 700
    case heavy = 800
}

@MainActor
enum TabloFont {
    private static let wghtAxis = 0x7767_6874  // 'wght'
    private static var cache: [String: UIFont] = [:]

    static func uiFont(_ face: Typeface, size: CGFloat, weight: FontWeight) -> UIFont {
        let key = "\(face.postScriptName)/\(size)/\(weight.rawValue)"
        if let cached = cache[key] { return cached }
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: face.postScriptName,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wghtAxis: weight.rawValue],
        ])
        let font = UIFont(descriptor: descriptor, size: size)
        cache[key] = font
        return font
    }
}

extension Font {
    /// Hanken Grotesk at a fixed point size — tablo is a pixel-specified board, not Dynamic Type text.
    @MainActor static func hanken(_ size: CGFloat, _ weight: FontWeight = .regular) -> Font {
        Font(TabloFont.uiFont(.ui, size: size, weight: weight) as CTFont)
    }

    /// Doto, the LED face used for countdown numerals.
    @MainActor static func doto(_ size: CGFloat, _ weight: FontWeight = .bold) -> Font {
        Font(TabloFont.uiFont(.led, size: size, weight: weight) as CTFont)
    }
}
