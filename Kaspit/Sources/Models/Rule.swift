import Foundation
import SwiftData

/// חוק אוטומציה: כל התנאים שהוגדרו חייבים להתקיים (AND).
@Model
final class Rule {
    var uuid: UUID = UUID()
    var name: String = ""
    var priority: Int = 0
    var isEnabled: Bool = true

    // תנאים (nil = לא רלוונטי)
    var merchantContains: String?
    var merchantEquals: String?
    var descriptionContains: String?
    var amountMin: Decimal?
    var amountMax: Decimal?
    var accountUUID: UUID?
    /// כיוון: "expense" / "income" / nil לכל תנועה.
    var direction: String?

    // פעולות
    var setCategoryUUID: UUID?
    var renameTo: String?
    var addTags: [String] = []
    var hide: Bool = false
    var markTransfer: Bool = false
    var skipReview: Bool = false

    var createdAt: Date = Date()

    init(name: String) {
        self.name = name
    }
}
