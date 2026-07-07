import Foundation

enum Formatters {

    static let hebrewLocale = Locale(identifier: "he_IL")

    /// ‏₪1,234.50 — ללא אגורות כשהסכום עגול.
    static func currency(_ amount: Decimal, code: String = "ILS", signed: Bool = false) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = hebrewLocale
        f.currencyCode = code
        let n = amount as NSDecimalNumber
        var rounded = Decimal()
        var value = amount
        NSDecimalRound(&rounded, &value, 0, .plain)
        let isWhole = rounded == amount
        f.maximumFractionDigits = isWhole ? 0 : 2
        f.minimumFractionDigits = isWhole ? 0 : 2
        if signed { f.positivePrefix = "+" + f.positivePrefix }
        return f.string(from: n) ?? "\(amount)"
    }

    static func dayLabel(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return "היום" }
        if Calendar.current.isDateInYesterday(date) { return "אתמול" }
        let f = DateFormatter()
        f.locale = hebrewLocale
        f.dateFormat = "EEEE, d בMMMM"
        return f.string(from: date)
    }

    static func shortDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = hebrewLocale
        f.dateStyle = .short
        return f.string(from: date)
    }

    static func percent(_ value: Double) -> String {
        String(format: "%.0f%%", value * 100)
    }
}

extension Decimal {
    var doubleValue: Double { (self as NSDecimalNumber).doubleValue }
    var abs: Decimal { self < 0 ? -self : self }
}
