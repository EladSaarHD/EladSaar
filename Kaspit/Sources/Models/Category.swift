import Foundation
import SwiftData

enum CategoryKind: String, Codable, CaseIterable, Identifiable {
    case expense
    case income
    case transfer

    var id: String { rawValue }

    var label: String {
        switch self {
        case .expense: return "הוצאה"
        case .income: return "הכנסה"
        case .transfer: return "העברה"
        }
    }
}

@Model
final class Category {
    var uuid: UUID = UUID()
    var name: String = ""
    var emoji: String = "🏷️"
    var colorHex: String = "#5E9EFF"
    /// קבוצת קטגוריות: בית, רכב, ילדים...
    var group: String = ""
    var kindRaw: String = CategoryKind.expense.rawValue
    var isArchived: Bool = false
    var sortOrder: Int = 0

    @Relationship(inverse: \Txn.category)
    var transactions: [Txn]? = []

    var kind: CategoryKind {
        get { CategoryKind(rawValue: kindRaw) ?? .expense }
        set { kindRaw = newValue.rawValue }
    }

    init(name: String, emoji: String, colorHex: String = "#5E9EFF", group: String = "", kind: CategoryKind = .expense, sortOrder: Int = 0) {
        self.name = name
        self.emoji = emoji
        self.colorHex = colorHex
        self.group = group
        self.kindRaw = kind.rawValue
        self.sortOrder = sortOrder
    }
}

/// סט הקטגוריות הישראלי המובנה, נזרע בהפעלה ראשונה.
enum DefaultCategories {
    static let expenses: [(String, String, String)] = [
        // (שם, אימוג'י, קבוצה)
        ("סופר", "🛒", "בית"),
        ("ארנונה", "🏛️", "בית"),
        ("ועד בית", "🏢", "בית"),
        ("חשמל", "⚡", "בית"),
        ("מים", "💧", "בית"),
        ("גז", "🔥", "בית"),
        ("שכר דירה / משכנתא", "🏠", "בית"),
        ("סלולר ואינטרנט", "📱", "בית"),
        ("טלוויזיה וסטרימינג", "📺", "בית"),
        ("דלק", "⛽", "רכב"),
        ("חניה", "🅿️", "רכב"),
        ("ביטוח וטיפולים לרכב", "🚗", "רכב"),
        ("כבישי אגרה", "🛣️", "רכב"),
        ("תחבורה ציבורית", "🚌", "תחבורה"),
        ("מוניות", "🚕", "תחבורה"),
        ("קופת חולים", "🏥", "בריאות"),
        ("בית מרקחת", "💊", "בריאות"),
        ("ביטוחים", "🛡️", "בריאות"),
        ("חוגים וגנים", "👶", "ילדים"),
        ("בגדים לילדים", "🧸", "ילדים"),
        ("אוכל בחוץ", "🍔", "פנאי"),
        ("בתי קפה", "☕", "פנאי"),
        ("בילויים ותרבות", "🎭", "פנאי"),
        ("חופשות", "✈️", "פנאי"),
        ("ספורט וכושר", "🏋️", "פנאי"),
        ("ביגוד והנעלה", "👕", "קניות"),
        ("קניות לבית", "🛋️", "קניות"),
        ("מתנות ואירועים", "🎁", "אחר"),
        ("תרומות", "🤝", "אחר"),
        ("עמלות בנק", "🏦", "אחר"),
        ("חינוך ולימודים", "📚", "אחר"),
        ("חיות מחמד", "🐕", "אחר"),
        ("שונות", "🗂️", "אחר"),
    ]

    static let income: [(String, String, String)] = [
        ("משכורת", "💼", "הכנסות"),
        ("קצבאות ביטוח לאומי", "🇮🇱", "הכנסות"),
        ("הכנסה מעסק", "🧾", "הכנסות"),
        ("החזרים", "↩️", "הכנסות"),
        ("ריבית ודיבידנד", "💹", "הכנסות"),
        ("הכנסה אחרת", "💰", "הכנסות"),
    ]

    static let transfer: [(String, String, String)] = [
        ("העברה בין חשבונות", "🔁", "העברות"),
        ("ביט / פייבוקס", "📲", "העברות"),
        ("חיוב כרטיס אשראי", "💳", "העברות"),
        ("הפקדה לחיסכון", "🐖", "העברות"),
    ]

    static func seed(into insert: (Category) -> Void) {
        var order = 0
        for (name, emoji, group) in expenses {
            insert(Category(name: name, emoji: emoji, group: group, kind: .expense, sortOrder: order)); order += 1
        }
        for (name, emoji, group) in income {
            insert(Category(name: name, emoji: emoji, group: group, kind: .income, sortOrder: order)); order += 1
        }
        for (name, emoji, group) in transfer {
            insert(Category(name: name, emoji: emoji, group: group, kind: .transfer, sortOrder: order)); order += 1
        }
    }
}
