import Foundation

/// שכבת ציטוטי ניירות ערך מופשטת — הספק ניתן להחלפה (בורסת ת"א, ספק אמריקאי, ידני).
protocol QuotesProvider {
    func quote(for symbol: String) async throws -> Decimal?
}

/// ברירת המחדל ב-MVP: עדכון ידני בלבד (המשתמש מזין שער באחזקה).
/// אינטגרציית API אמיתית — שלב M3 בתוכנית.
struct ManualQuotesProvider: QuotesProvider {
    func quote(for symbol: String) async throws -> Decimal? { nil }
}

@MainActor
final class QuotesService: ObservableObject {
    var provider: QuotesProvider = ManualQuotesProvider()

    /// מרענן שערים לאחזקות שהספק מכיר; אחזקות ללא ציטוט נשארות בשער הידני.
    func refresh(holdings: [Holding]) async {
        for holding in holdings {
            if let price = try? await provider.quote(for: holding.symbol), let p = price {
                holding.lastPrice = p
                holding.lastPriceDate = Date()
            }
        }
    }
}
