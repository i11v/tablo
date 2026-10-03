import SwiftUI

/// The draggable bottom sheet: the departures board, or the journey of the
/// departure you're following.
struct StopSheet: View {
    let model: StopModel
    let bottomInset: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            grip
            if let follow = model.follow {
                JourneyPanel(model: model, bottomInset: bottomInset)
                    .id(follow.id)
                    .transition(.opacity)
            } else {
                BoardPanel(model: model, bottomInset: bottomInset)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: model.sheetHeight, alignment: .top)
        .background(Palette.card)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22))
        .overlay(alignment: .top) { TopEdge(radius: 22).stroke(Palette.edge, lineWidth: 1) }
        .shadow(color: .black.opacity(0.6), radius: 16, y: -6)
    }

    private var grip: some View {
        Capsule()
            .fill(Palette.grip)
            .frame(width: 38, height: 5)
            .frame(maxWidth: .infinity)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .contentShape(Rectangle())
            .sheetDrag(model, minimumDistance: 0)
            .accessibilityLabel("Resize sheet")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: model.setSheet(model.sheetHeight + 120)
                case .decrement: model.setSheet(model.sheetHeight - 120)
                @unknown default: break
                }
            }
    }
}

/// Resizes the sheet by dragging the view vertically: the grip, and the pinned
/// headers below it.
private struct SheetDrag: ViewModifier {
    let model: StopModel
    let minimumDistance: CGFloat
    @State private var dragStart: CGFloat?

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: minimumDistance, coordinateSpace: .global)
                .onChanged { value in
                    let start = dragStart ?? model.sheetHeight
                    dragStart = start
                    model.dragSheet(to: start - value.translation.height)
                }
                .onEnded { _ in dragStart = nil }
        )
    }
}

extension View {
    fileprivate func sheetDrag(_ model: StopModel, minimumDistance: CGFloat = 6) -> some View {
        modifier(SheetDrag(model: model, minimumDistance: minimumDistance))
    }
}

/// The sheet's hairline top border, following the rounded corners.
private struct TopEdge: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: rect.minX, y: rect.minY + radius))
            p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + radius, y: rect.minY), radius: radius)
            p.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
            p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + radius), radius: radius)
        }
    }
}

private func metaText(_ row: BoardRow) -> Text {
    var plat = AttributedString(row.platformMeta)
    plat.foregroundColor = Palette.meta
    var delay = AttributedString(row.separator + row.delayText)
    delay.foregroundColor = row.delayColor
    return Text(plat + delay)
}

private struct Hairline: View {
    var opacity: Double

    var body: some View {
        Rectangle().fill(.white.opacity(opacity)).frame(height: 1)
    }
}

/// A quiet, centred meta line standing in for rows that aren't there (loading, empty, unavailable).
private struct QuietLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.hanken(13, .medium))
            .foregroundStyle(Palette.meta)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
    }
}

/// A small meta line under a header: connection state, or the index retry.
private struct StatusLine<Trailing: View>: View {
    let text: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            Text(text)
                .font(.hanken(12, .medium))
                .foregroundStyle(Palette.meta)
                .lineLimit(1)
            trailing
        }
        .padding(.bottom, 9)
    }
}

// MARK: - Board

private struct BoardPanel: View {
    let model: StopModel
    let bottomInset: CGFloat
    @State private var scrolled = false

