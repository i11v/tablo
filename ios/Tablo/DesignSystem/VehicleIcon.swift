import SwiftUI

/// Vehicle mode read from silhouette alone, kept monochrome so reachability
/// stays the only colour competing for the eye:
///   tram — wears a pantograph pole · bus — bare-roofed · metro — an M roundel.
/// Trains borrow the tram's pantograph; other modes the bus.
struct VehicleIcon: View {
    var kind: VehicleKind
    var size: CGFloat = 22
    var color: Color = Palette.icon

    var body: some View {
        Group {
            if kind == .metro {
                Text("M")
                    .font(.hanken(size * 0.6, .heavy))
                    .foregroundStyle(color)
                    .frame(width: size, height: size)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(color, lineWidth: 1.6))
            } else {
                Canvas { ctx, canvas in
                    let s = canvas.width / 24
                    let tram = kind == .tram || kind == .train
                    var body = Path()
                    if tram {
                        body.move(to: CGPoint(x: 12, y: 1.5))
                        body.addLine(to: CGPoint(x: 12, y: 4))
                    }
                    body.addRoundedRect(
                        in: CGRect(x: tram ? 4.5 : 3.5, y: 4, width: tram ? 15 : 17, height: 14),
                        cornerSize: CGSize(width: 3.2, height: 3.2)
                    )
                    body.move(to: CGPoint(x: tram ? 5 : 4, y: 9.6))
                    body.addLine(to: CGPoint(x: tram ? 19 : 20, y: 9.6))
                    let wheels = Path { p in
                        for cx in tram ? [8.5, 15.5] : [8.0, 16.0] {
                            p.addEllipse(in: CGRect(x: cx - 1.25, y: 18.75, width: 2.5, height: 2.5))
                        }
                    }
                    let t = CGAffineTransform(scaleX: s, y: s)
                    ctx.stroke(body.applying(t), with: .color(color), style: StrokeStyle(lineWidth: 1.6 * s, lineCap: .round, lineJoin: .round))
                    ctx.fill(wheels.applying(t), with: .color(color))
                }
                .frame(width: size, height: size)
            }
        }
        .accessibilityLabel(kind.rawValue)
    }
}
