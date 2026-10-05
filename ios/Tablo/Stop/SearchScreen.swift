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
                .padding(.horizontal, 2)
                .padding(.top, 16)
                .padding(.bottom, 8)

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(results) { result in
                        ResultRow(result: result) { model.pickStop(result.stop) }
                    }
                    if model.indexState == .failed {
                        VStack(spacing: 10) {
                            Text("Couldn\u{2019}t load the stop list.")
                                .font(.hanken(12))
                                .foregroundStyle(Palette.faint)
                            Button("Retry", action: model.retryIndex)
                                .font(.hanken(13, .bold))
                                .foregroundStyle(Palette.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                    } else if let message = model.searchMessage(resultCount: results.count) {
                        Text(message)
                            .font(.hanken(12))
                            .foregroundStyle(Palette.faint)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                            .padding(.horizontal, 8)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .padding(.horizontal, -14)
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .background(Ground().ignoresSafeArea())
        .onAppear { focused = true }
    }
}

/// One stop in the results (StopResult): the stop tile, name, its platforms
/// (or zone), and your walk. The stop you're already viewing wears a meta border.
private struct ResultRow: View {
    let result: SearchResult
    let action: () -> Void

    var body: some View {
        let stop = result.stop
        Button(action: action) {
            HStack(spacing: 11) {
                StopGlyph()
                VStack(alignment: .leading, spacing: 3) {
                    title
                        .lineLimit(1)
                    if !result.detail.isEmpty {
                        Text(result.detail)
                            .font(.hanken(12, .semibold))
                            .foregroundStyle(Palette.meta)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let walk = result.walk {
                    WalkTime(minutes: walk)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 13))
            .overlay(
                RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(result.isCurrent ? Palette.meta : Palette.edge, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(accessibility(stop))
    }

    /// The name, with the disambiguator ("· 5") in meta when names collide.
    private var title: Text {
        let name = Text(result.stop.name).font(.hanken(16, .bold)).foregroundStyle(Palette.ink)
        guard let disambig = result.stop.disambig else { return name }
        return Text("\(name)\(Text(" · \(disambig)").font(.hanken(16, .medium)).foregroundStyle(Palette.meta))")
    }

    private func accessibility(_ stop: IndexStop) -> String {
        var parts = [stop.name]
        if let disambig = stop.disambig { parts.append(disambig) }
        if let walk = result.walk { parts.append("\(walk) minute walk") }
        if result.isCurrent { parts.append("current stop") }
        return parts.joined(separator: ", ")
    }
}
