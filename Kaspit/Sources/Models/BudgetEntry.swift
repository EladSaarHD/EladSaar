import Foundation
import SwiftData

/// תקציב חודשי לקטגוריה. monthKey בפורמט "2026-07".
@Model
final class BudgetEntry {
    var uuid: UUID = UUID()
    var monthKey: String = ""
    var amount: Decimal = 0
    /// גלגול יתרה: עודף/חוסר מהחודש הקודם מצטרף לתקציב החודש.
    var rollover: Bool = false
    var category: Category?

    init(category: Category?, monthKey: String, amount: Decimal, rollover: Bool = false) {
        self.category = category
        self.monthKey = monthKey
        self.amount = amount
        self.rollover = rollover
    }
}

enum MonthKey {
    static let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.locale = Locale(identifier: "he_IL")
        return cal
    }()

    static func key(for date: Date) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    static func date(from key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1))
    }

    static func previous(_ key: String) -> String {
        guard let d = date(from: key), let prev = calendar.date(byAdding: .month, value: -1, to: d) else { return key }
        return self.key(for: prev)
    }

    static func next(_ key: String) -> String {
        guard let d = date(from: key), let next = calendar.date(byAdding: .month, value: 1, to: d) else { return key }
        return self.key(for: next)
    }

    static func label(_ key: String) -> String {
        guard let d = date(from: key) else { return key }
        let f = DateFormatter()
        f.locale = Locale(identifier: "he_IL")
        f.dateFormat = "MMMM yyyy"
        return f.string(from: d)
    }

    /// טווח החודש: לפי לוח קלנדרי, או לפי מחזור חיוב שמתחיל ביום נתון.
    static func range(for key: String, billingDay: Int? = nil) -> ClosedRange<Date>? {
        guard let start = date(from: key) else { return nil }
        if let day = billingDay, day > 1 {
            guard let cycleStart = calendar.date(byAdding: .day, value: day - 1, to: start),
                  let nextMonth = calendar.date(byAdding: .month, value: 1, to: cycleStart),
                  let cycleEnd = calendar.date(byAdding: .second, value: -1, to: nextMonth) else { return nil }
            return cycleStart...cycleEnd
        }
        guard let nextMonth = calendar.date(byAdding: .month, value: 1, to: start),
              let end = calendar.date(byAdding: .second, value: -1, to: nextMonth) else { return nil }
        return start...end
    }
}
