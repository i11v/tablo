import SwiftUI

/// Full-screen stop search: nearby stops (or recents) by default, the whole
/// index ranked as you type.
struct SearchScreen: View {
    @Bindable var model: StopModel
    @FocusState private var focused: Bool

    var body: some View {
        let results = model.searchResults
        VStack(alignment: .leading, spacing: 0) {
            SearchField(text: $model.query, focus: $focused, trailingLabel: "Cancel", onTrailing: model.closeSearch)
                .onSubmit {
                    if let first = model.searchResults.first { model.pickStop(first.stop) }
                }

            Text(model.searchTitle)
                .font(.hanken(11, .bold))
                .tracking(11 * 0.14)
                .foregroundStyle(Palette.meta)
                .padding(.top, 20)
                .padding(.bottom, 6)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(results) { result in
                        ResultRow(result: result) { model.pickStop(result.stop) }
                    }
                    if model.indexState == .failed {
                        VStack(spacing: 10) {
                            Text("Couldn\u{2019}t load the stop list.")
                                .font(.hanken(13.5))
                                .foregroundStyle(Palette.meta)
                            Button("Retry", action: model.retryIndex)
                                .font(.hanken(13, .bold))
                                .foregroundStyle(Palette.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 30)
                    } else if let message = model.searchMessage(resultCount: results.count) {
                        Text(message)
                            .font(.hanken(13.5))
                            .foregroundStyle(Palette.meta)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                            .padding(.horizontal, 8)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .padding(.horizontal, -16)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .background(Palette.searchGround.ignoresSafeArea())
        .onAppear { focused = true }
    }
}

private struct ResultRow: View {
    let result: SearchResult
    let action: () -> Void

    var body: some View {
        let stop = result.stop
        Button(action: action) {
            HStack(spacing: 12) {
                Glyph.stopSign()
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        title
                            .lineLimit(1)
                        if result.isCurrent {
                            Circle().fill(Palette.ink).frame(width: 7, height: 7)
                        }
                    }
                    if !result.detail.isEmpty {
                        Text(result.detail)
                            .font(.hanken(12, .medium))
                            .foregroundStyle(Palette.meta)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let walk = result.walk {
                    WalkTime(minutes: walk, label: "min")
                }
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 8)
            .overlay(alignment: .bottom) { Rectangle().fill(Palette.wash(0.05)).frame(height: 1) }
        }
        .buttonStyle(RowPressStyle(cornerRadius: 8))
        .padding(.horizontal, -8)
        .accessibilityLabel(accessibility(stop))
    }

    /// The name, with the disambiguator ("· 5") in meta when names collide.
    private var title: Text {
        let name = Text(result.stop.name).font(.hanken(15.5, .bold)).foregroundStyle(Palette.ink)
        guard let disambig = result.stop.disambig else { return name }
        return Text("\(name)\(Text(" · \(disambig)").font(.hanken(15.5, .medium)).foregroundStyle(Palette.meta))")
    }

    private func accessibility(_ stop: IndexStop) -> String {
        var parts = [stop.name]
        if let disambig = stop.disambig { parts.append(disambig) }
        if let walk = result.walk { parts.append("\(walk) minute walk") }
        if result.isCurrent { parts.append("current stop") }
        return parts.joined(separator: ", ")
    }
}
