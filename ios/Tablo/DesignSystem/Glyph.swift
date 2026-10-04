import SwiftUI

/// A hairline pictogram drawn in its own viewBox, scaled to `size` — the SVG
/// glyphs from the prototype (search, walk, recenter, stop sign, …).
struct Glyph: View {
    var viewBox: CGSize
    var size: CGSize
    var color: Color
    var lineWidth: CGFloat = 1.5
    var stroke: Path = Path()
    var fill: Path?

    var body: some View {
        Canvas { ctx, canvas in
            let scale = canvas.width / viewBox.width
            let t = CGAffineTransform(scaleX: scale, y: scale)
            ctx.stroke(
                stroke.applying(t), with: .color(color),
                style: StrokeStyle(lineWidth: lineWidth * scale, lineCap: .round, lineJoin: .round)
            )
            if let fill { ctx.fill(fill.applying(t), with: .color(color)) }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}

extension Glyph {
    static func search(color: Color = Palette.icon, size: CGFloat = 15) -> Glyph {
        Glyph(viewBox: CGSize(width: 15, height: 15), size: CGSize(width: size, height: size), color: color, lineWidth: 1.5, stroke: Path { p in
            p.addEllipse(in: CGRect(x: 1.5, y: 1.5, width: 10, height: 10))
            p.move(to: CGPoint(x: 10.5, y: 10.5))
            p.addLine(to: CGPoint(x: 14, y: 14))
        })
    }

    /// The hairline walking figure beside every walk time.
    static func walk(color: Color = Palette.meta) -> Glyph {
        Glyph(viewBox: CGSize(width: 10, height: 14), size: CGSize(width: 10, height: 14), color: color, lineWidth: 1.3, stroke: Path { p in
            p.move(to: CGPoint(x: 5.4, y: 4.6)); p.addLine(to: CGPoint(x: 5.4, y: 8.2))
            p.move(to: CGPoint(x: 5.4, y: 8.2)); p.addLine(to: CGPoint(x: 3.4, y: 12.6))
            p.move(to: CGPoint(x: 5.4, y: 8.2)); p.addLine(to: CGPoint(x: 7.4, y: 12))
            p.move(to: CGPoint(x: 5.4, y: 6)); p.addLine(to: CGPoint(x: 7.6, y: 7))
        }, fill: Path(ellipseIn: CGRect(x: 3.9, y: 0.5, width: 3, height: 3)))
    }

    /// The locate button: the nearest-stop arrow at button size.
    static func recenter(color: Color = Palette.fabIcon) -> Glyph {
        nearest(color: color, size: 18)
    }

    /// The filled location arrow marking the stop nearest you.
    static func nearest(color: Color = Palette.make, size: CGFloat = 12) -> Glyph {
        Glyph(viewBox: CGSize(width: 24, height: 24), size: CGSize(width: size, height: size), color: color, lineWidth: 0, fill: Path { p in
            p.move(to: CGPoint(x: 12, y: 2))
            p.addLine(to: CGPoint(x: 20, y: 20))
            p.addLine(to: CGPoint(x: 12, y: 16))
            p.addLine(to: CGPoint(x: 4, y: 20))
            p.closeSubpath()
        })
    }

    /// A stop sign on its pole — the search result pictogram.
    static func stopSign(color: Color = Palette.icon) -> Glyph {
        Glyph(viewBox: CGSize(width: 24, height: 24), size: CGSize(width: 22, height: 22), color: color, lineWidth: 1.6, stroke: Path { p in
            p.addRoundedRect(in: CGRect(x: 5, y: 2.5, width: 14, height: 11), cornerSize: CGSize(width: 3.5, height: 3.5))
            p.move(to: CGPoint(x: 12, y: 13.5)); p.addLine(to: CGPoint(x: 12, y: 21.5))
            p.move(to: CGPoint(x: 9, y: 21.5)); p.addLine(to: CGPoint(x: 15, y: 21.5))
        })
    }

    static func back(color: Color = Palette.ink) -> Glyph {
        Glyph(viewBox: CGSize(width: 16, height: 16), size: CGSize(width: 16, height: 16), color: color, lineWidth: 1.8, stroke: Path { p in
            p.move(to: CGPoint(x: 10, y: 3))
            p.addLine(to: CGPoint(x: 5, y: 8))
            p.addLine(to: CGPoint(x: 10, y: 13))
        })
    }
}

/// "N min walk" with the walking figure.
struct WalkTime: View {
    var minutes: Int
    var label = "min walk"

    var body: some View {
        HStack(spacing: 5) {
            Glyph.walk()
            Text("\(minutes) \(label)")
        }
        .font(.hanken(12.5, .medium))
        .foregroundStyle(Palette.meta)
        .lineLimit(1)
        .fixedSize()
    }
}
