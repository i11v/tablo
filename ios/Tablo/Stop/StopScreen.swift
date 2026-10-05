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

private struct TopBar: View {
    let model: StopModel

    var body: some View {
        let following = model.follow != nil
        HStack(spacing: 8) {
            // the read-only SearchField: carries the current stop, tap opens the real search
            Button(action: model.openSearch) {
                HStack(spacing: 9) {
                    Glyph.search(color: Palette.fieldInk)
                    if model.isNearest {
                        Glyph.nearest().padding(.trailing, -3)
                    }
                    Text(model.currentStop.name)
                        .font(.hanken(16, .semibold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.horizontal, 13)
                .frame(maxWidth: .infinity, minHeight: 42, maxHeight: 42, alignment: .leading)
                .background(Palette.field, in: RoundedRectangle(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Palette.fieldEdge, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Search stops, current stop \(model.currentStop.name)")

            ModeFilter(value: model.modes, onToggle: model.toggleMode)
                .opacity(following ? 0 : 1)
                .allowsHitTesting(!following)
                .animation(.easeInOut(duration: 0.15), value: following)
        }
    }
}

private struct RecenterButton: View {
    let action: () -> Void

    var body: some View {
        MapControl(label: "Go to nearest stop", action: action) { Glyph.recenter() }
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

/// The design's hover fill on tappable rows: stroke-soft, rounded-chip.
struct RowPressStyle: ButtonStyle {
    var cornerRadius: CGFloat = 7

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed ? Palette.strokeSoft : .clear,
                in: RoundedRectangle(cornerRadius: cornerRadius)
            )
            .contentShape(Rectangle())
    }
}
