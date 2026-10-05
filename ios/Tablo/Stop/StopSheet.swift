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
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 13, topTrailingRadius: 13))
        .overlay(alignment: .top) { TopEdge(radius: 13).stroke(Palette.edge, lineWidth: 1) }
        .shadow(color: Palette.overlayShadow, radius: 30, y: 24)
    }

    private var grip: some View {
        Capsule()
            .fill(Palette.strokeStrong)
            .frame(width: 36, height: 4)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .padding(.bottom, 10)
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
    var color = Palette.stroke

    var body: some View {
        Rectangle().fill(color).frame(height: 1)
    }
}

/// A quiet, centred caption standing in for rows that aren't there (loading, empty, unavailable).
private struct QuietLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.hanken(12, .medium))
            .foregroundStyle(Palette.meta)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 18)
            .padding(.bottom, 6)
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
            .padding(.horizontal, 15)
            .padding(.top, 2)
            .contentShape(Rectangle())
            .sheetDrag(model)
            .overlay(alignment: .bottom) { Hairline().opacity(scrolled ? 1 : 0) }
            .animation(.easeOut(duration: 0.12), value: scrolled)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let lead = board.lead { LeadRow(row: lead) { model.openJourney(lead.departure) } }
                    ForEach(board.rest) { row in
                        SecondaryRow(row: row, last: row.id == board.rest.last?.id) { model.openJourney(row.departure) }
                    }
                    if let message, board.lead == nil {
                        QuietLine(text: message)
                    }
                    let note = model.filterNote
                    if !note.isEmpty {
                        Text(note)
                            .font(.hanken(12, .medium))
                            .foregroundStyle(Palette.faint)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 10)
                            .padding(.bottom, 4)
                    }
                }
                .padding(.horizontal, 15)
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
        HStack(alignment: .center, spacing: 12) {
            Text(model.currentStop.name)
                .font(.hanken(16, .heavy))
                .tracking(0.16)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let walk = model.walk {
                WalkTime(minutes: walk)
            }
        }
        .padding(.bottom, 10)
    }

    private func tabStrip(_ tabs: [PlatformTab]) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(tabs) { tab in
                    PlatformChip(label: tab.label, active: tab.isOn) { model.tapTab(tab) }
                }
            }
            .padding(.horizontal, 15)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -15)
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
                    .shadow(color: row.tier.glows ? Palette.glow(row.tier.color, dark: 1, light: 0.35) : .clear, radius: 4.5)
            }
            .padding(.top, 11)
            .padding(.bottom, 12)
            // tappable rows bleed 8pt into the sheet padding so the press fill has air
            .padding(.horizontal, 8)
            .overlay(alignment: .bottom) { Hairline() }
        }
        .buttonStyle(RowPressStyle())
        .padding(.horizontal, -8)
        .disabled(!row.canFollow)
    }
}

private struct SecondaryRow: View {
    let row: BoardRow
    var last = false
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
            .padding(.horizontal, 8)
            .overlay(alignment: .bottom) { Hairline(color: Palette.strokeSoft).opacity(last ? 0 : 1) }
        }
        .buttonStyle(RowPressStyle())
        .padding(.horizontal, -8)
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
                // JourneyHeader: back · pictogram · route · TOWARDS + headsign · countdown, then verdict + summary
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 10) {
                        IconButton(label: "Back to departures", action: model.closeJourney)
                        VehicleIcon(kind: d.kind, size: 22)
                        RouteChip(route: d.route, size: .lg)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("TOWARDS")
                                .font(.hanken(11, .bold))
                                .tracking(11 * 0.14)
                                .foregroundStyle(Palette.meta)
                            Text(d.headsign)
                                .font(.hanken(17, .bold))
                                .foregroundStyle(Palette.ink)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // gone from your stop: nothing left to count down to
                        Countdown(tier: tier, minutes: d.inMinutes, atStop: journey.map { $0.atStop && $0.seg == $0.mine } ?? d.atStop, size: 38)
                            .opacity(journey?.hasDeparted == true ? 0 : 1)
                    }
                    HStack(spacing: 8) {
                        if tier != .neutral {
                            TierPill(tier: tier)
                        }
                        if let journey {
                            let summary = model.journeySummary(journey)
                            Text("\(summary.text)\(Text(summary.delay).foregroundStyle(summary.delayColor))")
                                .font(.hanken(12, .medium))
                                .foregroundStyle(Palette.meta)
                                .lineLimit(1)
                        } else {
                            Text(model.journeyMessage ?? "")
                                .font(.hanken(12, .medium))
                                .foregroundStyle(Palette.meta)
                                .lineLimit(1)
                        }
                    }
                    .padding(.top, 10)
                }
                .padding(.horizontal, 15)
                .padding(.bottom, 12)
                .contentShape(Rectangle())
                .sheetDrag(model)
                Hairline()

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
                            .padding(.horizontal, 15)
                            .padding(.top, 10)
                            .padding(.bottom, 30 + bottomInset)
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

