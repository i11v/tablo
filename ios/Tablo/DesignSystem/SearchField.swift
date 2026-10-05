import SwiftUI

/// tablo's one real text-entry control. The field font stays at 16pt (the
/// design system's input floor), with an optional trailing action label.
struct SearchField: View {
    @Binding var text: String
    var placeholder = "Search stops…"
    var focus: FocusState<Bool>.Binding
    var trailingLabel: String?
    var onTrailing: () -> Void = {}

    var body: some View {
        HStack(spacing: 9) {
            Glyph.search(color: Palette.fieldInk)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Palette.fieldInk))
                .font(.hanken(16, .medium))
                .foregroundStyle(Palette.ink)
                .tint(Palette.make)
                .focused(focus)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if let trailingLabel {
                Button(trailingLabel, action: onTrailing)
                    .font(.hanken(13, .semibold))
                    .foregroundStyle(Palette.fieldInk)
                    .fixedSize()
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(Palette.field, in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Palette.fieldEdge, lineWidth: 1))
    }
}
