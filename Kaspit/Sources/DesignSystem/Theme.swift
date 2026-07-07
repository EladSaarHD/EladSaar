import SwiftUI

enum Theme {
    static let income = Color.green
    static let expense = Color.primary
    static let warning = Color.orange
    static let over = Color.red
    static let cardBackground = Color(.secondarySystemGroupedBackground)

    static func color(hex: String) -> Color {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard let value = UInt64(s, radix: 16), s.count == 6 else { return .blue }
        return Color(red: Double((value >> 16) & 0xFF) / 255,
                     green: Double((value >> 8) & 0xFF) / 255,
                     blue: Double(value & 0xFF) / 255)
    }
}

/// סכום כסף עם צבע לפי כיוון: הכנסה ירוקה, הוצאה רגילה.
struct AmountText: View {
    let amount: Decimal
    var code: String = "ILS"
    var showSign: Bool = false

    var body: some View {
        Text(Formatters.currency(amount, code: code, signed: showSign))
            .foregroundStyle(amount > 0 ? Theme.income : Theme.expense)
            .monospacedDigit()
    }
}

/// תג אימוג'י עגול של קטגוריה/חשבון.
struct EmojiBadge: View {
    let emoji: String
    var size: CGFloat = 36

    var body: some View {
        Text(emoji)
            .font(.system(size: size * 0.55))
            .frame(width: size, height: size)
            .background(Color(.tertiarySystemFill), in: Circle())
    }
}

/// פס התקדמות תקציב: ירוק → כתום (80%) → אדום (100%).
struct BudgetProgressBar: View {
    /// 0...∞ (מעל 1 = חריגה)
    let fraction: Double

    private var color: Color {
        if fraction >= 1 { return Theme.over }
        if fraction >= 0.8 { return Theme.warning }
        return Theme.income
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.tertiarySystemFill))
                Capsule().fill(color)
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 8)
    }
}

/// כרטיס דשבורד.
struct DashboardCard<Content: View>: View {
    let title: String
    var systemImage: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                if let systemImage {
                    Image(systemName: systemImage).foregroundStyle(.secondary)
                }
            }
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
    }
}