/// The time · rail · name grid shared by RouteTimeline rows.
private enum RailGrid {
    static let timeWidth: CGFloat = 44
    static let railWidth: CGFloat = 28
    static let gap: CGFloat = 10
}

/// The 2pt rail through a row: `edge` behind the vehicle, `meta` ahead.
private struct Rail: View {
    let top: Color
    let bottom: Color

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(top)
            Rectangle().fill(bottom)
        }
        .frame(width: 2)
        .padding(.leading, RailGrid.timeWidth + RailGrid.gap + RailGrid.railWidth / 2 - 1)
    }
}

private struct StopRow: View {
    let row: JourneyRow
    let tier: Tier
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: RailGrid.gap) {
                Text(row.time)
                    .font(.hanken(12, row.isMine ? .bold : row.isPast ? .medium : .semibold))
                    .monospacedDigit()
                    .foregroundStyle(row.isMine ? Palette.ink : row.isPast ? Palette.meta : Palette.inkDim)
                    .frame(width: RailGrid.timeWidth, alignment: .trailing)
                dot.frame(width: RailGrid.railWidth)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name)
                        .font(.hanken(row.isMine ? 16 : 15, row.isMine ? .bold : row.isPast ? .medium : .semibold))
                        .foregroundStyle(row.isMine ? Palette.ink : row.isPast ? Palette.meta : Palette.inkDim)
                        .lineLimit(1)
                    if !row.note.isEmpty {
                        Text(row.note)
                            .font(.hanken(12, .medium))
                            .foregroundStyle(Palette.meta)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: row.isMine ? 54 : 36)
            .background(alignment: .leading) { Rail(top: row.railTop, bottom: row.railBottom) }
            .padding(.horizontal, 8)
            .background(row.isMine ? Palette.strokeSoft : .clear, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(RowPressStyle())
        .padding(.horizontal, -8)
    }

    @ViewBuilder private var dot: some View {
        let c = tier.color
        if row.isMine {
            // tier dot, a card ring, then a soft tier halo
            Circle()
                .fill(c)
                .frame(width: 12, height: 12)
                .padding(3)
                .background(Circle().fill(Palette.card))
                .padding(3)
                .background(Circle().fill(c.opacity(0.28)))
                .shadow(color: tier.glows ? c.opacity(0.5) : .clear, radius: 5)
        } else {
            Circle()
                .fill(Palette.card)
                .overlay(Circle().strokeBorder(row.isPast ? Palette.edge : Palette.ctlInk, lineWidth: 2))
                .frame(width: 10, height: 10)
        }
    }
}

/// "NOW": the vehicle riding the rail, heading down the line, "Between A and B".
private struct VehicleRow: View {
    let row: JourneyRow
    let route: String
    let tier: Tier

    var body: some View {
        HStack(spacing: RailGrid.gap) {
            Text("NOW")
                .font(.hanken(11, .bold))
                .tracking(11 * 0.14)
                .foregroundStyle(Palette.ink)
                .frame(width: RailGrid.timeWidth, alignment: .trailing)
            VehicleMarker(route: route, tier: tier, heading: 180)
                .frame(width: RailGrid.railWidth, height: 24)
            Text(row.text)
                .font(.hanken(12, .medium))
                .foregroundStyle(Palette.meta)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 40)
        .background(alignment: .leading) { Rail(top: Palette.edge, bottom: Palette.meta) }
        .accessibilityElement(children: .combine)
    }
}