    var body: some View {
        let board = model.board
        let message = model.boardMessage
        VStack(spacing: 0) {
            // pinned: the stop and its platform tabs stay put while the departures scroll
            VStack(alignment: .leading, spacing: 0) {
                header
                if model.indexState == .failed {
                    StatusLine(text: "Couldn\u{2019}t load the stop list.") {
                        Button("Retry", action: model.retryIndex)
                            .font(.hanken(12, .bold))
                            .foregroundStyle(Palette.ink)
                    }
                }
                if let message, board.lead != nil {
                    StatusLine(text: message) { EmptyView() }
                }
                let tabs = model.platformTabs
                if !tabs.isEmpty { tabStrip(tabs) }
            }
            .padding(.horizontal, 16)
            .padding(.top, 2)
            .contentShape(Rectangle())
            .sheetDrag(model)
            .overlay(alignment: .bottom) { Hairline(opacity: 0.06).opacity(scrolled ? 1 : 0) }
            .animation(.easeOut(duration: 0.12), value: scrolled)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let lead = board.lead { LeadRow(row: lead) { model.openJourney(lead.departure) } }
                    ForEach(board.rest) { row in
                        SecondaryRow(row: row) { model.openJourney(row.departure) }
                    }
                    if let message, board.lead == nil {
                        QuietLine(text: message)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 22 + bottomInset)
            }
            .scrollIndicators(.hidden)
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > 1
            } action: { _, isScrolled in
                scrolled = isScrolled
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(model.currentStop.name)
                    .font(.hanken(19, .heavy))
                    .tracking(0.19)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                if !model.pinLabel.isEmpty {
                    Text(model.pinLabel)
                        .font(.hanken(12, .bold))
                        .foregroundStyle(Palette.paperInk)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Palette.paper, in: RoundedRectangle(cornerRadius: 6))
                        .fixedSize()
                }
            }
            Spacer(minLength: 0)
            if let walk = model.walk {
                WalkTime(minutes: walk)
            }
        }
        .padding(.bottom, 9)
    }

    private func tabStrip(_ tabs: [PlatformTab]) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(tabs) { tab in
                    Button { model.tapTab(tab) } label: {
                        Text(tab.label)
                            .font(.hanken(12.5, .bold))
                            .foregroundStyle(tab.isOn ? Palette.paperInk : Palette.pillInk)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(tab.isOn ? Palette.paper : Palette.ctl, in: RoundedRectangle(cornerRadius: 9))
                            .overlay(
                                RoundedRectangle(cornerRadius: 9)
                                    .strokeBorder(tab.isOn ? Palette.paper : .white.opacity(0.08), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .animation(.easeOut(duration: 0.12), value: tab.isOn)
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -16)
        .padding(.bottom, 11)
    }
}

private struct LeadRow: View {
    let row: BoardRow
    let action: () -> Void

    var body: some View {
        let d = row.departure
        Button(action: action) {
            HStack(spacing: 10) {
                VehicleIcon(kind: d.kind, size: 22)
                RouteChip(route: d.route, size: .lg)
                VStack(alignment: .leading, spacing: 3) {
                    Text(d.headsign)
                        .font(.hanken(17, .bold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        if row.tier != .neutral {
                            TierPill(tier: row.tier)
                        }
                        metaText(row)
                            .font(.hanken(12, .medium))
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Countdown(tier: row.tier, minutes: d.inMinutes, atStop: d.atStop, size: 38)
            }
            .padding(.leading, 13)
            .background(alignment: .leading) {
                // the reachability edge bar
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(row.tier.color)
                    .frame(width: 3)
                    .shadow(color: row.tier.glows ? row.tier.color : .clear, radius: 4.5)
            }
            .padding(.top, 11)
            .padding(.bottom, 12)
            .overlay(alignment: .bottom) { Hairline(opacity: 0.07) }
        }
        .buttonStyle(RowPressStyle())
        .disabled(!row.canFollow)
    }
}

private struct SecondaryRow: View {
    let row: BoardRow
    let action: () -> Void

    var body: some View {
        let d = row.departure
        Button(action: action) {
            HStack(spacing: 10) {
                VehicleIcon(kind: d.kind, size: 20)
                RouteChip(route: d.route, size: .sm)
                VStack(alignment: .leading, spacing: 1) {
                    Text(d.headsign)
                        .font(.hanken(15, .semibold))
                        .foregroundStyle(Palette.inkDim)
                        .lineLimit(1)
                    if row.hasMeta {
                        metaText(row).font(.hanken(12, .medium)).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Countdown(tier: row.tier, minutes: d.inMinutes, atStop: d.atStop, size: 21)
            }
            .padding(.vertical, 9)
            .overlay(alignment: .bottom) { Hairline(opacity: 0.05) }
        }
        .buttonStyle(RowPressStyle())
        .disabled(!row.canFollow)
    }
}

// MARK: - Journey

private struct JourneyPanel: View {
    let model: StopModel
    let bottomInset: CGFloat

    var body: some View {
        if let d = model.followDeparture {
            let journey = model.journey
            let tier = journey?.tier ?? Tier.reach(inMinutes: d.inMinutes, walk: model.walk)
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 10) {
                        Button(action: model.closeJourney) {
                            Glyph.back()
                                .frame(width: 36, height: 36)
                                .background(Palette.ctl, in: RoundedRectangle(cornerRadius: 11))
                                .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(.white.opacity(0.08), lineWidth: 1))
                                .contentShape(RoundedRectangle(cornerRadius: 11))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("Back to departures")
                        VehicleIcon(kind: d.kind, size: 22)
                        RouteChip(route: d.route, size: .lg)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("TOWARDS")
                                .font(.hanken(11, .bold))
                                .tracking(1.32)
                                .foregroundStyle(Palette.meta)
                            Text(d.headsign)
                                .font(.hanken(17, .heavy))
                                .foregroundStyle(Palette.ink)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // gone from your stop: nothing left to count down to
                        Countdown(tier: tier, minutes: d.inMinutes, atStop: journey.map { $0.atStop && $0.seg == $0.mine } ?? d.atStop, size: 34)
                            .opacity(journey?.hasDeparted == true ? 0 : 1)
                    }
                    HStack(spacing: 8) {
                        if tier != .neutral {
                            TierPill(tier: tier)
                        }
                        if let journey {
                            let summary = model.journeySummary(journey)
                            Text("\(summary.text)\(Text(summary.delay).foregroundStyle(summary.delayColor))")
                                .font(.hanken(12.5, .medium))
                                .foregroundStyle(Palette.meta)
                                .lineLimit(1)
                        } else {
                            Text(model.journeyMessage ?? "")
                                .font(.hanken(12.5, .medium))
                                .foregroundStyle(Palette.meta)
                                .lineLimit(1)
                        }
                    }
                    .padding(.top, 10)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
                .contentShape(Rectangle())
                .sheetDrag(model)
                Hairline(opacity: 0.06)

                if let journey {
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(model.journeyRows(journey)) { row in
                                    switch row.kind {
                                    case let .stop(index):
                                        StopRow(row: row, tier: journey.tier) { model.focusJourneyStop(index) }
                                            .id(row.id)
                                    case .vehicle:
                                        VehicleRow(row: row, route: journey.route, tier: journey.tier)
                                            .id(row.id)
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 6)
                            .padding(.bottom, 26 + bottomInset)
                        }
                        .scrollIndicators(.hidden)
                        .onAppear {
                            guard !(journey.atStop && journey.seg == journey.mine) else { return }
                            DispatchQueue.main.async {
                                proxy.scrollTo("vehicle", anchor: UnitPoint(x: 0.5, y: 0.22))
                            }
                        }
                    }
                } else {
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

/// The time · rail · name grid shared by journey rows.
private enum RailGrid {
    static let timeWidth: CGFloat = 46
    static let railWidth: CGFloat = 26
    static let gap: CGFloat = 10
}

private struct Rail: View {
    let top: Color
    let bottom: Color

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(top)
            Rectangle().fill(bottom)
        }
        .frame(width: 2)
        .padding(.leading, RailGrid.timeWidth + RailGrid.gap + 12)
    }
}

private struct StopRow: View {
    let row: JourneyRow
    let tier: Tier
    let action: () -> Void

    var body: some View {
        let c = tier.color
        Button(action: action) {
            HStack(spacing: RailGrid.gap) {
                Text(row.time)
                    .font(.hanken(13.5, row.isMine ? .heavy : .semibold))
                    .monospacedDigit()
                    .foregroundStyle(row.isPast ? Palette.timePast : row.isMine ? c : Palette.pillInk)
                    .frame(width: RailGrid.timeWidth, alignment: .trailing)
                dot.frame(width: RailGrid.railWidth)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name)
                        .font(.hanken(row.isMine ? 16 : 14.5, row.isMine ? .heavy : .semibold))
                        .foregroundStyle(row.isPast ? Palette.namePast : row.isMine ? Palette.ink : Palette.inkDim)
                        .lineLimit(1)
                    if !row.note.isEmpty {
                        Text(row.note)
                            .font(.hanken(12, .medium))
                            .foregroundStyle(Palette.meta)
                    }
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: row.isMine ? 54 : 38)
            .background(alignment: .leading) { Rail(top: row.railTop, bottom: row.railBottom) }
            .padding(.horizontal, 8)
            .background(row.isMine ? Color.white.opacity(0.045) : .clear, in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(RowPressStyle(cornerRadius: 9))
        .padding(.horizontal, -8)
    }

    @ViewBuilder private var dot: some View {
        let c = tier.color
        if row.isMine {
            ZStack {
                Circle().fill(c).frame(width: 20, height: 20).shadow(color: tier.glows ? c : .clear, radius: 6)
                Circle().fill(Palette.card).frame(width: 16, height: 16)
                Circle().fill(c).frame(width: 10, height: 10)
            }
        } else {
            Circle()
                .fill(row.isPast ? Palette.railPast : Palette.card)
                .overlay(Circle().strokeBorder(row.isPast ? Palette.grip : Palette.pillInk, lineWidth: 2))
                .frame(width: 10, height: 10)
        }
    }
}

private struct VehicleRow: View {
    let row: JourneyRow
    let route: String
    let tier: Tier

    var body: some View {
        let c = tier.color
        HStack(spacing: RailGrid.gap) {
            Text("NOW")
                .font(.hanken(11, .bold))
                .tracking(1.1)
                .foregroundStyle(Palette.ink)
                .frame(width: RailGrid.timeWidth, alignment: .trailing)
            Text(route)
                .font(.hanken(10, .heavy))
                .foregroundStyle(Palette.ink)
                .frame(width: 22, height: 22)
                .background(Palette.vehicleFill, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(c, lineWidth: 2))
                .shadow(color: tier.glows ? c : .clear, radius: 5)
                .frame(width: RailGrid.railWidth)
            Text(row.text)
                .font(.hanken(12.5, .medium))
                .foregroundStyle(Palette.icon)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 34)
        .background(alignment: .leading) { Rail(top: Palette.railPast, bottom: Palette.railAhead) }
        .accessibilityElement(children: .combine)
    }
}
