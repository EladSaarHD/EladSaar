import Foundation
import SwiftData

/// יעד חיסכון: חופשה, מקדמה לדירה, קרן חירום.
@Model
final class Goal {
    var uuid: UUID = UUID()
    var name: String = ""
    var emoji: String = "🎯"
    var targetAmount: Decimal = 0
    var targetDate: Date?
    /// חשבונות שכל היתרה שלהם נספרת ליעד.
    var linkedAccountUUIDs: [UUID] = []
    /// הפקדות ידניות שלא דרך חשבון מקושר.
    var manualContribution: Decimal = 0
    var createdAt: Date = Date()
    var isCompleted: Bool = false

    init(name: String, emoji: String = "🎯", targetAmount: Decimal, targetDate: Date? = nil) {
        self.name = name
        self.emoji = emoji
        self.targetAmount = targetAmount
        self.targetDate = targetDate
    }

    /// התקדמות: חשבונות מקושרים + תנועות מסומנות + ידני.
    func progress(linkedAccountsBalance: Decimal, taggedTransactionsTotal: Decimal) -> Decimal {
        linkedAccountsBalance + taggedTransactionsTotal + manualContribution
    }
}
