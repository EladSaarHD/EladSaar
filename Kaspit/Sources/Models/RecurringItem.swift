import Foundation
import SwiftData

enum RecurringCycle: String, Codable, CaseIterable, Identifiable {
    case weekly
    case monthly
    case bimonthly
    case yearly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .weekly: return "שבועי"
        case .monthly: return "חודשי"
        case .bimonthly: return "דו-חודשי"
        case .yearly: return "שנתי"
        }
    }

    var days: Int {
        switch self {
        case .weekly: return 7
        case .monthly: return 30
        case .bimonthly: return 61
        case .yearly: return 365
        }
    }
}

struct PricePoint: Codable, Hashable {
    var date: Date
    var amount: Decimal
}

/// מנוי / הוראת קבע שזוהו אוטומטית (או נוצרו ידנית).
@Model
final class RecurringItem {
    var uuid: UUID = UUID()
    /// מפתח בית העסק המנורמל שעליו מבוסס הזיהוי.
    var merchantKey: String = ""
    var displayName: String = ""
    var emoji: String = "🔁"
    var cycleRaw: String = RecurringCycle.monthly.rawValue
    /// הסכום הצפוי (חיובי — סכום החיוב).
    var expectedAmount: Decimal = 0
    var lastAmount: Decimal = 0
    var lastDate: Date = Date()
    var nextDate: Date = Date()
    /// המשתמש סימן שביטל את המנוי — נתריע אם ממשיך לרדת.
    var isCancelled: Bool = false
    /// המשתמש דחה את הזיהוי — לא להציג שוב.
    var isDismissed: Bool = false
    var priceHistory: [PricePoint] = []
    var categoryUUID: UUID?

    var cycle: RecurringCycle {
        get { RecurringCycle(rawValue: cycleRaw) ?? .monthly }
        set { cycleRaw = newValue.rawValue }
    }

    /// עליית מחיר: החיוב האחרון גבוה מהצפוי ביותר מ-5%.
    var priceIncreased: Bool {
        guard expectedAmount > 0 else { return false }
        let ratio = (lastAmount as NSDecimalNumber).doubleValue / (expectedAmount as NSDecimalNumber).doubleValue
        return ratio > 1.05
    }

    init(merchantKey: String, displayName: String, cycle: RecurringCycle, expectedAmount: Decimal, lastAmount: Decimal, lastDate: Date, nextDate: Date) {
        self.merchantKey = merchantKey
        self.displayName = displayName
        self.cycleRaw = cycle.rawValue
        self.expectedAmount = expectedAmount
        self.lastAmount = lastAmount
        self.lastDate = lastDate
        self.nextDate = nextDate
    }
}
