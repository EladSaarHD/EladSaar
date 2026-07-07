import Foundation

/// עסקה מופשטת לצורך זיהוי מחזוריות (ללא תלות ב-SwiftData).
struct RecurringCandidateTxn {
    var merchantKey: String
    var displayName: String
    var date: Date
    /// סכום ההוצאה כערך חיובי.
    var amount: Decimal
}

struct DetectedRecurring: Equatable {
    var merchantKey: String
    var displayName: String
    var cycle: RecurringCycle
    var expectedAmount: Decimal
    var lastAmount: Decimal
    var lastDate: Date
    var nextDate: Date
    var occurrences: Int
}

/// זיהוי אוטומטי של מנויים והוראות קבע:
/// אותו בית עסק, לפחות 3 מופעים, מרווחים עקביים (± סטייה), סכום דומה.
enum RecurringDetector {

    static let minOccurrences = 3
    /// סטייה מותרת במרווח הימים בין חיובים.
    static let intervalTolerance = 0.25
    /// סטייה מותרת בסכום (מנויים שמשנים מחיר עדיין מזוהים).
    static let amountTolerance = 0.35

    static func detect(in transactions: [RecurringCandidateTxn], now: Date = Date()) -> [DetectedRecurring] {
        let grouped = Dictionary(grouping: transactions, by: { $0.merchantKey })
        var results: [DetectedRecurring] = []

        for (key, group) in grouped where group.count >= minOccurrences && !key.isEmpty {
            let sorted = group.sorted { $0.date < $1.date }
            let intervals: [Double] = zip(sorted.dropFirst(), sorted).map {
                $0.0.date.timeIntervalSince($0.1.date) / 86_400
            }
            guard let cycle = matchCycle(intervals: intervals) else { continue }

            let amounts = sorted.map { ($0.amount as NSDecimalNumber).doubleValue }
            let avg = amounts.reduce(0, +) / Double(amounts.count)
            guard avg > 0 else { continue }
            let consistent = amounts.allSatisfy { abs($0 - avg) / avg <= amountTolerance }
            guard consistent else { continue }

            let last = sorted[sorted.count - 1]
            let next = Calendar.current.date(byAdding: .day, value: cycle.days, to: last.date) ?? last.date
            results.append(DetectedRecurring(
                merchantKey: key,
                displayName: last.displayName,
                cycle: cycle,
                expectedAmount: Decimal(round(avg * 100) / 100),
                lastAmount: last.amount,
                lastDate: last.date,
                nextDate: next,
                occurrences: sorted.count))
        }
        return results.sorted { $0.nextDate < $1.nextDate }
    }

    /// כל המרווחים חייבים להתאים לאותו מחזור בטולרנס הנתון.
    static func matchCycle(intervals: [Double]) -> RecurringCycle? {
        guard !intervals.isEmpty else { return nil }
        for cycle in RecurringCycle.allCases {
            let expected = Double(cycle.days)
            let ok = intervals.allSatisfy { abs($0 - expected) / expected <= intervalTolerance }
            if ok { return cycle }
        }
        return nil
    }
}
