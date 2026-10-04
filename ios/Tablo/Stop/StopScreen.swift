import MapKit
import SwiftUI

/// Map-centred stop page: live map behind a floating search pill + mode
/// filter, a recentre button riding the sheet, and the departures sheet.
struct StopScreen: View {
    @State private var model = StopModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            GeometryReader { geo in
                let insets = geo.safeAreaInsets
                StopCanvas(model: model, insets: insets)
                    .ignoresSafeArea()
                    .onAppear { model.containerHeight = geo.size.height + insets.top + insets.bottom }
                    .onChange(of: geo.size.height + insets.top + insets.bottom) { _, h in model.containerHeight = h }
            }
            .ignoresSafeArea(.keyboard)

            if model.searchOpen {
                SearchScreen(model: model)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.searchOpen)
        .background(Palette.bg)
        .preferredColorScheme(.dark)
        .onAppear { model.setActive(true) }
        .onChange(of: scenePhase) { _, phase in
            // pause the socket, location and polling in the background; .inactive is a passing state
            switch phase {
            case .active: model.setActive(true)
            case .background: model.setActive(false)
            default: break
            }
        }
    }
}

private struct StopCanvas: View {
    let model: StopModel
    let insets: EdgeInsets

    var body: some View {
        ZStack(alignment: .top) {
            StopMapView(controller: model.map)

            // scrim so the floating controls read against bright map areas
            LinearGradient(colors: [Palette.bg.opacity(0.72), Palette.bg.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: 104 + insets.top)
                .allowsHitTesting(false)

            TopBar(model: model)
                .padding(.horizontal, 16)
                .padding(.top, insets.top + 10)

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    RecenterButton(action: model.recenter)
                }
                .padding(.trailing, 16)
                .padding(.bottom, model.sheetHeight + 12)
            }

            VStack {
                Spacer()
                StopSheet(model: model, bottomInset: insets.bottom)
            }
        }
    }
}

private struct StopMapView: UIViewRepresentable {
    let controller: StopMapController

    func makeUIView(context: Context) -> TabloMapView { controller.mapView }
    func updateUIView(_ uiView: TabloMapView, context: Context) {}
}

/// Translucent dark chrome shared by the floating map controls.
struct GlassBackground<S: InsettableShape>: View {
    let shape: S

    var body: some View {
        shape.fill(Palette.glass)
            .overlay(shape.strokeBorder(.white.opacity(0.09), lineWidth: 1))
    }
}

private struct TopBar: View {
    let model: StopModel

    var body: some View {
        let following = model.follow != nil
        HStack(spacing: 8) {
            Button(action: model.openSearch) {
                HStack(spacing: 9) {
                    Glyph.search()
                    Rectangle().fill(.white.opacity(0.09)).frame(width: 1, height: 16)
                    if model.isNearest {
                        Glyph.nearest().padding(.trailing, -3)
                    }
                    Text(model.currentStop.name)
                        .font(.hanken(14, .bold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.leading, 12)
                .padding(.trailing, 14)
                .frame(maxWidth: .infinity, minHeight: 38, maxHeight: 38, alignment: .leading)
                .background(GlassBackground(shape: RoundedRectangle(cornerRadius: 12)))
                .contentShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Search stops, current stop \(model.currentStop.name)")

            HStack(spacing: 3) {
                ForEach(VehicleKind.filterable, id: \.self) { kind in
                    let on = model.modes.contains(kind)
                    Button { model.toggleMode(kind) } label: {
                        VehicleIcon(kind: kind, size: 15, color: on ? Palette.ink : Palette.toggleOff)
                            .padding(.vertical, 6)
                            .padding(.horizontal, 8)
                            .background(on ? Color.white.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 8))
                            .contentShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .animation(.easeOut(duration: 0.12), value: on)
                    .accessibilityLabel("\(kind.rawValue) \(on ? "shown" : "hidden")")
                }
            }
            .padding(4)
            .background(GlassBackground(shape: RoundedRectangle(cornerRadius: 12)))
            .fixedSize()
            .opacity(following ? 0 : 1)
            .allowsHitTesting(!following)
            .animation(.easeInOut(duration: 0.15), value: following)
        }
    }
}

private struct RecenterButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Glyph.recenter()
                .frame(width: 42, height: 42)
                .background(GlassBackground(shape: Circle()))
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Go to nearest stop")
    }
}

/// Press feedback for floating controls.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.75 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// A soft row highlight standing in for the prototype's hover states.
struct RowPressStyle: ButtonStyle {
    var cornerRadius: CGFloat = 6

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Color.white.opacity(configuration.isPressed ? 0.05 : 0),
                in: RoundedRectangle(cornerRadius: cornerRadius)
            )
            .contentShape(Rectangle())
    }
}
