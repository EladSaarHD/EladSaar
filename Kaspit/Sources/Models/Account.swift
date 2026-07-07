import Foundation
import SwiftData

enum AccountKind: String, Codable, CaseIterable, Identifiable {
    case checking          // עו"ש
    case creditCard        // כרטיס אשראי
    case savings           // פיקדונות וחסכונות
    case cash              // מזומן
    case loan              // הלוואה
    case mortgage          // משכנתא
    case brokerage         // תיק השקעות
    case pension           // פנסיה
    case studyFund         // קרן השתלמות
    case providentFund     // קופת גמל
    case asset             // נכס ידני (דירה, רכב)

    var id: String { rawValue }

    var label: String {
        switch self {
        case .checking: return "עו\"ש"
        case .creditCard: return "כרטיס אשראי"
        case .savings: return "פיקדונות וחסכונות"
        case .cash: return "מזומן"
        case .loan: return "הלוואה"
        case .mortgage: return "משכנתא"
        case .brokerage: return "תיק השקעות"
        case .pension: return "פנסיה"
        case .studyFund: return "קרן השתלמות"
        case .providentFund: return "קופת גמל"
        case .asset: return "נכס"
        }
    }

    var emoji: String {
        switch self {
        case .checking: return "🏦"
        case .creditCard: return "💳"
        case .savings: return "🐖"
        case .cash: return "💵"
        case .loan: return "📉"
        case .mortgage: return "🏠"
        case .brokerage: return "📈"
        case .pension: return "🧓"
        case .studyFund: return "🎓"
        case .providentFund: return "🗄️"
        case .asset: return "🏢"
        }
    }

    /// חוב — היתרה נספרת כהתחייבות בשווי הנקי.
    var isLiability: Bool {
        switch self {
        case .creditCard, .loan, .mortgage: return true
        default: return false
        }
    }

    /// חשבונות שההוצאות בהם נספרות בתקציב.
    var isSpending: Bool {
        switch self {
        case .checking, .creditCard, .cash: return true
        default: return false
        }
    }
}

struct BalancePoint: Codable, Hashable {
    var date: Date
    var balance: Decimal
}

@Model
final class Account {
    var uuid: UUID = UUID()
    var name: String = ""
    var kindRaw: String = AccountKind.checking.rawValue
    var currencyCode: String = "ILS"
    var institution: String = ""
    /// יום החיוב החודשי של כרטיס אשראי (2/10/15...).
    var billingDay: Int?
    var creditLimit: Decimal?
    /// יתרה נוכחית. לחשבונות שאינם מסונכרנים מתעדכנת ידנית או מייבוא.
    var currentBalance: Decimal = 0
    var balanceHistory: [BalancePoint] = []
    var isArchived: Bool = false
    var createdAt: Date = Date()

    @Relationship(deleteRule: .cascade, inverse: \Txn.account)
    var transactions: [Txn]? = []

    @Relationship(deleteRule: .cascade, inverse: \Holding.account)
    var holdings: [Holding]? = []

    var kind: AccountKind {
        get { AccountKind(rawValue: kindRaw) ?? .checking }
        set { kindRaw = newValue.rawValue }
    }

    init(name: String, kind: AccountKind, currencyCode: String = "ILS", institution: String = "", billingDay: Int? = nil) {
        self.name = name
        self.kindRaw = kind.rawValue
        self.currencyCode = currencyCode
        self.institution = institution
        self.billingDay = billingDay
    }

    func recordBalanceSnapshot(_ balance: Decimal, on date: Date = Date()) {
        currentBalance = balance
        balanceHistory.append(BalancePoint(date: date, balance: balance))
        balanceHistory.sort { $0.date < $1.date }
    }
}
